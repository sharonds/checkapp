import { describe, it, expect } from "bun:test";
import { bootDashboard } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths } from "../helpers/temp-paths.ts";
import { browser } from "../helpers/browser.ts";
import { assertHydrated, spawnBrowserEval } from "../helpers/hydration.ts";

// Oracle test for GitHub #44. Theme toggle is the simplest interactive
// control in the app shell; if it fires, React has hydrated. If not, the
// entire dashboard is non-interactive.

describe("dashboard hydration — theme toggle", () => {
  it(
    "clicking Toggle theme flips the <html> class",
    async () => {
      const temp = allocateTempPaths();
      temp.initDbSchema();
      temp.writeConfig({});
      const handle = await bootDashboard({
        scenario: "settings-default-off",
        configPath: temp.configPath,
        dbPath: temp.dbPath,
      });
      try {
        await browser.open(handle.url);

        const before = (
          await spawnBrowserEval(
            "document.documentElement.className.includes('dark') ? 'dark' : 'light'",
          )
        )
          .trim()
          .replace(/"/g, "");
        expect(before === "dark" || before === "light").toBe(true);

        const fibers = await assertHydrated({ timeoutMs: 15_000 });
        expect(fibers).toBeGreaterThan(0);

        await spawnBrowserEval(
          "document.querySelector('[aria-label=\"Toggle theme\"]').click(); 'ok'",
        );
        await new Promise((r) => setTimeout(r, 500));

        const after = (
          await spawnBrowserEval(
            "document.documentElement.className.includes('dark') ? 'dark' : 'light'",
          )
        )
          .trim()
          .replace(/"/g, "");
        expect(after).not.toBe(before);
      } finally {
        await browser.close().catch(() => {});
        await handle.stop();
        temp.cleanup();
      }
    },
    90_000,
  );
});
