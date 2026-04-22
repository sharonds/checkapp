import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import lockfile from "proper-lockfile";
import type { Threshold } from "./thresholds.ts";

export interface SkillsConfig {
  plagiarism: boolean;
  aiDetection: boolean;
  seo: boolean;
  factCheck: boolean;
  tone: boolean;
  legal: boolean;
  summary: boolean;
  brief: boolean;
  purpose: boolean;
  grammar?: boolean;
  academic?: boolean;
  selfPlagiarism?: boolean;
}

export interface Config {
  copyscapeUser: string;
  copyscapeKey: string;
  parallelApiKey?: string;
  exaApiKey?: string;
  anthropicApiKey?: string;
  minimaxApiKey?: string;
  openrouterApiKey?: string;
  geminiApiKey?: string;
  llmProvider?: "minimax" | "anthropic" | "openrouter" | "gemini";
  factCheckTier?: "basic" | "standard" | "premium";
  factCheckTierFlag?: boolean;
  toneGuideFile?: string;
  skills: SkillsConfig;
  thresholds?: Record<string, Threshold>;
  contexts?: Record<string, string>;
  providers?: Partial<Record<import("./providers/types.ts").SkillId, import("./providers/types.ts").SkillProviderConfig>>;
}

const CONFIG_DIR = join(homedir(), ".checkapp");
const LEGACY_DIRS = [
  join(homedir(), ".checkit"),
  join(homedir(), ".article-checker"),
];
// CHECKAPP_CONFIG_PATH lets tests and E2E harnesses redirect reads/writes to
// a temp file without touching the developer's real ~/.checkapp/config.json.
const CONFIG_FILE = process.env.CHECKAPP_CONFIG_PATH ?? join(CONFIG_DIR, "config.json");

// One-time migration: move legacy config dirs to new location
// Guarded so this is idempotent and silent in the common case.
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

const DEFAULT_SKILLS: SkillsConfig = {
  plagiarism: true,
  aiDetection: true,
  seo: true,
  factCheck: false,
  tone: false,
  legal: false,
  summary: false,
  brief: false,
  purpose: false,
  grammar: false,
  academic: false,
  selfPlagiarism: false,
};

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function readConfig(): Config {
  const file: Partial<Config> = existsSync(CONFIG_FILE)
    ? (JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Partial<Config>)
    : {};

  // --deep-fact-check CLI flag sets this env var; swap fact-check provider at
  // config-read time so all downstream readers see it without further plumbing.
  let providers = file.providers;
  if (process.env.CHECKAPP_DEEP_FACT_CHECK === "1" && process.env.CHECKAPP_DEEP_FACT_CHECK_KEY) {
    providers = {
      ...(providers ?? {}),
      "fact-check": { provider: "exa-deep-reasoning", apiKey: process.env.CHECKAPP_DEEP_FACT_CHECK_KEY },
    };
  }

  return {
    copyscapeUser: process.env.COPYSCAPE_USER ?? file.copyscapeUser ?? "",
    copyscapeKey: process.env.COPYSCAPE_KEY ?? file.copyscapeKey ?? "",
    parallelApiKey: process.env.PARALLEL_API_KEY ?? file.parallelApiKey,
    exaApiKey: process.env.EXA_API_KEY ?? file.exaApiKey,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? file.anthropicApiKey,
    minimaxApiKey: process.env.MINIMAX_API_KEY ?? file.minimaxApiKey,
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? file.openrouterApiKey,
    geminiApiKey: process.env.GEMINI_API_KEY ?? file.geminiApiKey,
    llmProvider: (() => {
      const validProviders = ["minimax", "anthropic", "openrouter", "gemini"];
      const rawProvider = process.env.LLM_PROVIDER ?? file.llmProvider;
      return validProviders.includes(rawProvider as string) ? (rawProvider as Config["llmProvider"]) : undefined;
    })(),
    factCheckTier: file.factCheckTier,
    factCheckTierFlag: file.factCheckTierFlag,
    toneGuideFile: process.env.TONE_GUIDE_FILE ?? file.toneGuideFile,
    skills: { ...DEFAULT_SKILLS, ...(file.skills ?? {}) },
    thresholds: file.thresholds,
    contexts: file.contexts,
    providers,
  };
}

export async function writeConfig(config: Partial<Config>): Promise<void> {
  mkdirSync(dirname(CONFIG_FILE), { recursive: true });
  // Atomic idempotent bootstrap: exclusive-create succeeds once, subsequent
  // callers get EEXIST and fall through. No TOCTOU between existsSync and write.
  try {
    writeFileSync(CONFIG_FILE, "{}", { flag: "wx" });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  const release = await lockfile.lock(CONFIG_FILE, {
    retries: { retries: 5, minTimeout: 50, maxTimeout: 200 },
  });
  try {
    const existing = JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Config;
    writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...config }, null, 2));
  } finally {
    await release();
  }
}

/** @deprecated use writeConfig */
export const saveConfig = writeConfig;

export function configPath(): string {
  return CONFIG_FILE;
}
