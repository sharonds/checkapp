import { describe, expect, test } from "bun:test";
import { buildAuditCoverage } from "./coverage.ts";

describe("AuditCoverage", () => {
  test("aggregates exact coverage counts and skip reasons", () => {
    const coverage = buildAuditCoverage({
      wordsScanned: 100,
      sectionsDetected: 2,
      paragraphsScanned: 4,
      sentencesScanned: 8,
      claimDecisions: [
        { claimId: "c1", decision: "checked" },
        { claimId: "c2", decision: "skipped", skipReason: "tier_cap" },
        { claimId: "c3", decision: "skipped", skipReason: "subjective" },
      ],
      plagiarismPassages: [
        { id: "p1", decision: "checked" },
        { id: "p2", decision: "skipped", skipReason: "tier_cap" },
      ],
      providerAttempts: [
        { id: "a1", provider: "fake", status: "retry" },
        { id: "a2", provider: "fake", status: "failed" },
      ],
      budgetStopReason: "maxProviderCalls",
    });

    expect(coverage.claimsExtracted).toBe(3);
    expect(coverage.claimsChecked).toBe(1);
    expect(coverage.claimsSkipped).toBe(2);
    expect(coverage.skipReasons).toEqual({ subjective: 1, tier_cap: 2 });
    expect(coverage.plagiarismPassagesChecked).toBe(1);
    expect(coverage.plagiarismPassagesSkipped).toBe(1);
    expect(coverage.providerRetries).toBe(1);
    expect(coverage.providerFailures).toBe(1);
    expect(coverage.budgetStopReason).toBe("maxProviderCalls");
  });

  test("does not double-count claim skip reasons when plagiarism uses the same reason", () => {
    const coverage = buildAuditCoverage({
      wordsScanned: 10,
      sectionsDetected: 1,
      paragraphsScanned: 1,
      sentencesScanned: 1,
      claimDecisions: [{ claimId: "c1", decision: "skipped", skipReason: "tier_cap" }],
      plagiarismPassages: [{ id: "p1", decision: "skipped", skipReason: "tier_cap" }],
    });

    expect(coverage.skipReasons).toEqual({ tier_cap: 2 });
  });
});
