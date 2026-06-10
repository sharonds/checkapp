import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";
import { openDb, insertCheck } from "../../../src/db.ts";
import type { AuditRecord } from "../../../src/audit/types.ts";
import type { SkillResult } from "../../../src/skills/types.ts";

async function withDashboard<T>(
  scenario: string,
  seedDb: (dbPath: string) => Record<string, number>,
  work: (ctx: {
    handle: DashboardHandle;
    temp: TempPaths;
    seededIds: Record<string, number>;
  }) => Promise<T>,
): Promise<T> {
  const temp = allocateTempPaths();
  temp.initDbSchema();
  temp.initCsrfToken();
  temp.writeConfig({ skills: { factCheck: false }, factCheckTierFlag: false });
  const seededIds = seedDb(temp.dbPath);
  const handle = await bootDashboard({
    scenario,
    configPath: temp.configPath,
    dbPath: temp.dbPath,
    csrfPath: temp.csrfPath,
  });
  try {
    return await work({ handle, temp, seededIds });
  } finally {
    await browser.close().catch(() => {});
    await handle.stop();
    await new Promise((r) => setTimeout(r, 500));
    temp.cleanup();
  }
}

function coverage(language: "en" | "he" | "mixed"): AuditRecord {
  return {
    version: 1,
    auditId: `audit-${language}`,
    language,
    direction: language === "en" ? "ltr" : "auto",
    coverage: {
      wordsScanned: 90,
      sectionsDetected: 2,
      paragraphsScanned: 2,
      sentencesScanned: 4,
      claimsExtracted: 4,
      claimsChecked: 2,
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
}

function seedLocalizedChecks(dbPath: string): Record<string, number> {
  const db = openDb(dbPath);
  const location = {
    sectionId: "section-1",
    sectionTitle: "משחקים",
    paragraphIndex: 1,
    sentenceIndex: 0,
    startOffset: 86,
    endOffset: 129,
  };

  const mixedResults: SkillResult[] = [
    {
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "2 claims checked — 1 unsupported, 1 skipped.",
      provider: "gemini-grounded",
      findings: [{
        severity: "error",
        text: "לא נתמך (רמת ביטחון: גבוהה, 90%): המשחק Rummikub מתאים לשני שחקנים בלבד.",
        quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
        confidence: "high",
        confidenceRationale: "המקור הרשמי מציין שהמשחק מיועד ל-2 עד 4 שחקנים.",
        rewrite: "יש לכתוב: המשחק Rummikub מתאים ל-2 עד 4 שחקנים.",
        location,
        searchQueries: ["Rummikub number of players"],
        sources: [{
          title: "Rummikub official rules",
          url: "https://user:secret@example.com/rummikub?api_key=secret&utm_source=x#access_token=frag-secret",
          quote: "2-4 players",
          relevanceScore: 0.9,
        }],
        costUsd: 0,
      } as any],
      costUsd: 0.04,
    },
    {
      skillId: "plagiarism",
      name: "Plagiarism Check",
      score: 60,
      verdict: "warn",
      summary: "נמצא דמיון למקור חיצוני.",
      provider: "gemini-grounded-plagiarism",
      findings: [{
        severity: "warn",
        text: "נמצא ניסוח דומה למקור חיצוני (רמת ביטחון: גבוהה, 92%).",
        quote: "ויטמין C הוא תרכובת אורגנית מסיסה במים.",
        confidence: "high",
        confidenceRationale: "התאמה מילולית גבוהה למקור שפורסם.",
        rewrite: "יש לנסח מחדש את ההסבר ולציין מקור.",
        location: {
          sectionId: "section-2",
          sectionTitle: "בריאות",
          paragraphIndex: 0,
          sentenceIndex: 0,
          startOffset: 140,
          endOffset: 181,
        },
        sources: [{
          title: "מאגר בריאות",
          url: "https://example.org/health?token=abc#access_token=frag-secret",
          quote: "ויטמין C הוא תרכובת אורגנית מסיסה במים.",
          relevanceScore: 0.92,
        }],
      } as any],
      costUsd: 0.03,
    },
  ];

  const mixedId = insertCheck(db, {
    source: "https://user:secret@example.com/article?token=abc&utm_source=x#access_token=frag-secret",
    wordCount: 90,
    results: mixedResults,
    totalCostUsd: 0.07,
    articleText: "ARTICLE_TEXT_PRIVATE_MARKER_PR4\n## משחקים\n\nהמשחק Rummikub מתאים לשני שחקנים בלבד.\n\n## בריאות\n\nויטמין C הוא תרכובת אורגנית מסיסה במים.",
    audit: coverage("mixed"),
  });

  const enId = insertCheck(db, {
    source: "english.md",
    wordCount: 40,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "1 claim checked.",
      findings: [{
        severity: "error",
        text: "Unsupported (high confidence, 90%).",
        quote: "The game supports two players only.",
        confidence: "high",
        confidenceRationale: "Official rules say two to four players.",
        rewrite: "Say the game supports two to four players.",
        location: {
          sectionId: "section-en",
          sectionTitle: "Games",
          paragraphIndex: 0,
          sentenceIndex: 0,
          startOffset: 0,
          endOffset: 35,
        },
      }],
      costUsd: 0.01,
    }],
    totalCostUsd: 0.01,
    articleText: "ARTICLE_TEXT_PRIVATE_MARKER_PR4 English private article.",
    audit: coverage("en"),
  });

  const unknownId = insertCheck(db, {
    source: "unknown-language.md",
    wordCount: 20,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 50,
      verdict: "fail",
      summary: "1 claim checked.",
      findings: [{
        severity: "error",
        text: "Unsupported.",
        quote: "The game supports two players only.",
      }],
      costUsd: 0.01,
    }],
    totalCostUsd: 0.01,
    articleText: "ARTICLE_TEXT_PRIVATE_MARKER_PR4 fallback private article.",
    audit: { ...coverage("en"), language: "other", direction: "ltr" },
  });

  db.close();
  return { mixedId, enId, unknownId };
}

async function pageState() {
  const raw = await spawnBrowserEval(`(() => {
    const text = document.body.innerText || "";
    return {
      text,
      hasRtl: !!document.querySelector('[dir="rtl"]'),
      hasLtr: !!document.querySelector('[dir="ltr"]'),
      autoQuoteCount: document.querySelectorAll('blockquote[dir="auto"], [dir="auto"]').length,
      leaksUserinfo: text.includes('user:secret'),
      leaksRawToken: text.includes('token=abc') || text.includes('api_key=secret') || text.includes('frag-secret'),
      leaksArticleText: text.includes('ARTICLE_TEXT_PRIVATE_MARKER_PR4')
    };
  })()`);
  return JSON.parse(raw.trim()) as {
    text: string;
    hasRtl: boolean;
    hasLtr: boolean;
    autoQuoteCount: number;
    leaksUserinfo: boolean;
    leaksRawToken: boolean;
    leaksArticleText: boolean;
  };
}

describe("localized persisted audit report", () => {
  it("renders Hebrew/mixed, plagiarism, source redaction, and English fallback from SQLite", async () => {
    await withDashboard("localized-audit", seedLocalizedChecks, async ({ handle, seededIds }) => {
      await browser.open(`${handle.url}/reports/${seededIds.mixedId}`);
      await assertHydrated({ timeoutMs: 15_000 });
      await browser.waitForText("בדיקת עובדות מבוססת מקורות", 15_000);

      let state = await pageState();
      expect(state.hasRtl).toBe(true);
      expect(state.autoQuoteCount).toBeGreaterThan(0);
      expect(state.text).toContain("המשחק Rummikub מתאים לשני שחקנים בלבד.");
      expect(state.text).toContain("ויטמין C הוא תרכובת אורגנית מסיסה במים.");
      expect(state.text).toContain("בדיקת מקוריות");
      expect(state.text).toContain("2 טענות נבדקו");
      expect(state.text).toContain("2 דולגו");
      expect(state.text).toContain("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 86-129");
      expect(state.text).toContain("ניסוח מוצע");
      expect(state.text).toContain("רמת ביטחון: גבוהה");
      expect(state.text).toContain("90%");
      expect(state.text).toContain("Rummikub");
      expect(state.text).not.toContain("רמיקוב");
      expect(state.leaksUserinfo).toBe(false);
      expect(state.leaksRawToken).toBe(false);
      expect(state.leaksArticleText).toBe(false);

      await spawnBrowserEval(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent?.includes('הצגת ראיות (1)'));
        if (!button) throw new Error('Hebrew evidence button not found');
        button.click();
        return true;
      })()`);
      await browser.waitForText("דמיון: 90%", 15_000);
      state = await pageState();
      expect(state.hasRtl).toBe(true);
      expect(state.text).toContain("דמיון: 90%");
      expect(state.text).not.toContain("90% similar");

      await browser.open(`${handle.url}/reports/${seededIds.enId}`);
      await assertHydrated({ timeoutMs: 15_000 });
      await browser.waitForText("Fact Check (Grounded)", 15_000);
      state = await pageState();
      expect(state.hasLtr).toBe(true);
      expect(state.text).toContain("Suggested rewrite");
      expect(state.text).toContain("Location:");
      expect(state.text).not.toContain("דוח איכות");
      expect(state.text).not.toContain("ניסוח מוצע");
      expect(state.leaksArticleText).toBe(false);

      await browser.open(`${handle.url}/reports/${seededIds.unknownId}`);
      await assertHydrated({ timeoutMs: 15_000 });
      await browser.waitForText("Fact Check (Grounded)", 15_000);
      state = await pageState();
      expect(state.hasLtr).toBe(true);
      expect(state.text).toContain("Fact Check (Grounded)");
      expect(state.text).not.toContain("דוח איכות");
      expect(state.leaksArticleText).toBe(false);
    });
  }, 120_000);
});
