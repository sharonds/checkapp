import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TempPaths {
  dir: string;
  configPath: string;
  dbPath: string;
  writeConfig: (config: Record<string, unknown>) => void;
  cleanup: () => void;
}

export function allocateTempPaths(): TempPaths {
  const dir = mkdtempSync(join(tmpdir(), "checkapp-e2e-"));
  const configPath = join(dir, "config.json");
  const dbPath = join(dir, "checkapp.db");
  return {
    dir,
    configPath,
    dbPath,
    writeConfig(config) {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
