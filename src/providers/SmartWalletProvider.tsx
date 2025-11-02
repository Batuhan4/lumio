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
import { enqueueRunnerRun, listRunnerRuns } from "../services/runner";
import type { RunnerRun } from "../services/runner";

const STORAGE_KEY = "smartWallet";
const MAX_TRANSACTIONS = 50;
const PRECISION_FACTOR = 1_000_000;
const DEFAULT_AGENT_ID = 1;
const RUNNER_PUBLIC_KEY =
  (import.meta.env.VITE_RUNNER_PUBLIC_KEY as string | undefined) ?? undefined;
const RUNNER_POLL_INTERVAL = 5_000;

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

const FALLBACK_CONTRACT_RATES: ContractUsageBreakdown = {
  llm_in: 10_000n,
  llm_out: 20_000n,
  http_calls: 10_000_000n,
  runtime_ms: 1n,
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

const toBigIntSafe = (value: unknown): bigint => {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return 0n;
    }
    try {
      return BigInt(trimmed);
    } catch {
      return 0n;
    }
  }
  return 0n;
};

const generateId = (prefix: string) =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;

const interpretVaultError = (error: unknown) => {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Failed to charge smart wallet.";

  const insufficient =
    /#5\b|InsufficientBalance/i.test(message) ||
    /insufficient balance/i.test(message);

  if (/#2\b|NotInitialized/i.test(message)) {
    return {
      message:
        "Smart wallet contract is not initialized. Deploy the PrepaidVault contract and call init with the AgentRegistry address before running charges.",
      insufficient: false,
    };
  }

  if (/Network mismatch/i.test(message) || /connect EPERM/i.test(message)) {
    return {
      message:
        "Unable to reach the Soroban RPC endpoint. Ensure the local network is running and accessible at the configured RPC URL.",
      insufficient: false,
    };
  }

  return { message, insufficient };
};

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
  workflowId?: string;
  metadata?: Record<string, unknown>;
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
  runners: string[];
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
  const { address } = useWallet();
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
      const parsedVersion =
        typeof rawVersion === "bigint"
          ? Number(rawVersion)
          : typeof rawVersion === "number"
            ? rawVersion
            : NaN;
      const rateVersion =
        Number.isFinite(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1;

      const rateCardTx = await registryClient.get_rate_card({
        agent_id: agentId,
        version: rateVersion,
      });
      const rateCard = rateCardTx.result;
      if (!rateCard) {
        throw new Error("Rate card unavailable.");
      }
      const rawRatesCandidate =
        (rateCard as { rates?: unknown }).rates ??
        (rateCard as unknown as Record<string, unknown>)["rates"];
      const ratesObject =
        rawRatesCandidate && typeof rawRatesCandidate === "object"
          ? (rawRatesCandidate as unknown as Record<string, unknown>)
          : {};
      const normalizedRates: ContractUsageBreakdown = {
        llm_in: toBigIntSafe(ratesObject.llm_in ?? ratesObject.llmIn ?? 0n),
        llm_out: toBigIntSafe(ratesObject.llm_out ?? ratesObject.llmOut ?? 0n),
        http_calls: toBigIntSafe(
          ratesObject.http_calls ?? ratesObject.httpCalls ?? 0n,
        ),
        runtime_ms: toBigIntSafe(
          ratesObject.runtime_ms ?? ratesObject.runtimeMs ?? 0n,
        ),
      };
      const hasPositiveRate = USAGE_METERS.some(
        (key) => normalizedRates[key] > 0n,
      );

      const effectiveRates = hasPositiveRate
        ? normalizedRates
        : FALLBACK_CONTRACT_RATES;

      if (!hasPositiveRate) {
        console.warn(
          "Agent registry returned zeroed rates; falling back to defaults.",
        );
      }

      const agentDetailsTx = await registryClient.get_agent({
        agent_id: agentId,
      });
      const agentDetails = agentDetailsTx.result as
        | { runners?: unknown }
        | undefined;
      const rawRunners = agentDetails?.runners;
      const runners = Array.isArray(rawRunners)
        ? rawRunners.map((runner) => String(runner))
        : [];

      const config: AgentConfig = {
        agentId,
        rateVersion,
        rates: effectiveRates,
        runners,
      };
      setAgentConfig(config);
      return config;
    } catch (error) {
      console.error("Failed to load agent registry config", error);
      const fallbackConfig: AgentConfig = {
        agentId,
        rateVersion: 1,
        rates: FALLBACK_CONTRACT_RATES,
        runners: RUNNER_PUBLIC_KEY ? [RUNNER_PUBLIC_KEY] : [],
      };
      setAgentConfig(fallbackConfig);
      return fallbackConfig;
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

  useEffect(() => {
    if (!hasAddress) {
      return;
    }

    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const pollRunner = async () => {
      try {
        const runs = await listRunnerRuns();
        if (cancelled) {
          return;
        }
        let shouldSync = false;
        setState((previous) => {
          const sanitizedPrev = sanitizeState(previous);
          if (sanitizedPrev.transactions.length === 0) {
            return previous;
          }
          const byId = new Map<string, RunnerRun>(
            runs.map((run) => [run.id, run]),
          );
          let mutated = false;
          const nextTransactions = sanitizedPrev.transactions.map((txn) => {
            if (!txn.runnerRequestId) {
              return txn;
            }
            const run = byId.get(txn.runnerRequestId);
            if (!run) {
              return txn;
            }
            const nextStatus = run.status;
            const candidateContractId =
              typeof run.runId === "number" ? run.runId : run.receipt?.runId;
            const resolvedContractId =
              typeof candidateContractId === "number"
                ? candidateContractId
                : txn.contractRunId;
            if (
              txn.status === nextStatus &&
              txn.contractRunId === resolvedContractId
            ) {
              return txn;
            }
            mutated = true;
            if (
              nextStatus &&
              (nextStatus === "finalized" || nextStatus === "failed") &&
              txn.status !== nextStatus
            ) {
              shouldSync = true;
            }
            return {
              ...txn,
              status: nextStatus,
              contractRunId: resolvedContractId,
            };
          });

          if (!mutated) {
            return previous;
          }

          const nextState: SmartWalletPersistence = {
            ...sanitizedPrev,
            transactions: nextTransactions,
          };
          persist(nextState);
          return nextState;
        });

        if (shouldSync) {
          void refreshVaultBalance();
          void refresh();
        }
      } catch (error) {
        console.error("Failed to poll runner service", error);
      } finally {
        if (!cancelled) {
          timeout = setTimeout(() => {
            void pollRunner();
          }, RUNNER_POLL_INTERVAL);
        }
      }
    };

    void pollRunner();

    return () => {
      cancelled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
    };
  }, [hasAddress, persist, refresh, refreshVaultBalance]);

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

      if (!address) {
        return {
          ok: false,
          direction: "debit",
          applied: 0,
          balance: clampCurrency(state.balance),
          requested,
          insufficient: false,
          error: "Connect a wallet before executing this workflow.",
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

        const runnerAddress =
          RUNNER_PUBLIC_KEY ?? config.runners[0] ?? undefined;

        if (!runnerAddress) {
          throw new Error(
            "No runner service is registered for this agent. Ask the developer to configure a runner.",
          );
        }

        const vaultClient = createPrepaidVaultClient();
        const authorizationTx = await vaultClient.is_runner_authorized({
          user: address,
          runner: runnerAddress,
          agent_id: config.agentId,
        });
        const runnerAuthorized = Boolean(authorizationTx.result);

        if (!runnerAuthorized) {
          throw new Error(
            "Authorize the runner service from the Wallet page before executing this workflow.",
          );
        }

        const runnerRun = await enqueueRunnerRun({
          user: address,
          agentId: config.agentId,
          rateVersion: config.rateVersion,
          budgets: {
            llmIn: Number(budgets.llm_in),
            llmOut: Number(budgets.llm_out),
            httpCalls: Number(budgets.http_calls),
            runtimeMs: Number(budgets.runtime_ms),
          },
          workflowId: options?.workflowId,
          label: options?.label,
          metadata: options?.metadata,
        });

        const runId = runnerRun.runId;

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
            runnerRequestId: runnerRun.id,
            contractRunId: typeof runId === "number" ? runId : undefined,
            status: runnerRun.status,
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
        const { message, insufficient } = interpretVaultError(error);

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
    [address, ensureAgentConfig, persist, refresh, state.balance],
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
