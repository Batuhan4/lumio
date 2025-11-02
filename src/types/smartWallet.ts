import type { AgentMeterKey } from "../data/mock";

export type SmartWalletUsageSnapshot = Partial<Record<AgentMeterKey, number>>;

export type SmartWalletTransaction = {
  id: string;
  direction: "debit" | "credit";
  amount: number;
  timestamp: string;
  reason?: string;
  runType?: "preview" | "run";
  usage?: SmartWalletUsageSnapshot;
  balanceAfter: number;
  requested?: number;
  insufficient?: boolean;
  runnerRequestId?: string;
  contractRunId?: number;
  status?:
    | "pending"
    | "opening"
    | "running"
    | "finalizing"
    | "finalized"
    | "failed";
};

export type SmartWalletPersistence = {
  balance: number;
  syncedBalance: number;
  lifetimeSpend: number;
  transactions: SmartWalletTransaction[];
};

export const SMART_WALLET_DEFAULT_STATE: SmartWalletPersistence = {
  balance: 0,
  syncedBalance: 0,
  lifetimeSpend: 0,
  transactions: [],
};
