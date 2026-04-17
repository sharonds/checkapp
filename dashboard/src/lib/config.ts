import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONFIG_DIR = join(homedir(), ".checkapp");
const LEGACY_DIRS = [
  join(homedir(), ".checkit"),
  join(homedir(), ".article-checker"),
];
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

// One-time migration: move whichever legacy dir exists to ~/.checkapp. Idempotent and silent when no legacy dir is present.
if (!existsSync(CONFIG_DIR)) {
  for (const legacy of LEGACY_DIRS) {
    if (existsSync(legacy)) {
      try {
        renameSync(legacy, CONFIG_DIR);
        console.error(`Migrated config from ${legacy} to ${CONFIG_DIR}`);
        break;
      } catch (err) {
        console.error(`Failed to migrate ${legacy} to ${CONFIG_DIR}: ${(err as Error).message}`);
      }
    }
  }
}

export function readAppConfig(): Record<string, unknown> {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
}

export function writeAppConfig(partial: Record<string, unknown>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = readAppConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, ...partial }, null, 2));
}

function maskKey(key: string | undefined): string {
  if (!key || key.length < 8) return key ? "****" : "";
  return "****" + key.slice(-4);
}

export function getApiKeyStatus() {
  const env = process.env;
  const config = readAppConfig() as Record<string, string>;
  return {
    copyscape: !!(env.COPYSCAPE_USER || config.copyscapeUser) && !!(env.COPYSCAPE_KEY || config.copyscapeKey),
    exa: !!(env.EXA_API_KEY || config.exaApiKey),
    minimax: !!(env.MINIMAX_API_KEY || config.minimaxApiKey),
    anthropic: !!(env.ANTHROPIC_API_KEY || config.anthropicApiKey),
    parallel: !!(env.PARALLEL_API_KEY || config.parallelApiKey),
    openrouter: !!(env.OPENROUTER_API_KEY || config.openrouterApiKey),
  };
}

export function getMaskedConfig(): Record<string, unknown> {
  const config = readAppConfig();
  const masked = { ...config };
  for (const k of ["copyscapeKey", "anthropicApiKey", "minimaxApiKey", "exaApiKey", "parallelApiKey", "openrouterApiKey"]) {
    if (masked[k]) masked[k] = maskKey(masked[k] as string);
  }
  return masked;
}
