const resolvedRunnerApiBase =
  typeof import.meta.env.VITE_RUNNER_API_BASE === "string"
    ? import.meta.env.VITE_RUNNER_API_BASE
    : undefined;

const BASE_URL = resolvedRunnerApiBase ?? "http://localhost:4000";

export type RunnerRunStatus =
  | "pending"
  | "opening"
  | "running"
  | "finalizing"
  | "finalized"
  | "failed";

export type RunnerUsageBudget = {
  llmIn: number;
  llmOut: number;
  httpCalls: number;
  runtimeMs: number;
};

export type RunnerRun = {
  id: string;
  user: string;
  agentId: number;
  rateVersion?: number;
  runId?: number;
  retries: number;
  status: RunnerRunStatus;
  budgets: RunnerUsageBudget;
  usage?: RunnerUsageBudget;
  outputHash?: string;
  receipt?: {
    runId: number;
    actualCharge: string;
    refund: string;
    developer: string;
    outputHash?: string;
    finalizedAt?: string;
  };
  error?: string;
  transactionHashes?: {
    open?: string;
    finalize?: string;
  };
  createdAt: string;
  updatedAt: string;
  workflowId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type RunnerRunRequest = {
  user: string;
  agentId: number;
  rateVersion?: number;
  budgets: RunnerUsageBudget;
  workflowId?: string;
  label?: string;
  metadata?: Record<string, unknown>;
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
  status: {
    activeRunId?: string;
    queueDepth: number;
    lastTickAt?: string;
  };
};

const jsonHeaders = {
  "Content-Type": "application/json",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    let message = `Runner request failed with status ${response.status}`;
    try {
      const body: unknown = await response.json();
      if (isRecord(body) && typeof body.error === "string") {
        message = body.error;
      }
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
};

export const enqueueRunnerRun = async (
  request: RunnerRunRequest,
): Promise<RunnerRun> => {
  const response = await fetch(`${BASE_URL}/runs`, {
    method: "POST",
    headers: jsonHeaders,
    body: JSON.stringify(request),
  });
  return handleResponse<RunnerRun>(response);
};

export const listRunnerRuns = async (): Promise<RunnerRun[]> => {
  const response = await fetch(`${BASE_URL}/runs`);
  return handleResponse<RunnerRun[]>(response);
};

export const retryRunnerRun = async (id: string): Promise<RunnerRun> => {
  const response = await fetch(
    `${BASE_URL}/runs/${encodeURIComponent(id)}/retry`,
    {
      method: "POST",
      headers: jsonHeaders,
    },
  );
  return handleResponse<RunnerRun>(response);
};

export const getRunnerSummary = async (): Promise<RunnerSummary> => {
  const response = await fetch(`${BASE_URL}/summary`);
  return handleResponse<RunnerSummary>(response);
};
