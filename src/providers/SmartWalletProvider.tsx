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
import { useWallet } from "../hooks/useWallet";
import { AMOUNT_SCALE } from "../util/amount";
import { createPrepaidVaultClient } from "../contracts/prepaid_vault";
import { createAgentRegistryClient } from "../contracts/agent_registry";
import { networkPassphrase as defaultNetworkPassphrase } from "../contracts/util";

const STORAGE_KEY = "smartWallet";
const MAX_TRANSACTIONS = 50;
const PRECISION_FACTOR = 1_000_000;
const DEFAULT_AGENT_ID = 1;

type ContractUsageBreakdown = {
  llm_in: bigint;
  llm_out: bigint;
  http_calls: bigint;
  runtime_ms: bigint;
};

const ZERO_USAGE: ContractUsageBreakdown = {
  llm_in: 0n,
  llm_out: 0n,
  http_calls: 0n,
  runtime_ms: 0n,
};

const roundCurrency = (value: number) =>
  Math.round(Number(value || 0) * PRECISION_FACTOR) / PRECISION_FACTOR;

const clampCurrency = (value: number) => Math.max(0, roundCurrency(value));

const safeNumber = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const decimalToContractUnits = (value: number): bigint => {
  if (!Number.isFinite(value) || value <= 0) {
    return 0n;
  }
  const normalized = value < 0 ? 0 : value;
  const [wholePart, fractionalRaw = ""] = normalized.toFixed(7).split(".");
  const whole = BigInt(wholePart) * AMOUNT_SCALE;
  const fractional = BigInt(fractionalRaw.padEnd(7, "0").slice(0, 7));
  return whole + fractional;
};

const contractUnitsToDecimal = (value: bigint): number => {
  return Number(value) / Number(AMOUNT_SCALE);
};

const divideCeil = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator <= 0n) {
    throw new Error("Cannot divide by zero or negative value.");
  }
  if (numerator <= 0n) {
    return 0n;
  }
  const quotient = numerator / denominator;
  return numerator % denominator === 0n ? quotient : quotient + 1n;
};

const USAGE_METERS = ["llm_in", "llm_out", "http_calls", "runtime_ms"] as const;

const toPositiveInteger = (value: number | undefined): bigint => {
  if (!Number.isFinite(value) || value === undefined) {
    return 0n;
  }
  if (value <= 0) {
    return 0n;
  }
  return BigInt(Math.round(value));
};

const agentUsageToContract = (usage?: AgentUsage): ContractUsageBreakdown => {
  if (!usage) {
    return { ...ZERO_USAGE };
  }
  return {
    llm_in: toPositiveInteger(usage.llmInTokens),
    llm_out: toPositiveInteger(usage.llmOutTokens),
    http_calls: toPositiveInteger(usage.httpCalls),
    runtime_ms: toPositiveInteger(usage.runtimeMs),
  };
};

const computeUsageChargeUnits = (
  rates: ContractUsageBreakdown,
  usage: ContractUsageBreakdown,
): bigint => {
  return (
    rates.llm_in * usage.llm_in +
    rates.llm_out * usage.llm_out +
    rates.http_calls * usage.http_calls +
    rates.runtime_ms * usage.runtime_ms
  );
};

const cloneUsage = (usage: ContractUsageBreakdown): ContractUsageBreakdown => ({
  llm_in: usage.llm_in,
  llm_out: usage.llm_out,
  http_calls: usage.http_calls,
  runtime_ms: usage.runtime_ms,
});

const selectSupplementMeter = (rates: ContractUsageBreakdown) => {
  for (const key of USAGE_METERS) {
    const rate = rates[key];
    if (rate > 0n) {
      return { key, rate };
    }
  }
  return { key: "runtime_ms" as const, rate: 0n };
};

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

  const syncedBalance = clampCurrency(
    safeNumber(
      (raw as Partial<SmartWalletPersistence>).syncedBalance ?? balance,
    ),
  );

  return {
    balance,
    syncedBalance,
    lifetimeSpend,
    transactions,
  };
};

const loadState = (): SmartWalletPersistence => {
  const persisted = sanitizeState(storage.getItem(STORAGE_KEY, "safe"));
  return {
    ...persisted,
    balance: 0,
    syncedBalance: 0,
  };
};

type SmartWalletDeductionOptions = {
  label?: string;
  runType?: "preview" | "run";
  usage?: AgentUsage;
};

export type SmartWalletMutationResult = {
  ok: boolean;
  direction: "debit";
  applied: number;
  balance: number;
  requested: number;
  insufficient: boolean;
  runId?: number;
  error?: string;
};

type AgentConfig = {
  agentId: number;
  rateVersion: number;
  rates: ContractUsageBreakdown;
};

export type SmartWalletContextValue = {
  balance: number;
  lifetimeSpend: number;
  transactions: SmartWalletTransaction[];
  deduct: (
    amount: number,
    options?: SmartWalletDeductionOptions,
  ) => Promise<SmartWalletMutationResult>;
  reset: () => void;
  refresh: () => Promise<void>;
};

export const SmartWalletContext = // eslint-disable-line react-refresh/only-export-components
  createContext<SmartWalletContextValue | undefined>(undefined);

export const SmartWalletProvider = ({ children }: PropsWithChildren) => {
  const [state, setState] = useState<SmartWalletPersistence>(loadState);
  const [agentConfig, setAgentConfig] = useState<AgentConfig | null>(null);
  const {
    address,
    signTransaction,
    signAuthEntry,
    networkPassphrase: walletNetworkPassphrase,
  } = useWallet();
  const {
    balance: vaultBalance,
    rawBalance,
    refresh: refreshVaultBalance,
    hasAddress,
  } = useVaultBalance();

  const persist = useCallback((next: SmartWalletPersistence) => {
    storage.setItem(STORAGE_KEY, next);
  }, []);

  const ensureAgentConfig = useCallback(async (): Promise<AgentConfig> => {
    if (agentConfig) {
      return agentConfig;
    }

    const registryClient = createAgentRegistryClient();
    const agentId = DEFAULT_AGENT_ID;

    try {
      const latestVersionTx = await registryClient.latest_rate_version({
        agent_id: agentId,
      });
      const rawVersion = latestVersionTx.result;
      const rateVersion =
        typeof rawVersion === "bigint"
          ? Number(rawVersion)
          : typeof rawVersion === "number"
            ? rawVersion
            : 1;

      const rateCardTx = await registryClient.get_rate_card({
        agent_id: agentId,
        version: rateVersion,
      });
      const rateCard = rateCardTx.result;
      if (!rateCard) {
        throw new Error("Rate card unavailable.");
      }
      const normalizedRates: ContractUsageBreakdown = {
        llm_in: BigInt((rateCard.rates as ContractUsageBreakdown).llm_in ?? 0n),
        llm_out: BigInt(
          (rateCard.rates as ContractUsageBreakdown).llm_out ?? 0n,
        ),
        http_calls: BigInt(
          (rateCard.rates as ContractUsageBreakdown).http_calls ?? 0n,
        ),
        runtime_ms: BigInt(
          (rateCard.rates as ContractUsageBreakdown).runtime_ms ?? 0n,
        ),
      };

      const config: AgentConfig = {
        agentId,
        rateVersion,
        rates: normalizedRates,
      };
      setAgentConfig(config);
      return config;
    } catch (error) {
      console.error("Failed to load agent registry config", error);
      throw error instanceof Error
        ? error
        : new Error("Failed to load agent registry config.");
    }
  }, [agentConfig]);

  useEffect(() => {
    if (!hasAddress) {
      setState((previous) => {
        const sanitizedPrev = sanitizeState(previous);
        if (sanitizedPrev.balance === 0 && sanitizedPrev.syncedBalance === 0) {
          return previous;
        }
        const next: SmartWalletPersistence = {
          ...sanitizedPrev,
          balance: 0,
          syncedBalance: 0,
        };
        persist(next);
        return next;
      });
      return;
    }

    if (rawBalance === null) {
      return;
    }

    const nextSyncedBalance = clampCurrency(vaultBalance);
    setState((previous) => {
      const sanitizedPrev = sanitizeState(previous);
      const previousSynced = sanitizedPrev.syncedBalance;
      const delta = roundCurrency(nextSyncedBalance - previousSynced);
      const nextBalance = clampCurrency(sanitizedPrev.balance + delta);
      if (
        delta === 0 &&
        nextBalance === sanitizedPrev.balance &&
        previousSynced === nextSyncedBalance
      ) {
        return previous;
      }
      const next: SmartWalletPersistence = {
        ...sanitizedPrev,
        balance: nextBalance,
        syncedBalance: nextSyncedBalance,
      };
      persist(next);
      return next;
    });
  }, [hasAddress, rawBalance, vaultBalance, persist]);

  const refresh = useCallback(async () => {
    await refreshVaultBalance();
  }, [refreshVaultBalance]);

  const deduct = useCallback<SmartWalletContextValue["deduct"]>(
    async (amount, options) => {
      const requested = clampCurrency(amount);
      if (requested <= 0) {
        return {
          ok: false,
          direction: "debit",
          applied: 0,
          balance: clampCurrency(state.balance),
          requested,
          insufficient: false,
          error: "Charge amount must be greater than zero.",
        };
      }

      if (!address || !signTransaction) {
        return {
          ok: false,
          direction: "debit",
          applied: 0,
          balance: clampCurrency(state.balance),
          requested,
          insufficient: false,
          error: "Connect a wallet that supports transaction signing.",
        };
      }

      try {
        const config = await ensureAgentConfig();
        const requestedUnits = decimalToContractUnits(requested);
        const usageBreakdown = agentUsageToContract(options?.usage);
        const budgets = cloneUsage(usageBreakdown);

        const usageChargeUnits = computeUsageChargeUnits(
          config.rates,
          usageBreakdown,
        );
        const supplementalUnits =
          requestedUnits > usageChargeUnits
            ? requestedUnits - usageChargeUnits
            : 0n;

        if (supplementalUnits > 0n) {
          const { key, rate } = selectSupplementMeter(config.rates);
          if (rate <= 0n) {
            throw new Error(
              "Agent rate card is missing a positive rate to allocate budgets.",
            );
          }
          const extraUnits = divideCeil(supplementalUnits, rate);
          budgets[key] = budgets[key] + extraUnits;
        }

        const chargedUnits = computeUsageChargeUnits(config.rates, budgets);
        const appliedAmount = clampCurrency(
          contractUnitsToDecimal(chargedUnits),
        );

        if (chargedUnits <= 0n || appliedAmount <= 0) {
          return {
            ok: false,
            direction: "debit",
            applied: 0,
            balance: clampCurrency(state.balance),
            requested,
            insufficient: false,
            error: "Unable to compute a positive charge for this run.",
          };
        }

        const vaultClient = createPrepaidVaultClient({
          publicKey: address,
        });

        const tx = await vaultClient.open_run({
          user: address,
          agent_id: config.agentId,
          rate_version: config.rateVersion,
          budgets,
        });

        const needsAdditionalSignatures = (() => {
          try {
            return tx.needsNonInvokerSigningBy().length > 0;
          } catch {
            return false;
          }
        })();

        if (needsAdditionalSignatures) {
          if (!signAuthEntry) {
            throw new Error(
              "Wallet cannot sign authorization entries required for this charge.",
            );
          }
          const passphrase =
            walletNetworkPassphrase ?? defaultNetworkPassphrase ?? "";
          await tx.signAuthEntries({
            address,
            signAuthEntry: (authEntry, opts) =>
              signAuthEntry(authEntry, {
                ...opts,
                address,
                networkPassphrase: passphrase,
              }),
          });
        }

        await tx.signAndSend({
          signTransaction: (xdr, opts) =>
            signTransaction(xdr, {
              ...opts,
              address,
            }),
        });

        const runIdRaw = tx.result;
        const runId =
          typeof runIdRaw === "bigint"
            ? Number(runIdRaw)
            : typeof runIdRaw === "number"
              ? runIdRaw
              : undefined;

        const transactionTimestamp = new Date().toISOString();
        const usageSnapshot = sanitizeUsage(toUsageSnapshot(options?.usage));
        let resultingBalance = clampCurrency(state.balance);

        setState((previous) => {
          const sanitizedPrev = sanitizeState(previous);
          const nextBalance = clampCurrency(
            sanitizedPrev.balance - appliedAmount,
          );
          const nextLifetime = clampCurrency(
            sanitizedPrev.lifetimeSpend + appliedAmount,
          );
          resultingBalance = nextBalance;
          const transaction: SmartWalletTransaction = {
            id: generateId("txn"),
            direction: "debit",
            amount: appliedAmount,
            timestamp: transactionTimestamp,
            reason: options?.label,
            runType: options?.runType,
            usage: usageSnapshot,
            balanceAfter: nextBalance,
            requested,
            insufficient: false,
          };

          const transactions = [
            transaction,
            ...sanitizedPrev.transactions,
          ].slice(0, MAX_TRANSACTIONS);

          const nextState: SmartWalletPersistence = {
            ...sanitizedPrev,
            balance: nextBalance,
            lifetimeSpend: nextLifetime,
            transactions,
          };
          persist(nextState);
          return nextState;
        });

        void refresh();

        return {
          ok: true,
          direction: "debit",
          applied: appliedAmount,
          balance: resultingBalance,
          requested,
          insufficient: false,
          runId,
        };
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to charge smart wallet.";
        const insufficient =
          /#5\b|InsufficientBalance/i.test(message) ||
          /insufficient balance/i.test(message);

        if (!insufficient) {
          console.error("Smart wallet charge failed", error);
        }

        return {
          ok: false,
          direction: "debit",
          applied: 0,
          balance: clampCurrency(state.balance),
          requested,
          insufficient,
          error: message,
        };
      }
    },
    [
      address,
      ensureAgentConfig,
      persist,
      refresh,
      signAuthEntry,
      signTransaction,
      state.balance,
      walletNetworkPassphrase,
    ],
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
      reset,
      refresh,
    }),
    [balance, lifetimeSpend, transactions, deduct, reset, refresh],
  );

  return (
    <SmartWalletContext value={contextValue}>{children}</SmartWalletContext>
  );
};
