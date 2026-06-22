import { test, expect } from "bun:test";
import { generateReport } from "./report.ts";
import type { SkillResult } from "./skills/types.ts";
import type { AuditRecord } from "./audit/types.ts";

const results: SkillResult[] = [
  { skillId: "seo", name: "SEO", score: 85, verdict: "pass", summary: "Good SEO", findings: [], costUsd: 0 },
  { skillId: "plagiarism", name: "Plagiarism", score: 70, verdict: "warn", summary: "33% similarity", findings: [
    { severity: "warn", text: "76 words matched at ynet.co.il", quote: "ויטמין C הוא תרכובת אורגנית..." }
  ], costUsd: 0.09 },
];

test("generateReport returns a string of HTML", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("<html");
});

test("report contains skill names", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).toContain("SEO");
  expect(html).toContain("Plagiarism");
});

test("report contains the source filename", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).toContain("article.md");
});

test("report sanitizes credentialed source URLs in title and body", () => {
  const html = generateReport({
    source: "https://user:secret@example.com/article?token=abc&utm_source=x#access_token=frag-secret",
    wordCount: 800,
    results,
    totalCostUsd: 0.09,
  });
  expect(html).toContain("https://example.com/article?token=%5Bredacted%5D&amp;utm_source=x#access_token=%5Bredacted%5D");
  expect(html).not.toContain("user:secret");
  expect(html).not.toContain("token=abc");
  expect(html).not.toContain("frag-secret");
});

test("Hebrew audit reports set root language and direction", () => {
  const audit: AuditRecord = {
    version: 1,
    auditId: "audit-he",
    language: "he",
    direction: "rtl",
    coverage: {
      wordsScanned: 5,
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
  };
  const html = generateReport({
    source: "he.md",
    wordCount: 5,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "issue",
      findings: [{
        severity: "error",
        text: "Unsupported (high confidence): \"המשחק Rummikub מתאים לשני שחקנים בלבד.\" — המקור הרשמי סותר את הטענה.",
        status: "unsupported",
        explanation: "המקור הרשמי סותר את הטענה.",
        explanationLanguage: "he",
        quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
        rewrite: "יש לנסח מחדש.",
        sources: [{ url: "https://example.com/rummikub", title: "Rummikub official rules" }],
        location: {
          sectionId: "section-1",
          sectionTitle: "משחקים",
          paragraphIndex: 1,
          sentenceIndex: 0,
          startOffset: 86,
          endOffset: 129,
        },
      }],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
    totalCostUsd: 0.04,
    audit,
  });
  expect(html).toContain('<html lang="he" dir="rtl">');
  expect(html).toContain("דוח איכות");
  expect(html).toContain("בדיקת עובדות מבוססת מקורות");
  expect(html).toContain("1 טענות נבדקו");
  expect(html).toContain("לא נתמך");
  expect(html).toContain("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 86-129");
  expect(html).toContain("ניסוח מוצע");
  expect(html).toContain("מקור");
  expect(html).toContain("התוצאות נוצרו על ידי Google Gemini");
  expect(html).toContain('dir="auto"');
  expect(html).toContain("יש לנסח מחדש");
  expect(html).not.toContain("Quality Report");
  expect(html).not.toContain("Suggested rewrite:");
});

test("report uses logical spacing and borders for RTL-sensitive surfaces", () => {
  const html = generateReport({
    source: "he.md",
    wordCount: 5,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "issue",
      findings: [{
        severity: "error",
        text: "בעיה",
        quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
        rewrite: "יש לנסח מחדש.",
        location: { sectionId: "section-1", paragraphIndex: 0 },
      }],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
    totalCostUsd: 0.04,
    audit: {
      version: 1,
      auditId: "audit-he-logical-css",
      language: "he",
      direction: "rtl",
      coverage: {
        wordsScanned: 5,
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
  });

  expect(html).toContain("margin-inline-start");
  expect(html).toContain("margin-inline-end");
  expect(html).toContain("border-inline-start");
  expect(html).toContain("padding-inline-start");
  expect(html).toContain("text-align:end");
  expect(html).not.toContain("border-left:");
  expect(html).not.toContain("padding-left:");
  expect(html).not.toContain("margin-left:");
  expect(html).not.toContain("margin-right:");
  expect(html).not.toContain("text-align:right");
});

test("English audit reports keep English labels", () => {
  const audit: AuditRecord = {
    version: 1,
    auditId: "audit-en",
    language: "en",
    direction: "ltr",
    coverage: {
      wordsScanned: 7,
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
  };
  const html = generateReport({
    source: "en.md",
    wordCount: 7,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "issue",
      findings: [{
        severity: "error",
        text: "Unsupported (high confidence): \"The game supports two players only.\" — Official rules contradict it.",
        status: "unsupported",
        explanation: "Official rules contradict it.",
        explanationLanguage: "en",
        quote: "The game supports two players only.",
        rewrite: "Revise the claim.",
        location: {
          sectionId: "section-1",
          paragraphIndex: 0,
          sentenceIndex: 0,
          startOffset: 0,
          endOffset: 35,
        },
      }],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
    totalCostUsd: 0.04,
    audit,
  });
  expect(html).toContain('<html lang="en" dir="ltr">');
  expect(html).toContain("Quality Report");
  expect(html).toContain("Fact Check (Grounded)");
  expect(html).toContain("1 claims checked");
  expect(html).toContain("Location: section-1 · paragraph 1 · sentence 1 · chars 0-35");
  expect(html).toContain("Suggested rewrite");
  expect(html).not.toContain("דוח איכות");
});

test("plagiarism report surfaces structured match type and grounding mode", () => {
  const html = generateReport({
    source: "plagiarism.md",
    wordCount: 8,
    results: [{
      skillId: "plagiarism",
      name: "Plagiarism Check",
      score: 60,
      verdict: "warn",
      summary: "possible match",
      findings: [{
        severity: "warn",
        text: "possible copied passage",
        quote: "Near exact copied sentence.",
        status: "plagiarism_match",
        matchType: "near" as any,
        groundingMode: "ungrounded" as any,
        sources: [{ url: "https://example.com/source", title: "Source" }],
      }],
      costUsd: 0.04,
      provider: "gemini-grounded-plagiarism",
    }],
    totalCostUsd: 0.04,
    audit: {
      version: 1,
      auditId: "audit-plagiarism",
      language: "en",
      direction: "ltr",
      coverage: {
        wordsScanned: 8,
        sectionsDetected: 1,
        paragraphsScanned: 1,
        sentencesScanned: 1,
        claimsExtracted: 0,
        claimsChecked: 0,
        claimsSkipped: 0,
        skipReasons: {},
        plagiarismPassagesChecked: 1,
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
  });

  expect(html).toContain("Match type: near");
  expect(html).toContain("Grounding: ungrounded");
});

test("fact-check report explains budget-driven skipped claims", () => {
  const html = generateReport({
    source: "budget.md",
    wordCount: 20,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 100,
      verdict: "pass",
      summary: "2 claims checked.",
      findings: [],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
    totalCostUsd: 0.04,
    audit: {
      version: 1,
      auditId: "audit-budget",
      language: "en",
      direction: "ltr",
      coverage: {
        wordsScanned: 20,
        sectionsDetected: 1,
        paragraphsScanned: 1,
        sentencesScanned: 4,
        claimsExtracted: 5,
        claimsChecked: 2,
        claimsSkipped: 3,
        skipReasons: { claim_cap: 3 },
        budgetStopReason: "claim_cap",
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
  });

  expect(html).toContain("2 claims checked — 0 unsupported, 0 unverified, 3 skipped by claim cap");
});

test("report labels fuzzy quote locations as approximate", () => {
  const html = generateReport({
    source: "fuzzy.md",
    wordCount: 8,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "issue",
      provider: "gemini-grounded",
      findings: [{
        severity: "error",
        text: "Unsupported claim",
        quote: "Rummikub supports two players only.",
        location: {
          sectionId: "section-1",
          sectionTitle: "Games",
          paragraphIndex: 0,
          sentenceIndex: 0,
          matchQuality: "fuzzy",
        } as any,
      }],
      costUsd: 0.04,
    }],
    totalCostUsd: 0.04,
  });

  expect(html).toContain("Approximate location: Games · paragraph 1 · sentence 1");
  expect(html).not.toContain("chars 10-42");
});

test("mixed Hebrew-English audit uses Hebrew RTL report shell and auto-direction quotes", () => {
  const audit: AuditRecord = {
    version: 1,
    auditId: "audit-mixed",
    language: "mixed",
    direction: "auto",
    coverage: {
      wordsScanned: 6,
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
  };
  const html = generateReport({
    source: "mixed.md",
    wordCount: 6,
    totalCostUsd: 0,
    audit,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "warn",
      summary: "issue",
      costUsd: 0,
      findings: [{
        severity: "warn",
        text: "בעיה",
        quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
        rewrite: "יש לנסח מחדש.",
        explanationLanguage: "mixed",
      }],
    }],
  });
  expect(html).toContain('<html lang="he" dir="rtl">');
  expect(html).toContain("דוח איכות");
  expect(html).toContain('dir="auto"');
});

test("report is self-contained (no external JS scripts)", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).not.toMatch(/<script src=/);
});

test("report labels Gemini AI Detection and discloses Google Gemini when used", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.01,
    results: [{
      skillId: "ai-detection",
      name: "AI Detection",
      score: 90,
      verdict: "pass",
      summary: "10% AI probability — human",
      findings: [],
      costUsd: 0.01,
      provider: "gemini-ai-detection",
    }],
  });

  expect(html).toContain("Gemini AI Detection");
  expect(html).toContain("https://ai.google.dev");
  expect(html).toContain("Google Gemini");
  expect(html).not.toContain("https://copyscape.com");
});

test("Copyscape AI Detection report does not disclose Google Gemini", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.03,
    results: [{
      skillId: "ai-detection",
      name: "AI Detection",
      score: 90,
      verdict: "pass",
      summary: "10% AI probability — human",
      findings: [],
      costUsd: 0.03,
      provider: "copyscape",
    }],
  });

  expect(html).toContain("https://copyscape.com");
  expect(html).toContain("Copyscape");
  expect(html).not.toContain("https://ai.google.dev");
  expect(html).not.toContain("Google Gemini");
});

test("Gemini grounded plagiarism report shows provider and source evidence", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.04,
    results: [{
      skillId: "plagiarism",
      name: "Plagiarism Check",
      score: 56,
      verdict: "warn",
      summary: "22% grounded similarity — 1 source matched",
      findings: [{
        severity: "warn",
        text: "4 words matched at https://example.com/source",
        quote: "[high confidence · exact] Exact copied sentence.",
        sources: [{ url: "https://example.com/source", title: "Source" }],
        confidence: "high",
      }],
      costUsd: 0.04,
      provider: "gemini-grounded-plagiarism",
    }],
  });

  expect(html).toContain("Gemini Grounded Plagiarism");
  expect(html).toContain("Google Gemini");
  expect(html).toContain("https://example.com/source");
  expect(html).toContain("Source");
});

test("Gemini grounded fact-check report shows provider and source evidence", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.16,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 90,
      verdict: "warn",
      summary: "1 claims checked — 0 unsupported, 1 unverified (via gemini-grounded)",
      findings: [{
        severity: "warn",
        text: "Unverified (medium confidence): \"Claim\" — Needs more evidence",
        sources: [{ url: "https://example.com/evidence", title: "Evidence" }],
        confidence: "medium",
      }],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
  });

  expect(html).toContain("Gemini 3.1 Pro + Google Search");
  expect(html).toContain("Google Gemini");
  expect(html).toContain("https://example.com/evidence");
  expect(html).toContain("Evidence");
});

test("passing Gemini grounded fact-check report collapses verified claims to a count, not per-claim cards", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.16,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 100,
      verdict: "pass",
      summary: "1 claims checked — 0 unsupported, 0 unverified (via gemini-grounded)",
      findings: [{
        severity: "info",
        text: "Verified (medium confidence): \"Claim\" — Supported by sources",
        sources: [{ url: "https://example.com/evidence", title: "Evidence" }],
        confidence: "medium",
      }],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
  });

  expect(html).toContain("Gemini 3.1 Pro + Google Search");
  // Verified claims are not problems — they are collapsed to a single count line
  // rather than rendering a card (and its evidence) per verified claim.
  expect(html).toContain("1 claim verified");
  expect(html).not.toContain("https://example.com/evidence");
});

test("SEO-only report does not disclose third-party processors", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [{
      skillId: "seo",
      name: "SEO",
      score: 90,
      verdict: "pass",
      summary: "Good SEO",
      findings: [],
      costUsd: 0,
    }],
  });

  expect(html).not.toContain("https://copyscape.com");
  expect(html).not.toContain("https://exa.ai");
  expect(html).not.toContain("https://platform.minimax.io");
  expect(html).not.toContain("third-party APIs");
});

test("all-skipped report is not marked ready to publish", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [{
      skillId: "ai-detection",
      name: "AI Detection",
      score: 0,
      verdict: "skipped",
      summary: "AI detection skipped",
      findings: [],
      costUsd: 0,
      provider: "copyscape",
    }],
  });

  expect(html).toContain("Not assessed");
  expect(html).toContain("N/A");
  expect(html).not.toContain("0/100");
  expect(html).not.toContain("Ready to publish");
});

test("empty report is not marked ready to publish", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [],
  });

  expect(html).toContain("Not assessed");
  expect(html).toContain("N/A");
  expect(html).not.toContain("Ready to publish");
});

test("Hebrew report localizes provider_error findings (no raw English confidence)", () => {
  const html = generateReport({
    source: "he-provider-error.md",
    wordCount: 5,
    totalCostUsd: 0,
    audit: {
      version: 1,
      auditId: "audit-x",
      language: "he",
      direction: "rtl",
      coverage: {
        wordsScanned: 5,
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
      createdAt: "2026-06-10T00:00:00.000Z",
    },
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 70,
      verdict: "warn",
      summary: "issue",
      costUsd: 0,
      provider: "gemini-grounded",
      findings: [{
        severity: "warn",
        status: "provider_error",
        confidence: "low",
        text: "שגיאת ספק",
        explanation: "Gemini grounded error: HTTP 500",
        explanationLanguage: "he",
      }],
    }],
  });
  expect(html).toContain("שגיאת ספק");
  expect(html).toContain("רמת ביטחון: נמוכה");
  expect(html).not.toMatch(/\(low\)/);
});

test("Hebrew report localizes supported findings' confidence (no raw or duplicated English value)", () => {
  // Live dogfood regression: supported findings rendered "רמת ביטחון: high (high): ..."
  const html = generateReport({
    source: "he-supported.md",
    wordCount: 5,
    totalCostUsd: 0,
    audit: {
      version: 1,
      auditId: "audit-y",
      language: "he",
      direction: "rtl",
      coverage: {
        wordsScanned: 5,
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
      createdAt: "2026-06-10T00:00:00.000Z",
    },
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 90,
      verdict: "pass",
      summary: "ok",
      costUsd: 0,
      provider: "gemini-grounded",
      findings: [{
        severity: "error",
        status: "unsupported",
        confidence: "high",
        text: "טענה לא נתמכת",
        explanation: "המקורות סותרים את הטענה.",
        explanationLanguage: "he",
        sources: [{ url: "https://example.com/source", title: "מקור" }],
      }],
    }],
  });
  expect(html).toContain("רמת ביטחון: גבוהה");
  expect(html).not.toMatch(/רמת ביטחון: high/);
  expect(html).not.toMatch(/\(high\)/);
  expect(html).not.toContain("(גבוהה)");
});

test("passing report is marked ready for review, not guaranteed publishable", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [{
      skillId: "seo",
      name: "SEO",
      score: 90,
      verdict: "pass",
      summary: "Good SEO",
      findings: [],
      costUsd: 0,
    }],
  });

  expect(html).toContain("Ready for review");
  expect(html).not.toContain("Ready to publish");
});
