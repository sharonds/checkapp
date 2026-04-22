import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { SkillId, SkillProviderConfig } from "./providers";

const CONFIG_DIR = join(homedir(), ".checkapp");
const LEGACY_DIRS = [
  join(homedir(), ".checkit"),
  join(homedir(), ".article-checker"),
];
// CHECKAPP_CONFIG_PATH lets tests and E2E harnesses redirect to a temp file.
const CONFIG_PATH = process.env.CHECKAPP_CONFIG_PATH ?? join(CONFIG_DIR, "config.json");

export type FactCheckTier = "basic" | "standard" | "premium";

export interface AppConfig {
  copyscapeUser?: string;
  copyscapeKey?: string;
  parallelApiKey?: string;
  exaApiKey?: string;
  anthropicApiKey?: string;
  minimaxApiKey?: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  llmProvider?: "minimax" | "anthropic" | "openrouter" | "gemini";
  factCheckTier?: FactCheckTier;
  factCheckTierFlag?: boolean;
  toneGuideFile?: string;
  thresholds?: Record<string, unknown>;
  contexts?: Record<string, string>;
  skills?: Record<string, boolean>;
  providers?: Partial<Record<SkillId, SkillProviderConfig>>;
  [key: string]: unknown;
}

export interface ApiKeyStatus {
  copyscape: boolean;
  exa: boolean;
  minimax: boolean;
  anthropic: boolean;
  parallel: boolean;
  openrouter: boolean;
  gemini: boolean;
}

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

export function readAppConfig(): AppConfig {
  if (!existsSync(CONFIG_PATH)) return {};
  return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as AppConfig;
}

export function writeAppConfig(partial: Partial<AppConfig>): void {
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  const existing = readAppConfig();
  writeFileSync(CONFIG_PATH, JSON.stringify({ ...existing, ...partial }, null, 2));
}

function maskKey(key: string | undefined): string {
  if (!key || key.length < 8) return key ? "****" : "";
  return "****" + key.slice(-4);
}

export function getApiKeyStatus(): ApiKeyStatus {
  const env = process.env;
  const config = readAppConfig();
  return {
    copyscape: !!(env.COPYSCAPE_USER || config.copyscapeUser) && !!(env.COPYSCAPE_KEY || config.copyscapeKey),
    exa: !!(env.EXA_API_KEY || config.exaApiKey),
    minimax: !!(env.MINIMAX_API_KEY || config.minimaxApiKey),
    anthropic: !!(env.ANTHROPIC_API_KEY || config.anthropicApiKey),
    parallel: !!(env.PARALLEL_API_KEY || config.parallelApiKey),
    openrouter: !!(env.OPENROUTER_API_KEY || config.openrouterApiKey),
    gemini: !!(env.GEMINI_API_KEY || config.geminiApiKey),
  };
}

export function getMaskedConfig(): AppConfig {
  const config = readAppConfig();
  const masked: AppConfig = { ...config };
  for (const key of [
    "copyscapeKey",
    "anthropicApiKey",
    "minimaxApiKey",
    "exaApiKey",
    "parallelApiKey",
    "openrouterApiKey",
    "geminiApiKey",
  ] as const) {
    if (typeof masked[key] === "string" && masked[key]) {
      masked[key] = maskKey(masked[key] as string);
    }
  }
  return masked;
}
