import { describe, expect, it, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { readConfig, writeConfig } from "./config.ts";

describe("readConfig", () => {
  describe("hermetic reads", () => {
    let savedConfigPath: string | undefined;
    let tempDir: string;

    beforeEach(() => {
      savedConfigPath = process.env.CHECKAPP_CONFIG_PATH;
      tempDir = mkdtempSync(join(tmpdir(), "checkapp-config-isolated-"));
      const p = join(tempDir, "config.json");
      writeFileSync(p, "{}");
      process.env.CHECKAPP_CONFIG_PATH = p;
    });

    afterEach(() => {
      if (savedConfigPath === undefined) delete process.env.CHECKAPP_CONFIG_PATH;
      else process.env.CHECKAPP_CONFIG_PATH = savedConfigPath;
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("DEFAULT_SKILLS lists grammar, academic, and selfPlagiarism (disabled by default)", () => {
      const cfg = readConfig();
      expect(cfg.skills).toHaveProperty("grammar", false);
      expect(cfg.skills).toHaveProperty("academic", false);
      expect(cfg.skills).toHaveProperty("selfPlagiarism", false);
    });

    test("loads OPENALEX_MAILTO from env", () => {
      const saved = process.env.OPENALEX_MAILTO;
      process.env.OPENALEX_MAILTO = "research@example.com";
      try {
        const config = readConfig();
        expect(config.openalexMailto).toBe("research@example.com");
      } finally {
        if (saved === undefined) delete process.env.OPENALEX_MAILTO;
        else process.env.OPENALEX_MAILTO = saved;
      }
    });

    test("openalexMailto is undefined when env unset", () => {
      const saved = process.env.OPENALEX_MAILTO;
      delete process.env.OPENALEX_MAILTO;
      try {
        const config = readConfig();
        expect(config.openalexMailto).toBeUndefined();
      } finally {
        if (saved !== undefined) process.env.OPENALEX_MAILTO = saved;
      }
    });
  });

  test("writeConfig creates owner-only config file when POSIX modes are supported", async () => {
    const saved = process.env.CHECKAPP_CONFIG_PATH;
    const dir = mkdtempSync(join(tmpdir(), "checkapp-config-test-"));
    process.env.CHECKAPP_CONFIG_PATH = join(dir, "nested", "config.json");
    try {
      await writeConfig({ copyscapeUser: "u", copyscapeKey: "k" });
      const mode = statSync(process.env.CHECKAPP_CONFIG_PATH).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      if (saved === undefined) delete process.env.CHECKAPP_CONFIG_PATH;
      else process.env.CHECKAPP_CONFIG_PATH = saved;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
