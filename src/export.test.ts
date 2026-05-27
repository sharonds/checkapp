import { describe, it, expect } from "bun:test";
import { generateMarkdownReport } from "./export.ts";

describe("generateMarkdownReport", () => {
  const mockRecord = {
    source: "test.md",
    wordCount: 500,
    results: [{
      skillId: "seo", name: "SEO", score: 75, verdict: "pass" as const,
      summary: "Good SEO", findings: [], costUsd: 0,
    }],
    totalCostUsd: 0,
  };

  it("includes report header with source and score", () => {
    const md = generateMarkdownReport(mockRecord);
    expect(md).toContain("# CheckApp Report");
    expect(md).toContain("test.md");
    expect(md).toContain("75");
    expect(md).toContain("PASS");
  });

  it("includes skill sections", () => {
    const md = generateMarkdownReport(mockRecord);
    expect(md).toContain("## ✅ SEO");
    expect(md).toContain("Good SEO");
  });

  it("includes findings with severity icons", () => {
    const record = {
      ...mockRecord,
      results: [{
        skillId: "seo", name: "SEO", score: 40, verdict: "fail" as const,
        summary: "Poor SEO",
        findings: [
          { severity: "warn" as const, text: "Word count too low" },
          { severity: "error" as const, text: "No H1 heading", quote: "The article starts without..." },
        ],
        costUsd: 0,
      }],
    };
    const md = generateMarkdownReport(record);
    expect(md).toContain("⚠️");
    expect(md).toContain("Word count too low");
    expect(md).toContain("❌");
    expect(md).toContain("No H1 heading");
    expect(md).toContain(">");  // quote blockquote
  });

  it("hides info-severity findings", () => {
    const record = {
      ...mockRecord,
      results: [{
        skillId: "seo", name: "SEO", score: 100, verdict: "pass" as const,
        summary: "Great",
        findings: [{ severity: "info" as const, text: "This should be hidden" }],
        costUsd: 0,
      }],
    };
    const md = generateMarkdownReport(record);
    expect(md).not.toContain("This should be hidden");
  });

  it("includes footer with MIT license", () => {
    const md = generateMarkdownReport(mockRecord);
    expect(md).toContain("MIT License");
    expect(md).toContain("github.com/sharonds/checkapp");
  });

  it("all-skipped markdown report is marked skipped with N/A score", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0,
      results: [{
        skillId: "ai-detection",
        name: "AI Detection",
        score: 0,
        verdict: "skipped" as const,
        summary: "AI detection skipped",
        findings: [],
        costUsd: 0,
      }],
    });

    expect(md).toMatch(/\*\*Overall:\*\* N\/A .* SKIPPED/);
    expect(md).toContain("AI Detection — N/A SKIPPED");
  });

  it("empty markdown report is marked skipped with N/A score", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0,
      results: [],
    });

    expect(md).toMatch(/\*\*Overall:\*\* N\/A .* SKIPPED/);
  });
});
