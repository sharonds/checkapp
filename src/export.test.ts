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
      audit: {
        version: 1,
        auditId: "audit-md",
        language: "en",
        direction: "ltr",
        coverage: {
          wordsScanned: 500,
          sectionsDetected: 1,
          paragraphsScanned: 1,
          sentencesScanned: 2,
          claimsExtracted: 3,
          claimsChecked: 1,
          claimsSkipped: 2,
          skipReasons: { tier_cap: 2 },
          plagiarismPassagesChecked: 0,
          plagiarismPassagesSkipped: 0,
          providerFailures: 0,
          providerRetries: 0,
          budgetStopReason: "claim_cap",
        },
        segments: [],
        claims: [],
        claimDecisions: [],
        factAssessments: [],
        plagiarismFindings: [],
        providerAttempts: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      },
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 100,
        verdict: "pass" as const,
        summary: "1 claims checked — 0 unsupported, 0 unverified (via gemini-grounded)",
        findings: [{
          severity: "warn" as const,
          text: "Unverified (medium confidence): \"Claim\" — Needs more evidence",
          quote: "Claim",
          confidence: "medium" as const,
          confidenceRationale: "Only one partial source was available.",
          rewrite: "Qualify the claim.",
          searchQueries: ["claim evidence"],
          location: {
            sectionId: "section-1",
            sectionTitle: "Intro",
            paragraphIndex: 0,
            sentenceIndex: 0,
            startOffset: 10,
            endOffset: 15,
          },
          sources: [{ url: "https://example.com/evidence", title: "Evidence" }],
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain("**Provider:** Gemini 3.1 Pro + Google Search");
    expect(md).toContain("1 claims checked — 0 unsupported, 1 unverified, 2 skipped by claim cap");
    expect(md).toContain('> "Claim"');
    expect(md).toContain("Location: Intro · paragraph 1 · sentence 1 · chars 10-15");
    expect(md).toContain("Confidence: medium");
    expect(md).toContain("Confidence rationale: Only one partial source was available.");
    expect(md).toContain("Search: claim evidence");
    expect(md).toContain("Suggested rewrite: Qualify the claim.");
    expect(md).toContain("Source: [Evidence](https://example.com/evidence)");
  });

  it("counts provider errors separately from unverified in markdown summaries", () => {
    const md = generateMarkdownReport({
      source: "test.md",
      wordCount: 500,
      totalCostUsd: 0.04,
      audit: {
        version: 1,
        auditId: "audit-pe-md",
        language: "en",
        direction: "ltr",
        coverage: {
          wordsScanned: 500,
          sectionsDetected: 1,
          paragraphsScanned: 1,
          sentencesScanned: 1,
          claimsExtracted: 1,
          claimsChecked: 1,
          claimsSkipped: 0,
          skipReasons: {},
          plagiarismPassagesChecked: 0,
          plagiarismPassagesSkipped: 0,
          providerFailures: 1,
          providerRetries: 0,
        },
        segments: [],
        claims: [],
        claimDecisions: [],
        factAssessments: [],
        plagiarismFindings: [],
        providerAttempts: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      },
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 90,
        verdict: "warn" as const,
        summary: "1 claims checked — 0 unsupported, 0 unverified, 1 provider errors (via gemini-grounded)",
        findings: [{
          severity: "warn" as const,
          text: "Provider error (low confidence): \"Claim\" — Gemini grounded provider did not return a usable response.",
          status: "provider_error" as const,
          confidence: "low" as const,
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain(", 1 provider errors");
    expect(md).toContain("1 claims checked — 0 unsupported, 0 unverified, 1 provider errors (via gemini-grounded)");
  });

  it("counts provider errors separately from unverified in Hebrew markdown summaries", () => {
    const md = generateMarkdownReport({
      source: "he.md",
      wordCount: 120,
      totalCostUsd: 0.04,
      audit: {
        version: 1,
        auditId: "audit-pe-he-md",
        language: "he",
        direction: "rtl",
        coverage: {
          wordsScanned: 120,
          sectionsDetected: 1,
          paragraphsScanned: 1,
          sentencesScanned: 1,
          claimsExtracted: 1,
          claimsChecked: 1,
          claimsSkipped: 0,
          skipReasons: {},
          plagiarismPassagesChecked: 0,
          plagiarismPassagesSkipped: 0,
          providerFailures: 1,
          providerRetries: 0,
        },
        segments: [],
        claims: [],
        claimDecisions: [],
        factAssessments: [],
        plagiarismFindings: [],
        providerAttempts: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      },
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 90,
        verdict: "warn" as const,
        summary: "1 claims checked — 0 unsupported, 0 unverified, 1 provider errors (via gemini-grounded)",
        findings: [{
          severity: "warn" as const,
          text: "Provider error (low confidence): \"טענה\" — הקריאה לספק נכשלה.",
          status: "provider_error" as const,
          confidence: "low" as const,
          explanation: "הקריאה לספק נכשלה.",
          explanationLanguage: "he" as const,
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain(", 1 שגיאות ספק");
  });

  it("labels fuzzy locations as approximate in markdown exports", () => {
    const md = generateMarkdownReport({
      source: "fuzzy.md",
      wordCount: 10,
      totalCostUsd: 0.04,
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 50,
        verdict: "fail" as const,
        summary: "issue",
        findings: [{
          severity: "error" as const,
          text: "Unsupported claim",
          location: {
            sectionId: "section-1",
            sectionTitle: "Games",
            paragraphIndex: 0,
            sentenceIndex: 0,
            matchQuality: "fuzzy",
          } as any,
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain("Approximate location: Games · paragraph 1 · sentence 1");
  });

  it("localizes Hebrew grounded finding leads and source labels in markdown exports", () => {
    const md = generateMarkdownReport({
      source: "he.md",
      wordCount: 120,
      totalCostUsd: 0.04,
      audit: {
        version: 1,
        auditId: "audit-he-md",
        language: "he",
        direction: "rtl",
        coverage: {
          wordsScanned: 120,
          sectionsDetected: 1,
          paragraphsScanned: 1,
          sentencesScanned: 1,
          claimsExtracted: 1,
          claimsChecked: 1,
          claimsSkipped: 0,
          skipReasons: {},
          plagiarismPassagesChecked: 0,
          plagiarismPassagesSkipped: 0,
          providerFailures: 0,
          providerRetries: 0,
        },
        segments: [],
        claims: [],
        claimDecisions: [],
        factAssessments: [],
        plagiarismFindings: [],
        providerAttempts: [],
        createdAt: "2026-06-09T00:00:00.000Z",
      },
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 50,
        verdict: "fail" as const,
        summary: "issue",
        findings: [{
          severity: "error" as const,
          text: "Unsupported (high confidence): \"טענה\" — המקור סותר.",
          status: "unsupported" as const,
          confidence: "high" as const,
          explanation: "המקור סותר.",
          explanationLanguage: "he" as const,
          sources: [{ url: "https://example.com/evidence", title: "מקור רשמי" }],
        }],
        costUsd: 0.04,
        provider: "gemini-grounded",
      }],
    });

    expect(md).toContain("# דוח איכות");
    expect(md).toContain("**מקור:** he.md");
    expect(md).toContain("**מילים:** 120");
    expect(md).toContain("**עלות API:** $0.040");
    expect(md).toContain("**ספק:** Gemini 3.1 Pro + Google Search");
    expect(md).toContain("לא נתמך");
    expect(md).toContain("רמת ביטחון: גבוהה");
    expect(md).not.toContain("Unsupported");
    expect(md).not.toContain("**Source:**");
    expect(md).not.toContain("**Provider:**");
    expect(md).toContain("מקור: [מקור רשמי](https://example.com/evidence)");
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
