import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb } from "../../../src/db.ts";

export interface TempPaths {
  dir: string;
  configPath: string;
  dbPath: string;
  csrfPath: string;
  writeConfig: (config: Record<string, unknown>) => void;
  /** Create the full CheckApp DB schema at dbPath. Call before booting the
   *  dashboard so report pages and /api routes don't 500 on missing tables. */
  initDbSchema: () => void;
  /** Generate a deterministic CSRF token at csrfPath. The dashboard and
   *  tests read the same file, so tests can POST to mutating /api routes. */
  initCsrfToken: () => string;
  cleanup: () => void;
}

export function allocateTempPaths(): TempPaths {
  const dir = mkdtempSync(join(tmpdir(), "checkapp-e2e-"));
  const configPath = join(dir, "config.json");
  const dbPath = join(dir, "checkapp.db");
  const csrfPath = join(dir, "csrf.token");
  return {
    dir,
    configPath,
    dbPath,
    csrfPath,
    writeConfig(config) {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
    initDbSchema() {
      const db = openDb(dbPath);
      db.close();
    },
    initCsrfToken() {
      const token = "e2e".padEnd(64, "0");
      writeFileSync(csrfPath, token);
      return token;
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
