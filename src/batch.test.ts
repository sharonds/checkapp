import { describe, it, expect } from "bun:test";
import { discoverArticles, summarizeBatchResults } from "./batch.ts";
import type { SkillResult } from "./skills/types.ts";

describe("discoverArticles", () => {
  it("finds .md and .txt files in demo directory", () => {
    const files = discoverArticles("demo");
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.every((f) => f.endsWith(".md") || f.endsWith(".txt"))
    ).toBe(true);
  });

  it("returns sorted file paths", () => {
    const files = discoverArticles("demo");
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it("returns empty for nonexistent dir", () => {
    expect(discoverArticles("/tmp/nonexistent-xyz-abc")).toEqual([]);
  });

  it("returns empty for a file path (not dir)", () => {
    expect(discoverArticles("package.json")).toEqual([]);
  });
});

describe("summarizeBatchResults", () => {
  const skippedResult: SkillResult = {
    skillId: "ai-detection",
    name: "AI Detection",
    score: 0,
    verdict: "skipped",
    summary: "AI detection skipped",
    findings: [],
    costUsd: 0,
  };

  it("returns skipped and N/A score for all-skipped files", () => {
    expect(summarizeBatchResults([skippedResult])).toEqual({
      score: null,
      verdict: "skipped",
    });
  });

  it("excludes skipped skill results from batch file scoring", () => {
    expect(summarizeBatchResults([
      skippedResult,
      {
        skillId: "seo",
        name: "SEO",
        score: 84,
        verdict: "pass",
        summary: "Good SEO",
        findings: [],
        costUsd: 0,
      },
    ])).toEqual({
      score: 84,
      verdict: "pass",
    });
  });
});
