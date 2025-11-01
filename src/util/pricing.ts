import type { AgentBudgets, AgentRateCard } from "../data/mock";

export const computeMaxCharge = (
  budgets: AgentBudgets,
  rates: AgentRateCard[],
) =>
  rates.reduce((acc, rate) => {
    const budgetValue = budgets[rate.key] ?? 0;
    const normalizedUnits = budgetValue / rate.unitSize;
    return acc + normalizedUnits * rate.rate;
  }, 0);

export const metersInDisplayOrder: AgentRateCard["key"][] = [
  "llmInTokens",
  "llmOutTokens",
  "httpCalls",
  "runtimeMs",
];
