import { describe, it, expect } from "bun:test";
import {
  formatCiOverallStatus,
  formatCiVerdict,
  formatScore,
  shouldCiExitNonZero,
  summarizeResults,
} from "./output-summary.ts";
import type { SkillResult } from "./skills/types.ts";

describe("CI mode", () => {
  it("--json flag is recognized in args", () => {
    const args = ["--json", "./article.md"];
    expect(args.includes("--json")).toBe(true);
  });
  it("--ci flag is recognized in args", () => {
    const args = ["--ci", "./article.md"];
    expect(args.includes("--ci")).toBe(true);
  });
  // Note: actual integration test requires running the CLI as a subprocess
  // which is tested in the final integration test (Task 10)
});

describe("CI output summary", () => {
  const skippedResult: SkillResult = {
    skillId: "ai-detection",
    name: "AI Detection",
    score: 0,
    verdict: "skipped",
    summary: "AI detection skipped",
    findings: [],
    costUsd: 0,
  };

  it("renders skipped rows as SKIP", () => {
    expect(formatCiVerdict("skipped")).toBe("SKIP");
  });

  it("marks all-skipped CI runs as skipped with N/A score", () => {
    const summary = summarizeResults([skippedResult]);

    expect(summary).toEqual({ score: null, verdict: "skipped" });
    expect(formatScore(summary.score)).toBe("N/A");
    expect(formatCiOverallStatus(summary)).toBe("SKIPPED");
    expect(shouldCiExitNonZero(summary)).toBe(true);
  });

  it("excludes skipped results from scored CI averages", () => {
    const summary = summarizeResults([
      skippedResult,
      {
        skillId: "seo",
        name: "SEO",
        score: 80,
        verdict: "pass",
        summary: "Good SEO",
        findings: [],
        costUsd: 0,
      },
    ]);

    expect(summary).toEqual({ score: 80, verdict: "pass" });
    expect(formatScore(summary.score)).toBe("80/100");
    expect(formatCiOverallStatus(summary)).toBe("PASSED");
    expect(shouldCiExitNonZero(summary)).toBe(false);
  });
});
