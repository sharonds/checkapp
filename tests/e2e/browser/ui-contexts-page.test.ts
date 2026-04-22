import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";
import { openDb, insertContext } from "../../../src/db.ts";

// Browser coverage for /contexts (issue #44 follow-up). The page lists
// CONTEXT_TYPES cards; a seeded context's preview surfaces inside the
// corresponding "Tone Guide" card.

async function withDashboard<T>(
  scenario: string,
  cfg: Record<string, unknown>,
  seedDb: ((dbPath: string) => void) | null,
  work: (ctx: { handle: DashboardHandle; temp: TempPaths; token: string }) => Promise<T>,
): Promise<T> {
  const temp = allocateTempPaths();
  temp.initDbSchema();
  const token = temp.initCsrfToken();
  temp.writeConfig(cfg);
  if (seedDb) seedDb(temp.dbPath);
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

describe("dashboard /contexts — seeded context renders", () => {
  it(
    "shows a pre-seeded tone-guide preview with char count",
    async () => {
      const SEED_CONTENT = "Write in plain English. Short sentences. Avoid jargon.";
      await withDashboard(
        "settings-default-off",
        {},
        (dbPath) => {
          const db = openDb(dbPath);
          insertContext(db, {
            type: "tone-guide",
            name: "Tone Guide",
            content: SEED_CONTENT,
          });
          db.close();
        },
        async ({ handle }) => {
          await browser.open(`${handle.url}/contexts`);
          await assertHydrated({ timeoutMs: 15_000 });

          // Wait for the /api/contexts fetch to populate the UI.
          await browser.waitForText("Tone Guide");

          const bodyText = await spawnBrowserEval("document.body.innerText");
          // Every context-type card renders, so "Tone Guide" alone doesn't
          // prove the seed worked — assert the seeded content preview and
          // the configured-state char count together.
          expect(bodyText).toContain(SEED_CONTENT);
          expect(bodyText).toContain(`${SEED_CONTENT.length} chars`);

          // And the other (unseeded) cards still render their "Not configured"
          // empty state, confirming the seed only affected tone-guide.
          expect(bodyText).toContain("Not configured");
        },
      );
      // Create/delete/edit interactions are not exercised here because they
      // trigger Sheet + optimistic state machines that are out of scope for a
      // 90s smoke test. The seeded-row rendering alone is enough to prove the
      // /api/contexts GET → render pipeline hydrates correctly.
    },
    90_000,
  );
});
