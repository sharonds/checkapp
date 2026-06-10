import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";
import {
  bootDashboardProd,
  DASHBOARD_PROD_COMMAND,
  type DashboardHandle,
} from "../helpers/dashboard-boot-prod.ts";
import { openDb, insertCheck } from "../../../src/db.ts";
import type { AuditRecord } from "../../../src/audit/types.ts";
import type { SkillResult } from "../../../src/skills/types.ts";

async function withProdDashboard<T>(
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
  const handle = await bootDashboardProd({
    scenario: "prod-localized-audit",
    configPath: temp.configPath,
    dbPath: temp.dbPath,
    csrfPath: temp.csrfPath,
  });
  try {
    return await work({ handle, temp, seededIds });
  } finally {
    await browser.close().catch(() => {});
    await handle.stop();
    temp.cleanup();
  }
}

function mixedAudit(): AuditRecord {
  return {
    version: 1,
    auditId: "prod-audit-mixed",
    language: "mixed",
    direction: "auto",
    coverage: {
      wordsScanned: 80,
      sectionsDetected: 2,
      paragraphsScanned: 2,
      sentencesScanned: 4,
      claimsExtracted: 2,
      claimsChecked: 2,
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
  };
}

function seedMixedReport(dbPath: string): Record<string, number> {
  const db = openDb(dbPath);
  const results: SkillResult[] = [{
    skillId: "fact-check-grounded",
    name: "Fact Check (Grounded)",
    score: 50,
    verdict: "fail",
    summary: "2 claims checked.",
    provider: "gemini-grounded",
    findings: [{
      severity: "error",
      text: "לא נתמך (רמת ביטחון: גבוהה): המשחק Rummikub מתאים לשני שחקנים בלבד.",
      quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
      confidence: "high",
      confidenceRationale: "המקור הרשמי מציין שהמשחק מיועד ל-2 עד 4 שחקנים.",
      rewrite: "יש לכתוב: המשחק Rummikub מתאים ל-2 עד 4 שחקנים.",
      explanationLanguage: "he",
      location: {
        sectionId: "section-1",
        sectionTitle: "משחקים",
        paragraphIndex: 1,
        sentenceIndex: 0,
        startOffset: 86,
        endOffset: 129,
      },
      sources: [{
        title: "Rummikub official rules",
        url: "https://example.com/rummikub",
        quote: "2-4 players",
        relevanceScore: 0.9,
      }],
    }],
    costUsd: 0.04,
  }];
  const id = insertCheck(db, {
    source: "prod-mixed.md",
    wordCount: 80,
    results,
    totalCostUsd: 0.04,
    articleText: "PRIVATE_PROD_ARTICLE_TEXT",
    audit: mixedAudit(),
  });
  db.close();
  return { reportId: id };
}

describe("prod localized report E2E", () => {
  it("uses next start through the prod dashboard helper", () => {
    expect(DASHBOARD_PROD_COMMAND).toEqual(["bun", "run", "start"]);
    const dashboardPackage = JSON.parse(readFileSync(join(process.cwd(), "dashboard", "package.json"), "utf8"));
    expect(dashboardPackage.scripts.start).toContain("next start");
    expect(dashboardPackage.scripts.start).not.toContain("next dev");
  });

  it("renders persisted Hebrew/mixed audit report in the production dashboard", async () => {
    await withProdDashboard(seedMixedReport, async ({ handle, seededIds }) => {
      await browser.open(`${handle.url}/reports/${seededIds.reportId}`);
      await assertHydrated({ timeoutMs: 15_000 });
      await browser.waitForText("בדיקת עובדות מבוססת מקורות", 15_000);

      const initial = JSON.parse((await spawnBrowserEval(`(() => {
        const text = document.body.innerText || "";
        return {
          text,
          rtlCards: document.querySelectorAll('[dir="rtl"]').length,
          autoDirection: document.querySelectorAll('blockquote[dir="auto"], [dir="auto"]').length,
          leakedArticle: text.includes('PRIVATE_PROD_ARTICLE_TEXT')
        };
      })()`)).trim()) as {
        text: string;
        rtlCards: number;
        autoDirection: number;
        leakedArticle: boolean;
      };

      expect(initial.rtlCards).toBeGreaterThan(0);
      expect(initial.autoDirection).toBeGreaterThan(0);
      expect(initial.text).toContain("בדיקת עובדות מבוססת מקורות");
      expect(initial.text).toContain("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 86-129");
      expect(initial.text).toContain("ניסוח מוצע");
      expect(initial.text).not.toContain("Suggested rewrite");
      expect(initial.leakedArticle).toBe(false);

      await spawnBrowserEval(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find((candidate) => candidate.textContent?.includes('הצגת ראיות (1)'));
        if (!button) throw new Error('Hebrew evidence button not found');
        button.click();
        return true;
      })()`);
      await browser.waitForText("דמיון: 90%", 15_000);
      const drilldownText = await spawnBrowserEval("document.body.innerText");
      expect(drilldownText).toContain("דמיון: 90%");
      expect(drilldownText).not.toContain("90% similar");
    });
  }, 120_000);
});
