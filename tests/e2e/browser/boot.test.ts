import { describe, it, expect } from "bun:test";
import { bootDashboard } from "../helpers/dashboard-boot.ts";
import { allocateTempPaths } from "../helpers/temp-paths.ts";

// Single smoke test for Task 4: prove the boot helper starts a real Next.js
// dashboard in E2E mode against temp paths, serves a 200 on /, and stops
// cleanly. This test is slow (next dev takes 10-30s to boot), so it's kept
// minimal and lives outside the main bun test suite.
describe("dashboard boot helper", () => {
  it(
    "spawns dashboard against temp paths and serves /",
    async () => {
      const temp = allocateTempPaths();
      temp.writeConfig({ factCheckTier: "basic", factCheckTierFlag: false });
      temp.initDbSchema();
      let handle;
      try {
        handle = await bootDashboard({
          scenario: "basic-happy",
          configPath: temp.configPath,
          dbPath: temp.dbPath,
        });
        const res = await fetch(handle.url);
        expect(res.status).toBeLessThan(400);
      } finally {
        if (handle) await handle.stop();
        temp.cleanup();
      }
    },
    90_000,
  );

  it(
    "rejects non-loopback host headers through the running dashboard",
    async () => {
      const temp = allocateTempPaths();
      temp.writeConfig({ factCheckTier: "basic", factCheckTierFlag: false });
      temp.initDbSchema();
      let handle;
      try {
        handle = await bootDashboard({
          scenario: "basic-happy",
          configPath: temp.configPath,
          dbPath: temp.dbPath,
        });
        const res = await fetch(handle.url, { headers: { host: "public.example" } });
        expect(res.status).toBe(403);
      } finally {
        if (handle) await handle.stop();
        temp.cleanup();
      }
    },
    90_000,
  );
});
