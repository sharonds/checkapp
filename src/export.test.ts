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

  it("includes source evidence links for grounded plagiarism findings", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0.04,
      results: [{
        skillId: "plagiarism",
        name: "Plagiarism Check",
        score: 56,
        verdict: "warn" as const,
        summary: "22% grounded similarity — 1 source matched",
        findings: [{
          severity: "warn" as const,
          text: "4 words matched at https://example.com/source",
          sources: [{ url: "https://example.com/source", title: "Source" }],
        }],
        costUsd: 0.04,
        provider: "gemini-grounded-plagiarism",
      }],
    });

    expect(md).toContain("Source: [Source](https://example.com/source)");
  });

  it("includes Gemini grounded fact-check provider and source links", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0.16,
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 100,
        verdict: "pass" as const,
        summary: "1 claims checked — 0 unsupported, 0 unverified (via gemini-grounded)",
        findings: [{
          severity: "warn" as const,
          text: "Unverified (medium confidence): \"Claim\" — Needs more evidence",
          sources: [{ url: "https://example.com/evidence", title: "Evidence" }],
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain("**Provider:** Gemini 3 Pro Preview + Google Search");
    expect(md).toContain("Source: [Evidence](https://example.com/evidence)");
  });

  it("includes verified info source links for passing grounded fact-check", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0.16,
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 100,
        verdict: "pass" as const,
        summary: "1 claims checked — 0 unsupported, 0 unverified (via gemini-grounded)",
        findings: [{
          severity: "info" as const,
          text: "Verified (medium confidence): \"Claim\" — Supported by sources",
          sources: [{ url: "https://example.com/evidence", title: "Evidence" }],
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain("Verified");
    expect(md).toContain("Source: [Evidence](https://example.com/evidence)");
  });

  it("renders unsafe source URLs as plain text in markdown exports", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0,
      results: [{
        skillId: "fact-check",
        name: "Fact Check",
        score: 50,
        verdict: "warn" as const,
        summary: "Needs review",
        findings: [{
          severity: "warn" as const,
          text: "Unsafe source",
          sources: [{ url: "javascript:alert(1)", title: "Unsafe [link]" }],
        }],
        costUsd: 0,
        provider: "exa-search",
      }],
    });

    expect(md).toContain("Source: Unsafe \\[link\\]");
    expect(md).not.toContain("](javascript:");
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
