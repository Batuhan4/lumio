export type UsageBudget = {
  llmIn: number;
  llmOut: number;
  httpCalls: number;
  runtimeMs: number;
};

export type RunnerRequest = {
  user: string;
  agentId: number;
  rateVersion?: number;
  budgets: UsageBudget;
  workflowId?: string;
  metadata?: Record<string, unknown>;
  label?: string;
};

export type RunnerRunStatus =
  | "pending"
  | "opening"
  | "running"
  | "finalizing"
  | "finalized"
  | "failed";

export type RunnerTransactionHashes = {
  open?: string;
  finalize?: string;
};

export type RunnerReceipt = {
  runId: number;
  actualCharge: string;
  refund: string;
  developer: string;
  outputHash?: string;
  finalizedAt?: string;
};

export type RunnerRun = RunnerRequest & {
  id: string;
  runId?: number;
  retries: number;
  status: RunnerRunStatus;
  usage?: UsageBudget;
  outputHash?: string;
  receipt?: RunnerReceipt;
  error?: string;
  transactionHashes?: RunnerTransactionHashes;
  createdAt: string;
  updatedAt: string;
};

export type RunnerStatusSnapshot = {
  activeRunId?: string;
  queueDepth: number;
  lastTickAt?: string;
};

export type RunnerSummary = {
  config: {
    runner: string;
    contractId: string;
    networkPassphrase: string;
    rpcUrl: string;
    agentRegistryId: string;
    pollIntervalMs: number;
  };
  status: RunnerStatusSnapshot;
};
