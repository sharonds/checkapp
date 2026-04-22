import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";

// Browser coverage for /skills (issue #44 follow-up).
//
// Asserts the skills list renders every SKILL_META row and that the SEO
// switch (the one skill with no provider requirement, so it's always "ready")
// actually toggles and persists. If the skill count here diverges from the
// dashboard API, update SKILL_META in dashboard/src/app/api/skills/route.ts
// first and then this expectation.
//
// Scope note: the plan mentioned 12 skills, but the live API today only
// exposes 7 (plagiarism, aiDetection, seo, factCheck, tone, legal, summary).
// We assert the live surface so this test tracks reality.
const EXPECTED_SKILL_NAMES = [
  "Plagiarism Check",
  "AI Detection",
  "SEO Analysis",
  "Fact Check",
  "Tone of Voice",
  "Legal Risk",
  "Content Summary",
];

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
    await browser.close().catch(() => {});
    await handle.stop();
    await new Promise((r) => setTimeout(r, 500));
    temp.cleanup();
  }
}

describe("dashboard /skills — list + SEO toggle", () => {
  it(
    "renders every skill row and the SEO switch flips persisted state",
    async () => {
      await withDashboard(
        "settings-default-off",
        {},
        async ({ handle }) => {
          await browser.open(`${handle.url}/skills`);
          await assertHydrated({ timeoutMs: 15_000 });

          // The agent-browser interactive snapshot strips visible text for
          // role-based output, so read the rendered body text directly.
          const bodyText = await spawnBrowserEval("document.body.innerText");
          for (const name of EXPECTED_SKILL_NAMES) {
            expect(bodyText).toContain(name);
          }

          // Read baseline config via GET (no CSRF needed).
          const before = await (await fetch(`${handle.url}/api/skills`)).json();
          const seoBefore = (before as Array<{ id: string; enabled: boolean }>).find(
            (s) => s.id === "seo",
          );
          expect(seoBefore).toBeDefined();

          // Click the switch inside the SEO card. The Card has no stable test
          // id, so we resolve it by walking from the "SEO Analysis" text node
          // up to the nearest Card and click the switch descendant.
          const clickResult = await spawnBrowserEval(
            `(() => {
              const candidates = Array.from(document.querySelectorAll('*'));
              const label = candidates.find(
                (el) => el.textContent && el.textContent.trim() === 'SEO Analysis',
              );
              if (!label) return 'no-label';
              let card = label.closest('[class*="rounded-xl"]') || label.parentElement;
              for (let i = 0; i < 6 && card && !card.querySelector('[role="switch"]'); i++) {
                card = card.parentElement;
              }
              const sw = card && card.querySelector('[role="switch"]');
              if (!sw) return 'no-switch';
              sw.click();
              return 'ok';
            })()`,
          );
          expect(clickResult.replace(/\s|"/g, "")).toBe("ok");

          // Wait for optimistic update + server round-trip.
          await new Promise((r) => setTimeout(r, 1500));

          const after = await (await fetch(`${handle.url}/api/skills`)).json();
          const seoAfter = (after as Array<{ id: string; enabled: boolean }>).find(
            (s) => s.id === "seo",
          );
          expect(seoAfter?.enabled).toBe(!seoBefore!.enabled);
        },
      );
    },
    90_000,
  );
});
