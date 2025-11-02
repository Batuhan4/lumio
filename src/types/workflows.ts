export type WorkflowNodeKind =
  | "http"
  | "stellar-account"
  | "gemini"
  | "classifier"
  | "conditional"
  | "ipfs";

export type StellarNetwork = "PUBLIC" | "TESTNET" | "FUTURENET" | "LOCAL";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";

export type HttpKeyValue = {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
};

export type HttpAuthConfig =
  | { type: "none" }
  | { type: "basic"; username: string; password: string }
  | { type: "bearer"; token: string };

export type HttpPreview = {
  executedAt: string;
  request: {
    method: HttpMethod;
    url: string;
  };
  response?: {
    status: number;
    ok: boolean;
    durationMs: number;
    headers: Array<{ key: string; value: string }>;
    bodyText: string;
    bodyJson?: unknown;
  };
  error?: string;
  usage: {
    httpCalls: number;
    runtimeMs: number;
  };
};

export type HttpNodeConfig = {
  method: HttpMethod;
  url: string;
  queryParams: HttpKeyValue[];
  headers: HttpKeyValue[];
  bodyTemplate: string;
  bodyMimeType: "application/json" | "text/plain";
  auth: HttpAuthConfig;
  timeoutMs: number;
  inputVariables: string[];
  testInputs: Record<string, string>;
  lastPreview?: HttpPreview;
};

export type GeminiNodeConfig = {
  model: string;
  systemInstruction: string;
  promptTemplate: string;
  temperature: number;
  topP: number;
  topK: number;
  maxOutputTokens?: number;
  responseMimeType?: "text/plain" | "application/json";
  inputVariables: string[];
  testInputs: Record<string, string>;
  lastPreview?: {
    executedAt: string;
    outputText?: string;
    responseMimeType?: string;
    usage?: {
      promptTokens?: number;
      responseTokens?: number;
      totalTokens?: number;
    };
  };
};

export type WorkflowNodeConfigMap = {
  gemini: GeminiNodeConfig;
  http: HttpNodeConfig;
  "stellar-account": StellarAccountNodeConfig;
  classifier: Record<string, never>;
  conditional: Record<string, never>;
  ipfs: Record<string, never>;
};

export type StellarAccountNodeConfig = {
  accountId: string;
  network: StellarNetwork;
  horizonUrl: string;
  paymentsLimit: number;
  includeFailed: boolean;
  lastPreview?: StellarAccountPreview;
};

export type StellarAccountPreview = {
  executedAt: string;
  accountId: string;
  network: StellarNetwork;
  horizonUrl: string;
  balances?: unknown;
  payments?: unknown;
  error?: string;
};

export type WorkflowNode<K extends WorkflowNodeKind = WorkflowNodeKind> = {
  id: string;
  kind: K;
  title: string;
  description: string;
  position: { x: number; y: number };
  config: WorkflowNodeConfigMap[K];
};

export type WorkflowConnection = {
  id: string;
  from: string;
  to: string;
};

export type WorkflowDefinition = {
  id: string;
  label: string;
  createdAt: string;
  updatedAt: string;
  nodes: WorkflowNode[];
  connections: WorkflowConnection[];
};

export type WorkflowDraftState = {
  activeWorkflowId: string | null;
  workflows: Record<string, WorkflowDefinition>;
};

export const DEFAULT_GEMINI_CONFIG: GeminiNodeConfig = {
  model: "gemini-2.0-flash",
  systemInstruction: "",
  promptTemplate: "Summarize the following input:\n\n{{input}}",
  temperature: 0.6,
  topP: 0.95,
  topK: 40,
  maxOutputTokens: 2048,
  responseMimeType: "text/plain",
  inputVariables: ["input"],
  testInputs: {
    input:
      "Lumio escrows the max charge for each agent run, then refunds the unused amount automatically.",
  },
};

export const DEFAULT_HTTP_CONFIG: HttpNodeConfig = {
  method: "GET",
  url: "https://postman-echo.com/get",
  queryParams: [],
  headers: [],
  bodyTemplate: "",
  bodyMimeType: "application/json",
  auth: { type: "none" },
  timeoutMs: 10000,
  inputVariables: [],
  testInputs: {},
};

export const DEFAULT_STELLAR_ACCOUNT_CONFIG: StellarAccountNodeConfig = {
  accountId: "",
  network: "PUBLIC",
  horizonUrl: "",
  paymentsLimit: 20,
  includeFailed: false,
};

export const EMPTY_WORKFLOW_STATE: WorkflowDraftState = {
  activeWorkflowId: null,
  workflows: {},
};
