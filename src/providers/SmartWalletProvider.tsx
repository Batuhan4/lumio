import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import storage from "../util/storage";
import {
  SMART_WALLET_DEFAULT_STATE,
  type SmartWalletPersistence,
  type SmartWalletTransaction,
  type SmartWalletUsageSnapshot,
} from "../types/smartWallet";
import { type AgentUsage, metersInDisplayOrder } from "../util/pricing";
import { useVaultBalance } from "../hooks/useVaultBalance";

const STORAGE_KEY = "smartWallet";
const MAX_TRANSACTIONS = 50;
const PRECISION_FACTOR = 1_000_000;

const clampCurrency = (value: number) =>
  Math.max(
    0,
    Math.round(Number(value || 0) * PRECISION_FACTOR) / PRECISION_FACTOR,
  );

const safeNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const generateId = (prefix: string) =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const toUsageSnapshot = (
  usage?: AgentUsage,
): SmartWalletUsageSnapshot | undefined => {
  if (!usage) {
    return undefined;
  }
  const snapshot: SmartWalletUsageSnapshot = {};
  metersInDisplayOrder.forEach((key) => {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      snapshot[key] =
        key === "httpCalls"
          ? Math.max(0, Math.round(value))
          : Math.max(0, value);
    }
  });
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};

const sanitizeUsage = (
  usage: SmartWalletUsageSnapshot | undefined,
): SmartWalletUsageSnapshot | undefined => {
  if (!usage || typeof usage !== "object") {
    return undefined;
  }
  const snapshot: SmartWalletUsageSnapshot = {};
  metersInDisplayOrder.forEach((key) => {
    const value = (usage as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      snapshot[key] =
        key === "httpCalls"
          ? Math.max(0, Math.round(value))
          : Math.max(0, value);
    }
  });
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
};

const sanitizeTransaction = (
  raw: SmartWalletTransaction | Record<string, unknown> | undefined,
): SmartWalletTransaction | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }

  const tx = raw as Partial<SmartWalletTransaction>;
  const direction = tx.direction === "credit" ? "credit" : "debit";
  const amount = clampCurrency(safeNumber(tx.amount));
  const balanceAfter = clampCurrency(safeNumber(tx.balanceAfter));
  const requestedValue = clampCurrency(safeNumber(tx.requested));
  const requested = requestedValue > 0 ? requestedValue : undefined;
  const insufficient =
    typeof tx.insufficient === "boolean" ? tx.insufficient : undefined;

  if (amount <= 0 && direction === "debit") {
    return null;
  }

  return {
    id:
      typeof tx.id === "string" && tx.id.length > 0 ? tx.id : generateId("txn"),
    direction,
    amount,
    timestamp:
      typeof tx.timestamp === "string"
        ? tx.timestamp
        : new Date().toISOString(),
    reason: typeof tx.reason === "string" ? tx.reason : undefined,
    runType:
      tx.runType === "run" || tx.runType === "preview" ? tx.runType : undefined,
    usage: sanitizeUsage(tx.usage),
    balanceAfter,
    requested,
    insufficient,
  };
};

const sanitizeState = (
  raw: SmartWalletPersistence | null | undefined,
): SmartWalletPersistence => {
  if (!raw || typeof raw !== "object") {
    return { ...SMART_WALLET_DEFAULT_STATE };
  }

  const balance = clampCurrency(safeNumber(raw.balance));
  const lifetimeSpend = clampCurrency(safeNumber(raw.lifetimeSpend));
  const transactions = Array.isArray(raw.transactions)
    ? raw.transactions
        .map((entry) => sanitizeTransaction(entry))
        .filter((entry): entry is SmartWalletTransaction => entry !== null)
        .slice(0, MAX_TRANSACTIONS)
    : [];

  return {
    balance,
    lifetimeSpend,
    transactions,
  };
};

const loadState = (): SmartWalletPersistence => {
  const persisted = sanitizeState(storage.getItem(STORAGE_KEY, "safe"));
  return {
    ...persisted,
    balance: 0,
  };
};

type SmartWalletDeductionOptions = {
  label?: string;
  runType?: "preview" | "run";
  usage?: AgentUsage;
};

export type SmartWalletMutationResult = {
  ok: boolean;
  direction: "debit" | "credit";
  applied: number;
  balance: number;
  requested: number;
  insufficient: boolean;
};

const applyDebit = (
  prev: SmartWalletPersistence,
  amount: number,
  options?: SmartWalletDeductionOptions,
) => {
  const requested = clampCurrency(amount);
  if (requested <= 0) {
    return {
      next: prev,
      result: {
        ok: false,
        direction: "debit" as const,
        applied: 0,
        balance: prev.balance,
        requested,
        insufficient: false,
      },
    };
  }

  const previousBalance = clampCurrency(prev.balance);
  const insufficient = requested > previousBalance;
  const applied = insufficient ? previousBalance : requested;
  const nextBalance = clampCurrency(previousBalance - applied);
  const nextLifetime = clampCurrency(prev.lifetimeSpend + applied);

  const transaction: SmartWalletTransaction | null =
    applied > 0
      ? {
          id: generateId("txn"),
          direction: "debit",
          amount: applied,
          timestamp: new Date().toISOString(),
          reason: options?.label,
          runType: options?.runType,
          usage: toUsageSnapshot(options?.usage),
          balanceAfter: nextBalance,
          requested,
          insufficient,
        }
      : null;

  const transactions =
    transaction !== null
      ? [transaction, ...prev.transactions].slice(0, MAX_TRANSACTIONS)
      : prev.transactions;

  return {
    next: {
      balance: nextBalance,
      lifetimeSpend: nextLifetime,
      transactions,
    },
    result: {
      ok: applied > 0,
      direction: "debit" as const,
      applied,
      balance: nextBalance,
      requested,
      insufficient,
    },
  };
};

const applyCredit = (
  prev: SmartWalletPersistence,
  amount: number,
  reason?: string,
) => {
  const requested = clampCurrency(amount);
  if (requested <= 0) {
    return {
      next: prev,
      result: {
        ok: false,
        direction: "credit" as const,
        applied: 0,
        balance: prev.balance,
        requested,
        insufficient: false,
      },
    };
  }

  const nextBalance = clampCurrency(prev.balance + requested);
  const transaction: SmartWalletTransaction = {
    id: generateId("txn"),
    direction: "credit",
    amount: requested,
    timestamp: new Date().toISOString(),
    reason,
    balanceAfter: nextBalance,
  };

  const transactions = [transaction, ...prev.transactions].slice(
    0,
    MAX_TRANSACTIONS,
  );

  return {
    next: {
      balance: nextBalance,
      lifetimeSpend: prev.lifetimeSpend,
      transactions,
    },
    result: {
      ok: true,
      direction: "credit" as const,
      applied: requested,
      balance: nextBalance,
      requested,
      insufficient: false,
    },
  };
};

export type SmartWalletContextValue = {
  balance: number;
  lifetimeSpend: number;
  transactions: SmartWalletTransaction[];
  deduct: (
    amount: number,
    options?: SmartWalletDeductionOptions,
  ) => SmartWalletMutationResult;
  credit: (amount: number, reason?: string) => SmartWalletMutationResult;
  reset: () => void;
  refresh: () => Promise<void>;
};

export const SmartWalletContext = // eslint-disable-line react-refresh/only-export-components
  createContext<SmartWalletContextValue | undefined>(undefined);

export const SmartWalletProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<SmartWalletPersistence>(loadState);
  const {
    balance: vaultBalance,
    rawBalance,
    refresh: refreshVaultBalance,
    hasAddress,
  } = useVaultBalance();

  const persist = useCallback((next: SmartWalletPersistence) => {
    storage.setItem(STORAGE_KEY, next);
  }, []);

  useEffect(() => {
    if (!hasAddress) {
      setState((previous) => {
        if (previous.balance === 0) {
          return previous;
        }
        const next = { ...previous, balance: 0 };
        persist(next);
        return next;
      });
      return;
    }

    if (rawBalance === null) {
      return;
    }

    const nextBalance = clampCurrency(vaultBalance);
    setState((previous) => {
      if (previous.balance === nextBalance) {
        return previous;
      }
      const next = { ...previous, balance: nextBalance };
      persist(next);
      return next;
    });
  }, [hasAddress, rawBalance, vaultBalance, persist]);

  const refresh = useCallback(async () => {
    await refreshVaultBalance();
  }, [refreshVaultBalance]);

  const deduct = useCallback<SmartWalletContextValue["deduct"]>(
    (amount, options) => {
      let outcome: SmartWalletMutationResult | null = null;
      setState((previous) => {
        const sanitizedPrev = sanitizeState(previous);
        const { next, result } = applyDebit(sanitizedPrev, amount, options);
        outcome = result;
        persist(next);
        return next;
      });
      void refresh();

      if (!outcome) {
        const requested = clampCurrency(amount);
        return {
          ok: false,
          direction: "debit",
          applied: 0,
          balance: clampCurrency(state.balance),
          requested,
          insufficient: false,
        };
      }

      return outcome;
    },
    [persist, refresh, state.balance],
  );

  const credit = useCallback<SmartWalletContextValue["credit"]>(
    (amount, reason) => {
      let outcome: SmartWalletMutationResult | null = null;
      setState((previous) => {
        const sanitizedPrev = sanitizeState(previous);
        const { next, result } = applyCredit(sanitizedPrev, amount, reason);
        outcome = result;
        persist(next);
        return next;
      });
      void refresh();

      if (!outcome) {
        const requested = clampCurrency(amount);
        return {
          ok: false,
          direction: "credit",
          applied: 0,
          balance: clampCurrency(state.balance),
          requested,
          insufficient: false,
        };
      }

      return outcome;
    },
    [persist, refresh, state.balance],
  );

  const reset = useCallback(() => {
    const resetState = sanitizeState(SMART_WALLET_DEFAULT_STATE);
    setState(resetState);
    persist(resetState);
    void refresh();
  }, [persist, refresh]);

  const { balance, lifetimeSpend, transactions } = state;

  const contextValue = useMemo<SmartWalletContextValue>(
    () => ({
      balance,
      lifetimeSpend,
      transactions,
      deduct,
      credit,
      reset,
      refresh,
    }),
    [balance, lifetimeSpend, transactions, deduct, credit, reset, refresh],
  );

  return (
    <SmartWalletContext value={contextValue}>{children}</SmartWalletContext>
  );
};
