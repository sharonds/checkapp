import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { analyzeDocument, locateQuote } from "./document.ts";
import { auditLocaleForLanguage } from "./localization.ts";
import { generateReport } from "../report.ts";
import type { AuditRecord } from "./types.ts";
import { publicCheckSummary } from "../../shared/check-summary.ts";

interface FixtureManifest {
  id: string;
  language: "en" | "he" | "mixed" | "other";
  direction: "ltr" | "rtl" | "auto";
  article: string;
  expected: {
    claimsExtracted: number;
    claimsChecked: number;
    claimsSkipped: number;
    issueType?: "fact" | "plagiarism" | "known_limitation";
    quote?: string;
    uiLocale?: "en" | "he";
    knownLimitation?: string;
  };
}

function loadManifests(): FixtureManifest[] {
  const dir = join(import.meta.dir, "../../tests/fixtures/audit-manifests");
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => JSON.parse(readFileSync(join(dir, file), "utf-8")) as FixtureManifest);
}

describe("audit fixture manifests", () => {
  test("provide deterministic required fields", () => {
    const manifests = loadManifests();
    expect(manifests.length).toBeGreaterThan(0);
    for (const manifest of manifests) {
      expect(manifest.id).toBeTruthy();
      expect(manifest.article.length).toBeGreaterThan(0);
      expect(["en", "he", "mixed", "other"]).toContain(manifest.language);
      expect(["ltr", "rtl", "auto"]).toContain(manifest.direction);
      expect(manifest.expected.claimsExtracted).toBeGreaterThanOrEqual(manifest.expected.claimsChecked);
      if (manifest.expected.quote) {
        expect(manifest.article).toContain(manifest.expected.quote);
      }
      if (manifest.expected.uiLocale) {
        expect(["en", "he"]).toContain(manifest.expected.uiLocale);
      }
      if (manifest.expected.issueType === "known_limitation") {
        expect(manifest.expected.knownLimitation).toContain("Repeated identical quotes");
      }
    }
  });

  test("include the required PR3 scenario set", () => {
    const ids = new Set(loadManifests().map((manifest) => manifest.id));
    for (const id of [
      "he-fact-rummikub",
      "he-plagiarism-vitamin-c",
      "mixed-he-en-game-claim",
      "en-plagiarism-baseline",
      "he-repeated-quote-limitation",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  test("scenario quotes locate in analyzed documents and repeated Hebrew quotes use first match", () => {
    for (const manifest of loadManifests()) {
      const analysis = analyzeDocument(manifest.article);
      expect(analysis.language).toBe(manifest.language);
      expect(analysis.direction).toBe(manifest.direction);
      if (!manifest.expected.quote) continue;
      const located = locateQuote(manifest.article, manifest.expected.quote, analysis);
      expect(located.quote).toBe(manifest.expected.quote);
      expect(located.location).toBeDefined();
      if (manifest.id === "he-repeated-quote-limitation") {
        expect(located.location?.sectionId).toBe("section-1");
        expect(located.location?.paragraphIndex).toBe(0);
      }
    }
  });

  test("scenario manifests drive localized report labels", () => {
    for (const manifest of loadManifests().filter((item) => item.expected.uiLocale)) {
      const audit: AuditRecord = {
        version: 1,
        auditId: `audit-${manifest.id}`,
        language: manifest.language,
        direction: manifest.direction,
        coverage: {
          wordsScanned: manifest.article.split(/\s+/).filter(Boolean).length,
          sectionsDetected: 1,
          paragraphsScanned: 1,
          sentencesScanned: 1,
          claimsExtracted: manifest.expected.claimsExtracted,
          claimsChecked: manifest.expected.claimsChecked,
          claimsSkipped: manifest.expected.claimsSkipped,
          skipReasons: {},
          plagiarismPassagesChecked: manifest.expected.issueType === "plagiarism" ? 1 : 0,
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
        source: `${manifest.id}.md`,
        wordCount: audit.coverage.wordsScanned,
        totalCostUsd: 0,
        audit,
        results: [{
          skillId: manifest.expected.issueType === "plagiarism" ? "plagiarism" : "fact-check-grounded",
          name: manifest.expected.issueType === "plagiarism" ? "Plagiarism Check" : "Fact Check (Grounded)",
          score: 50,
          verdict: "warn",
          summary: "fixture",
          costUsd: 0,
          findings: [{
            severity: "warn",
            text: "fixture issue",
            quote: manifest.expected.quote,
            rewrite: manifest.expected.uiLocale === "he" ? "יש לנסח מחדש." : "Revise this passage.",
            explanationLanguage: manifest.language,
          }],
        }],
      });
      const expectedLocale = auditLocaleForLanguage(manifest.language);
      expect(expectedLocale).toBe(manifest.expected.uiLocale);
      if (expectedLocale === "he") {
        expect(html).toContain('<html lang="he" dir="rtl">');
        expect(html).toContain("דוח איכות");
        expect(html).toContain("ניסוח מוצע");
      } else {
        expect(html).toContain('<html lang="en" dir="ltr">');
        expect(html).toContain("Quality Report");
        expect(html).toContain("Suggested rewrite");
      }
    }
  });

  test("long-form mixed Hebrew scenario preserves distributed findings and coverage limits", () => {
    const earlyQuote = "המשחק Rummikub מתאים לשני שחקנים בלבד.";
    const middleQuote = "ויטמין C הוא תרכובת אורגנית מסיסה במים.";
    const lateQuote = "החברה הוקמה בשנת 1899.";
    const skippedClaim = "החוויה מרגישה מושלמת לכל משפחה.";
    const article = [
      `## פתיחה\n\n${fillWords("פתיחה", 360)} ${earlyQuote} ${fillWords("משחק", 40)}`,
      `## בריאות\n\n${fillWords("בריאות", 360)} ${middleQuote} ${fillWords("מקור", 40)}`,
      `## רקע\n\n${fillWords("רקע", 360)} ${lateQuote} ${skippedClaim} ${fillWords("סיום", 40)}`,
    ].join("\n\n");
    const words = article.split(/\s+/).filter(Boolean);

    expect(words.length).toBeGreaterThanOrEqual(1125);
    expect(words.length).toBeLessThanOrEqual(1275);
    expect((article.match(/^## /gm) ?? []).length).toBeGreaterThanOrEqual(3);

    const analysis = analyzeDocument(article);
    expect(analysis.language).toBe("he");
    expect(analysis.direction).toBe("rtl");
    for (const quote of [earlyQuote, middleQuote, lateQuote]) {
      const located = locateQuote(article, quote, analysis);
      expect(located.quote).toContain(quote);
      expect(located.location).toBeDefined();
    }

    const audit: AuditRecord = {
      version: 1,
      auditId: "audit-longform-pr4",
      language: "he",
      direction: "rtl",
      coverage: {
        wordsScanned: words.length,
        sectionsDetected: 3,
        paragraphsScanned: 3,
        sentencesScanned: 8,
        claimsExtracted: 5,
        claimsChecked: 3,
        claimsSkipped: 2,
        skipReasons: { tier_cap: 1, vague: 1 },
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
    };
    const html = generateReport({
      source: "longform.md",
      wordCount: words.length,
      totalCostUsd: 0,
      audit,
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 50,
        verdict: "fail",
        summary: "3 claims checked, 2 skipped due to limits.",
        costUsd: 0,
        findings: [
          {
            severity: "error",
            text: "לא נתמך (רמת ביטחון: גבוהה, 90%).",
            quote: earlyQuote,
            rewrite: "יש לכתוב: המשחק Rummikub מתאים ל-2 עד 4 שחקנים.",
            confidence: "high",
            confidenceRationale: "המקור הרשמי מציין 2 עד 4 שחקנים.",
            location: locateQuote(article, earlyQuote, analysis).location,
          },
          {
            severity: "warn",
            text: "חשד להעתקה (רמת ביטחון: גבוהה, 92%).",
            quote: middleQuote,
            rewrite: "יש לנסח מחדש ולציין מקור.",
            confidence: "high",
            confidenceRationale: "התאמה מילולית גבוהה למקור חיצוני.",
            location: locateQuote(article, middleQuote, analysis).location,
          },
          {
            severity: "warn",
            text: "טענה לא מאומתת.",
            quote: lateQuote,
            rewrite: "יש לבדוק את שנת ההקמה מול מקור רשמי.",
            confidence: "medium",
            confidenceRationale: "נדרש מקור נוסף.",
            location: locateQuote(article, lateQuote, analysis).location,
          },
        ],
      }],
    });

    expect(html).toContain("דוח איכות");
    expect(html).toContain(earlyQuote);
    expect(html).toContain(middleQuote);
    expect(html).toContain(lateQuote);
    expect(html).toContain("Rummikub");
    expect(html).not.toContain("רמיקוב");
    expect(html).toContain("3 טענות נבדקו");
    expect(html).toContain("2 דולגו");
    expect(html).not.toContain("all claims verified");
    expect(html).not.toContain("clean");
  });

  test("repeated quote summaries stay redacted and report output keeps one article quote per finding", () => {
    const quote = "המשחק מתאים לשני שחקנים בלבד.";
    const summary = publicCheckSummary({
      id: 1,
      source: "repeat.md",
      wordCount: 20,
      totalCost: 0,
      createdAt: "2026-06-09T00:00:00.000Z",
      resultsJson: JSON.stringify([{
        skillId: "fact-check-grounded",
        score: 50,
        verdict: "fail",
        findings: [{
          text: `בעיה: ${quote}`,
          quote,
          rewrite: quote,
          confidenceRationale: quote,
          sources: [{ url: "https://example.com", quote }],
        }],
      }]),
    });
    expect(JSON.stringify(summary)).not.toContain(quote);

    const html = generateReport({
      source: "repeat.md",
      wordCount: 20,
      totalCostUsd: 0,
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 50,
        verdict: "fail",
        summary: "Repeated identical quotes resolve deterministically to the first exact match unless provider output includes source offsets.",
        costUsd: 0,
        findings: [{
          severity: "error",
          text: "Repeated identical quotes resolve deterministically to the first exact match unless provider output includes source offsets.",
          quote,
          rewrite: "יש להוסיף מיקום מדויק.",
          confidenceRationale: "Repeated identical quotes are ambiguous without source offsets.",
          sources: [{ url: "https://example.com", quote }],
        }],
      }],
    });
    const articleQuoteOccurrences = (html.match(new RegExp(quote, "g")) ?? []).length;
    expect(articleQuoteOccurrences).toBeGreaterThanOrEqual(1);
    expect(html).toContain("Repeated identical quotes");
  });
});

function fillWords(word: string, count: number): string {
  return Array.from({ length: count }, () => word).join(" ");
}
