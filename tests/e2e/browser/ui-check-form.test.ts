import { describe, it, expect } from "bun:test";
import { bootDashboard, type DashboardHandle } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths, type TempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";

// Browser coverage for the Run Check flow (issue #44 follow-up).
//
// Scope adjustment vs plan: the live /check page does NOT navigate after
// submit — it renders results inline with a "View full report" link to
// /reports/<id>. This test covers the actual shipped UX: paste text, click
// Run Check, wait for inline results, then navigate to the report page and
// confirm the fact-check result renders there too.

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

describe("dashboard /check — paste + run + view report", () => {
  it(
    "runs a basic-tier fact-check end-to-end through the browser",
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
        async ({ handle }) => {
          await browser.open(`${handle.url}/check`);
          await assertHydrated({ timeoutMs: 15_000 });

          const article =
            "Coffee contains caffeine, a stimulant that improves alertness. " +
            "The human heart pumps blood throughout the body.";

          // Fill the paste textarea directly — React's controlled input needs
          // a proper input event, which native setters + dispatchEvent give.
          const fillResult = await spawnBrowserEval(
            `(() => {
              const ta = document.querySelector('textarea');
              if (!ta) return 'no-textarea';
              const setter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value',
              ).set;
              setter.call(ta, ${JSON.stringify(article)});
              ta.dispatchEvent(new Event('input', { bubbles: true }));
              return 'ok';
            })()`,
          );
          expect(fillResult.replace(/\s|"/g, "")).toBe("ok");

          // Click the Run Check button.
          const clickResult = await spawnBrowserEval(
            `(() => {
              const btn = Array.from(document.querySelectorAll('button')).find(
                (b) => b.textContent && b.textContent.trim() === 'Run Check',
              );
              if (!btn) return 'no-button';
              btn.click();
              return 'ok';
            })()`,
          );
          expect(clickResult.replace(/\s|"/g, "")).toBe("ok");

          // Inline results heading appears when the check completes.
          await browser.waitForText("Results", 45_000);

          // Grab the report id from the "View full report" link href.
          const href = (
            await spawnBrowserEval(
              `(() => {
                const a = Array.from(document.querySelectorAll('a')).find(
                  (x) => x.textContent && x.textContent.trim() === 'View full report',
                );
                return a ? a.getAttribute('href') : null;
              })()`,
            )
          )
            .trim()
            .replace(/"/g, "");
          expect(href).toMatch(/^\/reports\/\d+$/);

          // Inline result should already show the Fact Check skill card.
          const inlineBody = await spawnBrowserEval("document.body.innerText");
          expect(inlineBody).toContain("Fact Check");

          // Navigate to the report page and re-assert hydration + fact-check presence.
          await browser.open(`${handle.url}${href}`);
          await assertHydrated({ timeoutMs: 15_000 });
          const reportBody = await spawnBrowserEval("document.body.innerText");
          expect(reportBody).toContain("Fact Check");
        },
      );
    },
    90_000,
  );
});
