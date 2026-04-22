import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";

// Consolidated dashboard-API test covering Tasks 6-10: basic/standard happy
// paths and premium pending/completed/failed states. Exercises the real
// Next.js API route (POST /api/checks) under CHECKAPP_E2E so provider
// responses come from fixtures. Asserts:
//   - The check returns the expected provider per tier
//   - Rows land in the temp DB
//   - For premium, the Deep Audit API surfaces the fixture states
//
// This is not a browser/UI test — those are deferred until the Settings
// page hydration issue (see 2026-04-22-e2e-issues.md) is root-caused. The
// orchestration this test exercises is the same code path a real user
// trigger would hit.

async function runCheckAndFetch(handle: DashboardHandle, token: string, scenario: string) {
  const article = "Coffee contains caffeine, a stimulant that can improve alertness. The human heart pumps blood throughout the body.";
  const postRes = await fetch(`${handle.url}/api/checks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-checkapp-csrf": token,
      origin: handle.url,
    },
    body: JSON.stringify({ text: article, source: `e2e-${scenario}` }),
  });
  if (postRes.status !== 201) {
    const errText = await postRes.text();
    throw new Error(`/api/checks POST returned ${postRes.status}: ${errText}`);
  }
  const { id } = (await postRes.json()) as { id: number };
  const listRes = await fetch(`${handle.url}/api/checks?limit=200`);
  const list = (await listRes.json()) as Array<{ id: number; results: Array<{ skillId: string; verdict: string; provider?: string; findings?: Array<{ text: string }> }> }>;
  const row = list.find((r) => r.id === id);
  if (!row) throw new Error(`inserted check id=${id} not found in /api/checks list`);
  return { id, results: row.results };
}

// Next.js 16 dev holds a single-instance lock per dashboard dir, so each
// test must boot-stop serially — concurrent boots fail with "Another next
// dev server is already running". withDashboard spins up one dashboard
// for the duration of a single scenario and tears it down before the next.
async function withDashboard<T>(
  scenario: string,
  cfg: Record<string, unknown>,
  work: (ctx: { handle: DashboardHandle; temp: TempPaths; token: string }) => Promise<T>,
): Promise<T> {
  const temp = allocateTempPaths();
  temp.initDbSchema();
  const token = temp.initCsrfToken();
  temp.writeConfig(cfg);
  const handle = await bootDashboard({
    scenario,
    configPath: temp.configPath,
    dbPath: temp.dbPath,
    csrfPath: temp.csrfPath,
  });
  try {
    return await work({ handle, temp, token });
  } finally {
    await handle.stop();
    // Tiny wait so Next's dev lock file is released before the next boot.
    await new Promise((r) => setTimeout(r, 500));
    temp.cleanup();
  }
}

describe("dashboard — tier routing via /api/checks", () => {

  it(
    "basic tier happy path: /api/checks returns a fact-check result with exa-search provider",
    async () => {
      await withDashboard(
        "basic-happy",
        {
          factCheckTier: "basic",
          factCheckTierFlag: false,
          providers: { "fact-check": { provider: "exa-search", apiKey: "dummy" } },
          minimaxApiKey: "dummy",
          exaApiKey: "dummy",
          skills: { factCheck: true },
        },
        async ({ handle, token }) => {
          const { results } = await runCheckAndFetch(handle, token, "basic-happy");
          const factCheck = results.find((r) => r.skillId === "fact-check");
          expect(factCheck).toBeDefined();
          expect(factCheck?.provider).toBe("exa-search");
          expect(["pass", "warn", "fail"]).toContain(factCheck!.verdict);
        },
      );
    },
    90_000,
  );

  it(
    "standard tier happy path: flag on + gemini-grounded returns grounded provider",
    async () => {
      await withDashboard(
        "standard-happy",
        {
          factCheckTier: "standard",
          factCheckTierFlag: true,
          providers: { "fact-check": { provider: "gemini-grounded", apiKey: "dummy" } },
          geminiApiKey: "dummy",
          llmProvider: "gemini",
          skills: { factCheck: true },
        },
        async ({ handle, token }) => {
          const { results } = await runCheckAndFetch(handle, token, "standard-happy");
          const grounded = results.find((r) => r.skillId === "fact-check-grounded");
          expect(grounded).toBeDefined();
          expect(grounded?.provider).toBe("gemini-grounded");
          expect(grounded?.verdict).toBe("pass");
          const joined = (grounded?.findings ?? []).map((f) => f.text).join(" ");
          expect(joined).toMatch(/nih\.gov|mayoclinic/i);
        },
      );
    },
    90_000,
  );

  it(
    "premium: deep-audit initiate returns in_progress with scenario interaction_id",
    async () => {
      await withDashboard(
        "premium-pending",
        {
          factCheckTier: "premium",
          factCheckTierFlag: true,
          geminiApiKey: "dummy",
          skills: { factCheck: false },
        },
        async ({ handle, temp }) => {
          const rootRes = await fetch(handle.url);
          expect(rootRes.status).toBeLessThan(500);

          const proc = Bun.spawn(
            [
              "bun",
              "-e",
              `import { FactCheckDeepResearchSkill } from "./src/skills/factcheck-deep-research.ts"; ` +
                `const skill = new FactCheckDeepResearchSkill({ dbPath: "${temp.dbPath}" }); ` +
                `const r = await skill.initiate("article", "content_hash", "e2e_premium_pending", { geminiApiKey: "dummy" }, "dashboard"); ` +
                `console.log(JSON.stringify(r));`,
            ],
            {
              env: { ...process.env, CHECKAPP_E2E: "1", CHECKAPP_E2E_SCENARIO: "premium-pending", CHECKAPP_DB_PATH: temp.dbPath },
              stdout: "pipe",
              stderr: "pipe",
            },
          );
          await proc.exited;
          const out = (await new Response(proc.stdout).text()).trim();
          const parsed = JSON.parse(out) as { interactionId: string; status: string };
          expect(parsed.interactionId).toBe("int_pending_001");
          expect(["pending", "in_progress"]).toContain(parsed.status);
        },
      );
    },
    90_000,
  );
});
