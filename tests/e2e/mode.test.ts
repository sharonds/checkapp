import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isE2E, getScenario, liveProvidersAllowed, assertMocksOnly } from "../../src/e2e/mode.ts";
import { allocateTempPaths } from "./helpers/temp-paths.ts";

const ENV_KEYS = [
  "CHECKAPP_E2E",
  "CHECKAPP_E2E_SCENARIO",
  "CHECKAPP_ALLOW_LIVE_PROVIDERS",
] as const;

function snapshotEnv() {
  const saved: Record<string, string | undefined> = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
}

describe("src/e2e/mode", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = snapshotEnv();
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => restoreEnv(saved));

  it("isE2E is false without CHECKAPP_E2E=1", () => {
    expect(isE2E()).toBe(false);
    process.env.CHECKAPP_E2E = "1";
    expect(isE2E()).toBe(true);
  });

  it("liveProvidersAllowed defaults to false", () => {
    expect(liveProvidersAllowed()).toBe(false);
    process.env.CHECKAPP_ALLOW_LIVE_PROVIDERS = "1";
    expect(liveProvidersAllowed()).toBe(true);
  });

  it("getScenario returns null without the env var", () => {
    expect(getScenario()).toBeNull();
    process.env.CHECKAPP_E2E_SCENARIO = "basic-happy";
    expect(getScenario()).toBe("basic-happy");
  });

  it("assertMocksOnly is a no-op outside E2E mode", () => {
    expect(() => assertMocksOnly("exa")).not.toThrow();
  });

  it("assertMocksOnly throws in E2E mode when live is not allowed", () => {
    process.env.CHECKAPP_E2E = "1";
    expect(() => assertMocksOnly("exa")).toThrow(/E2E mode: live provider call to "exa" blocked/);
  });

  it("assertMocksOnly passes when live providers are explicitly allowed", () => {
    process.env.CHECKAPP_E2E = "1";
    process.env.CHECKAPP_ALLOW_LIVE_PROVIDERS = "1";
    expect(() => assertMocksOnly("exa")).not.toThrow();
  });
});

describe("tests/e2e/helpers/temp-paths", () => {
  it("allocates a unique temp dir with isolated config + db paths", () => {
    const a = allocateTempPaths();
    const b = allocateTempPaths();
    try {
      expect(a.dir).not.toBe(b.dir);
      expect(a.configPath.startsWith(a.dir)).toBe(true);
      expect(a.dbPath.startsWith(a.dir)).toBe(true);
    } finally {
      a.cleanup();
      b.cleanup();
    }
  });

  it("writeConfig persists JSON, cleanup removes the dir", () => {
    const t = allocateTempPaths();
    try {
      t.writeConfig({ factCheckTier: "standard", factCheckTierFlag: true });
      expect(existsSync(t.configPath)).toBe(true);
      const parsed = JSON.parse(readFileSync(t.configPath, "utf8")) as Record<string, unknown>;
      expect(parsed.factCheckTier).toBe("standard");
      expect(parsed.factCheckTierFlag).toBe(true);
    } finally {
      t.cleanup();
    }
    expect(existsSync(t.dir)).toBe(false);
  });

  it("does not touch the real ~/.checkapp directory", () => {
    const t = allocateTempPaths();
    try {
      const homeConfig = `${process.env.HOME}/.checkapp/config.json`;
      const before = existsSync(homeConfig) ? readFileSync(homeConfig, "utf8") : null;
      t.writeConfig({ marker: "e2e-temp-only" });
      const after = existsSync(homeConfig) ? readFileSync(homeConfig, "utf8") : null;
      expect(after).toBe(before);
    } finally {
      t.cleanup();
    }
  });

  it("loadScenario throws without a fixture or env var", async () => {
    const { loadScenario } = await import("../../src/e2e/fixtures.ts");
    expect(() => loadScenario()).toThrow(/No scenario selected/);
  });
});

// Verify the config + db modules honor CHECKAPP_CONFIG_PATH / CHECKAPP_DB_PATH.
// Module-level constants are evaluated on import, so we run a subprocess
// with the env vars set — the only way to observe the override taking effect
// on the real prod code path.
describe("src/config honors CHECKAPP_CONFIG_PATH (subprocess)", () => {
  it("readConfig reads from the env-overridden path", async () => {
    const t = allocateTempPaths();
    try {
      t.writeConfig({ factCheckTier: "standard", factCheckTierFlag: true });
      const proc = Bun.spawn(
        [
          "bun",
          "-e",
          `const { readConfig } = await import("./src/config.ts"); ` +
            `const c = readConfig(); ` +
            `console.log(JSON.stringify({ tier: c.factCheckTier, flag: c.factCheckTierFlag }));`,
        ],
        {
          env: { ...process.env, CHECKAPP_CONFIG_PATH: t.configPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await proc.exited;
      const out = await new Response(proc.stdout).text();
      const parsed = JSON.parse(out.trim());
      expect(parsed.tier).toBe("standard");
      expect(parsed.flag).toBe(true);
    } finally {
      t.cleanup();
    }
  });

  it("openDb honors CHECKAPP_DB_PATH", async () => {
    const t = allocateTempPaths();
    try {
      const proc = Bun.spawn(
        [
          "bun",
          "-e",
          `const { openDb } = await import("./src/db.ts"); ` +
            `const db = openDb(); ` +
            `db.run("CREATE TABLE IF NOT EXISTS probe (id INTEGER)"); ` +
            `db.run("INSERT INTO probe (id) VALUES (42)"); ` +
            `db.close(); ` +
            `console.log("ok");`,
        ],
        {
          env: { ...process.env, CHECKAPP_DB_PATH: t.dbPath },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      await proc.exited;
      const out = (await new Response(proc.stdout).text()).trim();
      expect(out).toBe("ok");
      // The DB file must exist at the temp path, NOT at ~/.checkapp/history.db.
      expect(existsSync(t.dbPath)).toBe(true);
    } finally {
      t.cleanup();
    }
  });
});
