import type { Config } from "../config.ts";

export interface FactAuditConfig {
  standardMaxClaims?: number;
  deepMaxClaims?: number;
  maxUsd?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxProviderCalls?: number;
  maxWallClockMs?: number;
  maxConcurrency?: number;
  maxProviderRetries?: number;
  maxProviderFailures?: number;
}

export interface AuditBudget {
  maxClaims: number;
  maxUsd: number;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxProviderCalls: number;
  maxWallClockMs: number;
  maxConcurrency: number;
  maxProviderRetries: number;
  maxProviderFailures: number;
}

export interface AuditBudgetUsage {
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  providerCalls?: number;
  wallClockMs?: number;
  providerRetries?: number;
  providerFailures?: number;
}

export type AuditBudgetStopReason =
  | "claim_cap"
  | "provider_call_budget"
  | "cost_budget"
  | "input_token_budget"
  | "output_token_budget"
  | "wall_clock_budget"
  | "provider_retry_budget"
  | "provider_failure_budget";

export interface SelectedAuditClaims {
  checkedClaims: string[];
  skippedClaims: Array<{ claim: string; skipReason: AuditBudgetStopReason }>;
  budgetStopReason?: AuditBudgetStopReason;
}

const DEFAULT_FACT_AUDIT: Required<FactAuditConfig> = {
  standardMaxClaims: 4,
  deepMaxClaims: 80,
  maxUsd: 2,
  maxInputTokens: 120_000,
  maxOutputTokens: 24_000,
  maxProviderCalls: 80,
  maxWallClockMs: 120_000,
  maxConcurrency: 4,
  maxProviderRetries: 2,
  maxProviderFailures: 5,
};

export function createAuditBudget(config: Pick<Config, "factAudit">, tier: "standard" | "premium" | "basic" = "standard"): AuditBudget {
  const factAudit = { ...DEFAULT_FACT_AUDIT, ...(config.factAudit ?? {}) };
  return {
    maxClaims: tier === "premium" ? factAudit.deepMaxClaims : factAudit.standardMaxClaims,
    maxUsd: factAudit.maxUsd,
    maxInputTokens: factAudit.maxInputTokens,
    maxOutputTokens: factAudit.maxOutputTokens,
    maxProviderCalls: factAudit.maxProviderCalls,
    maxWallClockMs: factAudit.maxWallClockMs,
    maxConcurrency: factAudit.maxConcurrency,
    maxProviderRetries: factAudit.maxProviderRetries,
    maxProviderFailures: factAudit.maxProviderFailures,
  };
}

export function selectClaimsForAudit(claims: string[], budget: AuditBudget): SelectedAuditClaims {
  const zeroBudgetStopReason = getZeroBudgetStopReason(budget);
  if (zeroBudgetStopReason) {
    return {
      checkedClaims: [],
      skippedClaims: claims.map((claim) => ({ claim, skipReason: zeroBudgetStopReason })),
      budgetStopReason: claims.length ? zeroBudgetStopReason : undefined,
    };
  }
  const claimCap = Math.max(0, Math.floor(budget.maxClaims));
  const providerCallCap = Math.max(0, Math.floor(budget.maxProviderCalls));
  const maxChecked = Math.min(claimCap, providerCallCap, claims.length);
  const checkedClaims = claims.slice(0, maxChecked);
  const budgetStopReason: AuditBudgetStopReason | undefined = claims.length > maxChecked
    ? providerCallCap < claimCap
      ? "provider_call_budget"
      : "claim_cap"
    : undefined;
  const skippedClaims = budgetStopReason
    ? claims.slice(maxChecked).map((claim) => ({ claim, skipReason: budgetStopReason }))
    : [];

  return { checkedClaims, skippedClaims, budgetStopReason };
}

function getZeroBudgetStopReason(budget: AuditBudget): AuditBudgetStopReason | undefined {
  if (budget.maxUsd <= 0) return "cost_budget";
  if (budget.maxInputTokens <= 0) return "input_token_budget";
  if (budget.maxOutputTokens <= 0) return "output_token_budget";
  if (budget.maxWallClockMs <= 0) return "wall_clock_budget";
  if (budget.maxProviderRetries <= 0) return "provider_retry_budget";
  if (budget.maxProviderFailures <= 0) return "provider_failure_budget";
  return undefined;
}

export function shouldStopForBudget(budget: AuditBudget, usage: AuditBudgetUsage): keyof AuditBudget | null {
  if ((usage.costUsd ?? 0) >= budget.maxUsd) return "maxUsd";
  if ((usage.inputTokens ?? 0) >= budget.maxInputTokens) return "maxInputTokens";
  if ((usage.outputTokens ?? 0) >= budget.maxOutputTokens) return "maxOutputTokens";
  if ((usage.providerCalls ?? 0) >= budget.maxProviderCalls) return "maxProviderCalls";
  if ((usage.wallClockMs ?? 0) >= budget.maxWallClockMs) return "maxWallClockMs";
  if ((usage.providerRetries ?? 0) >= budget.maxProviderRetries) return "maxProviderRetries";
  if ((usage.providerFailures ?? 0) >= budget.maxProviderFailures) return "maxProviderFailures";
  return null;
}
