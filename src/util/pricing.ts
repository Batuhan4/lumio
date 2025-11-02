import type { AgentBudgets, AgentMeterKey, AgentRateCard } from "../data/mock";

const safeNumber = (value: number | undefined) =>
  Number.isFinite(value) ? (value as number) : 0;

const normalizeUnits = (value: number, unitSize: number) =>
  unitSize > 0 ? value / unitSize : 0;

export type AgentUsage = Record<AgentMeterKey, number>;

export const createEmptyUsage = (): AgentUsage => ({
  llmInTokens: 0,
  llmOutTokens: 0,
  httpCalls: 0,
  runtimeMs: 0,
});

export const computeMaxCharge = (
  budgets: AgentBudgets,
  rates: AgentRateCard[],
) =>
  rates.reduce((acc, rate) => {
    const budgetValue = safeNumber(budgets[rate.key]);
    const normalizedUnits = normalizeUnits(budgetValue, rate.unitSize);
    return acc + normalizedUnits * rate.rate;
  }, 0);

export const computeUsageCharge = (usage: AgentUsage, rates: AgentRateCard[]) =>
  rates.reduce((acc, rate) => {
    const usageValue = safeNumber(usage[rate.key]);
    const normalizedUnits = normalizeUnits(usageValue, rate.unitSize);
    return acc + normalizedUnits * rate.rate;
  }, 0);

export const metersInDisplayOrder: AgentRateCard["key"][] = [
  "llmInTokens",
  "llmOutTokens",
  "httpCalls",
  "runtimeMs",
];

export const PLATFORM_FEE = 0.01;

export const DEFAULT_RATE_CARD: AgentRateCard[] = [
  {
    key: "llmInTokens",
    label: "LLM input",
    unit: "per 1K tokens",
    unitSize: 1000,
    rate: 0.000125,
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
    rate: 0.002,
  },
  {
    key: "runtimeMs",
    label: "Runtime",
    unit: "per 1K ms",
    unitSize: 1000,
    rate: 0.0001,
  },
];
