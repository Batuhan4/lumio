export type AgentMeterKey =
  | "llmInTokens"
  | "llmOutTokens"
  | "httpCalls"
  | "runtimeMs";

export type AgentRateCard = {
  key: AgentMeterKey;
  label: string;
  unit: string;
  unitSize: number;
  rate: number;
};

export type AgentBudgets = Record<AgentMeterKey, number>;

export type AgentDefinition = {
  id: string;
  name: string;
  headline: string;
  description: string;
  developer: string;
  categories: string[];
  refundRate: number;
  successRate: number;
  runsLast24h: number;
  avgLatencySeconds: number;
  defaultBudgets: AgentBudgets;
  rateCard: AgentRateCard[];
  lastUpdated: string;
};

export type WalletPolicyState = {
  balance: number;
  reserved: number;
  dailyCap: number;
  perRunCap: number;
  paused: boolean;
  pendingWithdrawals: number;
};

export type ScheduledRun = {
  id: string;
  agentId: string;
  label: string;
  cadence: "Hourly" | "Daily" | "Weekly";
  nextRunAt: string;
  budget: number;
};

export type RunStatus = "completed" | "refunded" | "cancelled" | "running";

export type RunReceipt = {
  id: string;
  agentId: string;
  agentName: string;
  startedAt: string;
  finalizedAt: string;
  maxCharge: number;
  actualCharge: number;
  refundAmount: number;
  status: RunStatus;
  txHash: string;
  outputCid: string;
};

export const MOCK_AGENTS: AgentDefinition[] = [
  {
    id: "web-summarizer",
    name: "Web Summarizer",
    headline: "Digest any URL with refund-friendly usage caps.",
    description:
      "Fetches and summarizes long-form articles into three punchy sections with citations. Built to keep costs predictable for analysts shipping daily briefs.",
    developer: "Aurora Labs",
    categories: ["Research", "Summaries"],
    refundRate: 0.58,
    successRate: 0.97,
    runsLast24h: 124,
    avgLatencySeconds: 38,
    defaultBudgets: {
      llmInTokens: 3000,
      llmOutTokens: 1200,
      httpCalls: 3,
      runtimeMs: 120000,
    },
    rateCard: [
      {
        key: "llmInTokens",
        label: "LLM input",
        unit: "per 1K tokens",
        unitSize: 1000,
        rate: 0.00045,
      },
      {
        key: "llmOutTokens",
        label: "LLM output",
        unit: "per 1K tokens",
        unitSize: 1000,
        rate: 0.0006,
      },
      {
        key: "httpCalls",
        label: "HTTP requests",
        unit: "per call",
        unitSize: 1,
        rate: 0.002,
      },
      {
        key: "runtimeMs",
        label: "Runtime",
        unit: "per 1K ms",
        unitSize: 1000,
        rate: 0.0001,
      },
    ],
    lastUpdated: "2025-01-15T14:22:00Z",
  },
  {
    id: "rss-digest",
    name: "RSS Digest",
    headline: "Scheduled feed digests delivered to your inbox.",
    description:
      "Monitors up to 25 RSS feeds, clusters similar stories, and sends a digest that fits in one screen. Built for teams that need reliable, low-latency updates.",
    developer: "Orbit Ops",
    categories: ["Automation", "News"],
    refundRate: 0.64,
    successRate: 0.94,
    runsLast24h: 209,
    avgLatencySeconds: 55,
    defaultBudgets: {
      llmInTokens: 2000,
      llmOutTokens: 800,
      httpCalls: 12,
      runtimeMs: 150000,
    },
    rateCard: [
      {
        key: "llmInTokens",
        label: "LLM input",
        unit: "per 1K tokens",
        unitSize: 1000,
        rate: 0.0004,
      },
      {
        key: "llmOutTokens",
        label: "LLM output",
        unit: "per 1K tokens",
        unitSize: 1000,
        rate: 0.00055,
      },
      {
        key: "httpCalls",
        label: "HTTP requests",
        unit: "per call",
        unitSize: 1,
        rate: 0.0015,
      },
      {
        key: "runtimeMs",
        label: "Runtime",
        unit: "per 1K ms",
        unitSize: 1000,
        rate: 0.00009,
      },
    ],
    lastUpdated: "2025-01-12T09:10:00Z",
  },
  {
    id: "compliance-watch",
    name: "Compliance Watch",
    headline: "Scan wallet activity against sanction lists.",
    description:
      "Runs nightly AML checks using public watchlists and heuristics. Designed for fintechs that need affordable, transparent compliance automation.",
    developer: "Signal Vault",
    categories: ["Compliance", "Automation"],
    refundRate: 0.42,
    successRate: 0.99,
    runsLast24h: 47,
    avgLatencySeconds: 73,
    defaultBudgets: {
      llmInTokens: 1000,
      llmOutTokens: 400,
      httpCalls: 6,
      runtimeMs: 220000,
    },
    rateCard: [
      {
        key: "llmInTokens",
        label: "LLM input",
        unit: "per 1K tokens",
        unitSize: 1000,
        rate: 0.00035,
      },
      {
        key: "llmOutTokens",
        label: "LLM output",
        unit: "per 1K tokens",
        unitSize: 1000,
        rate: 0.0005,
      },
      {
        key: "httpCalls",
        label: "HTTP requests",
        unit: "per call",
        unitSize: 1,
        rate: 0.0035,
      },
      {
        key: "runtimeMs",
        label: "Runtime",
        unit: "per 1K ms",
        unitSize: 1000,
        rate: 0.00012,
      },
    ],
    lastUpdated: "2024-12-28T19:05:00Z",
  },
];

export const MOCK_WALLET_POLICY: WalletPolicyState = {
  balance: 128.4,
  reserved: 12.75,
  dailyCap: 50,
  perRunCap: 5,
  paused: false,
  pendingWithdrawals: 6.5,
};

export const MOCK_SCHEDULES: ScheduledRun[] = [
  {
    id: "sched-001",
    agentId: "rss-digest",
    label: "Market open digest",
    cadence: "Hourly",
    nextRunAt: "2025-02-14T13:00:00Z",
    budget: 2.5,
  },
  {
    id: "sched-002",
    agentId: "compliance-watch",
    label: "Nightly compliance sweep",
    cadence: "Daily",
    nextRunAt: "2025-02-15T01:00:00Z",
    budget: 3.75,
  },
];

export const MOCK_RUN_HISTORY: RunReceipt[] = [
  {
    id: "run-1042",
    agentId: "web-summarizer",
    agentName: "Web Summarizer",
    startedAt: "2025-02-14T15:15:00Z",
    finalizedAt: "2025-02-14T15:15:46Z",
    maxCharge: 2,
    actualCharge: 0.83,
    refundAmount: 1.17,
    status: "completed",
    txHash: "5678abcd",
    outputCid: "bafybeigdyr24",
  },
  {
    id: "run-1041",
    agentId: "rss-digest",
    agentName: "RSS Digest",
    startedAt: "2025-02-14T13:00:00Z",
    finalizedAt: "2025-02-14T13:01:12Z",
    maxCharge: 3,
    actualCharge: 2.12,
    refundAmount: 0.88,
    status: "completed",
    txHash: "9abc23de",
    outputCid: "bafybeibwxyz0",
  },
  {
    id: "run-1038",
    agentId: "compliance-watch",
    agentName: "Compliance Watch",
    startedAt: "2025-02-13T23:00:00Z",
    finalizedAt: "2025-02-13T23:02:17Z",
    maxCharge: 4,
    actualCharge: 3.45,
    refundAmount: 0.55,
    status: "completed",
    txHash: "12fe54ba",
    outputCid: "bafybeifinal12",
  },
  {
    id: "run-1035",
    agentId: "web-summarizer",
    agentName: "Web Summarizer",
    startedAt: "2025-02-13T17:22:00Z",
    finalizedAt: "2025-02-13T17:22:38Z",
    maxCharge: 2,
    actualCharge: 0.95,
    refundAmount: 1.05,
    status: "refunded",
    txHash: "7834cbaa",
    outputCid: "bafybeisummary34",
  },
];
