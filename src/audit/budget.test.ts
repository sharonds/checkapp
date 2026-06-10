import { describe, expect, test } from "bun:test";
import { createAuditBudget, selectClaimsForAudit, shouldStopForBudget } from "./budget.ts";

describe("audit budget", () => {
  test("keeps Standard default at the current low-cost four-claim cap", () => {
    const budget = createAuditBudget({} as any, "standard");
    expect(budget.maxClaims).toBe(4);
  });

  test("applies Standard defaults and config overrides", () => {
    const budget = createAuditBudget({
      factAudit: { standardMaxClaims: 12, maxProviderRetries: 1 },
    } as any, "standard");
    expect(budget.maxClaims).toBe(12);
    expect(budget.maxProviderRetries).toBe(1);
    expect(budget.maxProviderCalls).toBeGreaterThan(0);
  });

  test("keeps Deep Audit cap separate for follow-up tier compatibility", () => {
    const budget = createAuditBudget({
      factAudit: { standardMaxClaims: 12, deepMaxClaims: 60 },
    } as any, "premium");
    expect(budget.maxClaims).toBe(60);
  });

  test("selects checked and skipped claims with a claim-cap stop reason", () => {
    const budget = createAuditBudget({
      factAudit: { standardMaxClaims: 2, maxProviderCalls: 10 },
    } as any, "standard");
    const selected = selectClaimsForAudit(["one", "two", "three"], budget);

    expect(selected.checkedClaims).toEqual(["one", "two"]);
    expect(selected.skippedClaims).toEqual([{ claim: "three", skipReason: "claim_cap" }]);
    expect(selected.budgetStopReason).toBe("claim_cap");
  });

  test("provider-call budget can stop claim selection before the claim cap", () => {
    const budget = createAuditBudget({
      factAudit: { standardMaxClaims: 4, maxProviderCalls: 2 },
    } as any, "standard");
    const selected = selectClaimsForAudit(["one", "two", "three"], budget);

    expect(selected.checkedClaims).toEqual(["one", "two"]);
    expect(selected.skippedClaims).toEqual([{ claim: "three", skipReason: "provider_call_budget" }]);
    expect(selected.budgetStopReason).toBe("provider_call_budget");
  });

  test("zero cost budget stops claim selection before provider calls", () => {
    const budget = createAuditBudget({
      factAudit: { standardMaxClaims: 4, maxProviderCalls: 4, maxUsd: 0 },
    } as any, "standard");
    const selected = selectClaimsForAudit(["one", "two"], budget);

    expect(selected.checkedClaims).toEqual([]);
    expect(selected.skippedClaims).toEqual([
      { claim: "one", skipReason: "cost_budget" },
      { claim: "two", skipReason: "cost_budget" },
    ]);
    expect(selected.budgetStopReason).toBe("cost_budget");
  });

  test("returns deterministic stop reasons", () => {
    const budget = createAuditBudget({ factAudit: { maxProviderCalls: 2, maxUsd: 1 } } as any, "standard");
    expect(shouldStopForBudget(budget, { providerCalls: 2, costUsd: 0 })).toBe("maxProviderCalls");
    expect(shouldStopForBudget(budget, { providerCalls: 1, costUsd: 1 })).toBe("maxUsd");
    expect(shouldStopForBudget(budget, { providerCalls: 1, costUsd: 0.5 })).toBeNull();
  });
});
