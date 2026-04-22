import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";
import { openDb, insertCheck } from "../../../src/db.ts";

// Browser coverage for /reports + /reports/<id> + DeepAuditPanel (issue #44).
//
// Scope adjustment vs plan: the dashboard's POST
// /api/reports/<id>/deep-audit route does NOT honor CHECKAPP_E2E — it calls
// Gemini's interactions API directly, which 400s with a dummy key. (The
// src/skills/factcheck-deep-research.ts path DOES honor CHECKAPP_E2E, which
// is why tests/e2e/browser/dashboard-tier-routing.test.ts exercises premium
// by spawning a subprocess that calls the skill directly.)
//
// So instead of clicking "Request Deep Audit" through the UI, we pre-seed a
// deep audit row in 'in_progress' state and assert the DeepAuditPanel
// renders that state correctly. This still covers: reports list rendering,
// report detail rendering, DeepAuditPanel mount, and DeepAuditPanel
// in-progress branch. Wiring the click-through E2E shim into the dashboard
// API route is filed as follow-up out of scope for #44.

async function withDashboard<T>(
  scenario: string,
  cfg: Record<string, unknown>,
  seedDb: ((dbPath: string) => number) | null,
  work: (ctx: {
    handle: DashboardHandle;
    temp: TempPaths;
    token: string;
    seededCheckId: number;
  }) => Promise<T>,
): Promise<T> {
  const temp = allocateTempPaths();
  temp.initDbSchema();
  const token = temp.initCsrfToken();
  temp.writeConfig(cfg);
  const seededCheckId = seedDb ? seedDb(temp.dbPath) : -1;
  const handle = await bootDashboard({
    scenario,
    configPath: temp.configPath,
    dbPath: temp.dbPath,
    csrfPath: temp.csrfPath,
  });
  try {
    return await work({ handle, temp, token, seededCheckId });
  } finally {
    await browser.close().catch(() => {});
    await handle.stop();
    await new Promise((r) => setTimeout(r, 500));
    temp.cleanup();
  }
}

function seedPremiumCheckAndInProgressAudit(dbPath: string): number {
  const db = openDb(dbPath);
  const id = insertCheck(db, {
    source: "seed-premium",
    wordCount: 20,
    results: [
      {
        skillId: "fact-check",
        name: "Fact Check",
        score: 92,
        verdict: "pass",
        summary: "Seeded fact-check result.",
        findings: [],
        costUsd: 0,
      },
    ] as unknown as Parameters<typeof insertCheck>[1]["results"],
    totalCostUsd: 0,
    articleText: "Coffee contains caffeine. Heart pumps blood.",
  });

  // Seed an active (in_progress) Deep Audit row pointing at this report.
  const started = Date.now();
  db.prepare(
    `INSERT INTO deep_audits (parent_type, parent_key, interaction_id, status, requested_by, started_at, cost_estimate_usd)
     VALUES ('check', ?, ?, 'in_progress', 'dashboard', ?, 1.5)`,
  ).run(String(id), `int_e2e_${id}`, started);

  db.close();
  return id;
}

describe("dashboard /reports — list + DeepAuditPanel in-progress rendering", () => {
  it(
    "lists seeded check and renders DeepAuditPanel in in-progress state",
    async () => {
      await withDashboard(
        "premium-pending",
        {
          factCheckTier: "premium",
          factCheckTierFlag: true,
          geminiApiKey: "dummy",
          skills: { factCheck: false },
        },
        seedPremiumCheckAndInProgressAudit,
        async ({ handle, seededCheckId }) => {
          expect(seededCheckId).toBeGreaterThan(0);

          // 1. /reports lists the seeded row.
          await browser.open(`${handle.url}/reports`);
          await assertHydrated({ timeoutMs: 15_000 });
          const listed = await (async () => {
            const deadline = Date.now() + 15_000;
            while (Date.now() < deadline) {
              const body = await spawnBrowserEval("document.body.innerText");
              if (body.includes("seed-premium")) return true;
              await new Promise((r) => setTimeout(r, 400));
            }
            return false;
          })();
          expect(listed).toBe(true);

          // 2. Navigate to the report detail page.
          await browser.open(`${handle.url}/reports/${seededCheckId}`);
          await assertHydrated({ timeoutMs: 15_000 });
          await browser.waitForText("Deep Audit");

          // 3. DeepAuditPanel should render the in-progress branch for the
          //    pre-seeded audit row (the GET handler reads it from SQLite).
          const seenInProgress = await (async () => {
            const deadline = Date.now() + 20_000;
            while (Date.now() < deadline) {
              const body = await spawnBrowserEval("document.body.innerText");
              if (body.includes("Deep Audit in progress")) return true;
              await new Promise((r) => setTimeout(r, 400));
            }
            return false;
          })();
          if (!seenInProgress) {
            const body = await spawnBrowserEval("document.body.innerText");
            throw new Error(
              `DeepAuditPanel never rendered in-progress state. Body tail:\n${body.slice(-1500)}`,
            );
          }
          expect(seenInProgress).toBe(true);
        },
      );
    },
    90_000,
  );
});
