import { describe, it, expect } from "bun:test";
import { bootDashboard } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths } from "../helpers/temp-paths.ts";
import { openDb, insertCheck } from "../../../src/db.ts";

// Regression: /api/reports/[id]/deep-audit POST must reject CSRF-missing and
// CSRF-wrong requests with 403 (via guardLocalMutation). Previously the route
// had no guard and would attempt a real Gemini Deep Research call.
//
// We only exercise the CSRF-reject branches. The valid-CSRF branch has no
// CHECKAPP_E2E shim in this route and would hit real Gemini, so we do not
// fire it here.

function seedCheckWithArticleText(dbPath: string): number {
  const db = openDb(dbPath);
  const id = insertCheck(db, {
    source: "csrf-regression",
    wordCount: 10,
    results: [],
    totalCostUsd: 0,
    articleText: "Coffee contains caffeine.",
  });
  db.close();
  return id;
}

describe("deep audit POST — CSRF guard", () => {
  it("rejects POST without x-checkapp-csrf header with 403", async () => {
    const temp = allocateTempPaths();
    temp.initDbSchema();
    temp.initCsrfToken();
    temp.writeConfig({ geminiApiKey: "dummy", skills: { factCheck: false } });
    const checkId = seedCheckWithArticleText(temp.dbPath);
    const handle = await bootDashboard({
      scenario: "deep-audit-csrf",
      configPath: temp.configPath,
      dbPath: temp.dbPath,
      csrfPath: temp.csrfPath,
    });
    try {
      const res = await fetch(
        `${handle.url}/api/reports/${checkId}/deep-audit`,
        { method: "POST" },
      );
      expect(res.status).toBe(403);
    } finally {
      await handle.stop();
      await new Promise((r) => setTimeout(r, 200));
      temp.cleanup();
    }
  }, 60_000);

  it("rejects POST with wrong x-checkapp-csrf value with 403", async () => {
    const temp = allocateTempPaths();
    temp.initDbSchema();
    temp.initCsrfToken();
    temp.writeConfig({ geminiApiKey: "dummy", skills: { factCheck: false } });
    const checkId = seedCheckWithArticleText(temp.dbPath);
    const handle = await bootDashboard({
      scenario: "deep-audit-csrf",
      configPath: temp.configPath,
      dbPath: temp.dbPath,
      csrfPath: temp.csrfPath,
    });
    try {
      const res = await fetch(
        `${handle.url}/api/reports/${checkId}/deep-audit`,
        { method: "POST", headers: { "x-checkapp-csrf": "wrong" } },
      );
      expect(res.status).toBe(403);
    } finally {
      await handle.stop();
      await new Promise((r) => setTimeout(r, 200));
      temp.cleanup();
    }
  }, 60_000);
});
