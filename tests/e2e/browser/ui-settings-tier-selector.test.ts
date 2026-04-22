import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";

// Flagship browser test for issue #44: proves the Fact-check Tier selector
// on /settings hydrates, responds to user input, persists via /api/config,
// and survives a full-page reload.

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

describe("dashboard /settings — fact-check tier selector", () => {
  it(
    "renders Basic/Standard/Deep Audit, clicks Standard, persists across reload",
    async () => {
      await withDashboard(
        "settings-default-off",
        {
          factCheckTierFlag: true,
          factCheckTier: "basic",
          geminiApiKey: "dummy",
        },
        async ({ handle }) => {
          await browser.open(`${handle.url}/settings`);
          await assertHydrated({ timeoutMs: 15_000 });
          await browser.waitForText("Fact-check Tier");

          const bodyText = await spawnBrowserEval("document.body.innerText");
          expect(bodyText).toContain("Basic");
          expect(bodyText).toContain("Standard");
          expect(bodyText).toContain("Deep Audit");

          // Click the Standard radio by value — stable because the selector
          // is rendered from a tight enum (basic/standard/premium).
          const clickResult = await spawnBrowserEval(
            `(() => {
              const el = document.querySelector('input[name="fact-check-tier"][value="standard"]');
              if (!el) return 'not-found';
              el.click();
              return 'ok';
            })()`,
          );
          expect(clickResult.replace(/\s|"/g, "")).toBe("ok");

          // Give the PATCH time to land.
          await new Promise((r) => setTimeout(r, 1500));

          const afterClick = (await (await fetch(`${handle.url}/api/config`)).json()) as {
            config: { factCheckTier?: string; factCheckTierFlag?: boolean };
          };
          expect(afterClick.config.factCheckTier).toBe("standard");
          expect(afterClick.config.factCheckTierFlag).toBe(true);

          // Reload and confirm the Standard radio is still selected.
          await browser.open(`${handle.url}/settings`);
          await assertHydrated({ timeoutMs: 15_000 });
          await browser.waitForText("Fact-check Tier");

          // Wait for the /api/config fetch to populate the radio state.
          const checked = await (async () => {
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline) {
              const raw = await spawnBrowserEval(
                `(() => {
                  const el = document.querySelector('input[name="fact-check-tier"][value="standard"]');
                  return el ? String(el.checked) : 'missing';
                })()`,
              );
              if (raw.includes("true")) return true;
              await new Promise((r) => setTimeout(r, 300));
            }
            return false;
          })();
          expect(checked).toBe(true);
        },
      );
    },
    90_000,
  );
});
