import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { homedir } from "os";
import { join } from "path";
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
}

export interface Config {
  copyscapeUser: string;
  copyscapeKey: string;
  parallelApiKey?: string;
  exaApiKey?: string;
  anthropicApiKey?: string;
  minimaxApiKey?: string;
  openrouterApiKey?: string;
  llmProvider?: "minimax" | "anthropic" | "openrouter";
  toneGuideFile?: string;
  skills: SkillsConfig;
  thresholds?: Record<string, Threshold>;
  contexts?: Record<string, string>;
}

const CONFIG_DIR = join(homedir(), ".checkit");
const LEGACY_CONFIG_DIR = join(homedir(), ".article-checker");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

// One-time migration: move ~/.article-checker → ~/.checkit if only the old exists.
// Guarded so this is idempotent and silent in the common case.
if (!existsSync(CONFIG_DIR) && existsSync(LEGACY_CONFIG_DIR)) {
  try {
    renameSync(LEGACY_CONFIG_DIR, CONFIG_DIR);
    console.error("Migrated config from ~/.article-checker to ~/.checkit");
  } catch (err) {
    console.error(`Failed to migrate ~/.article-checker to ~/.checkit: ${(err as Error).message}`);
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
};

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function readConfig(): Config {
  const file: Partial<Config> = existsSync(CONFIG_FILE)
    ? (JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Partial<Config>)
    : {};

  return {
    copyscapeUser: process.env.COPYSCAPE_USER ?? file.copyscapeUser ?? "",
    copyscapeKey: process.env.COPYSCAPE_KEY ?? file.copyscapeKey ?? "",
    parallelApiKey: process.env.PARALLEL_API_KEY ?? file.parallelApiKey,
    exaApiKey: process.env.EXA_API_KEY ?? file.exaApiKey,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? file.anthropicApiKey,
    minimaxApiKey: process.env.MINIMAX_API_KEY ?? file.minimaxApiKey,
    openrouterApiKey: process.env.OPENROUTER_API_KEY ?? file.openrouterApiKey,
    llmProvider: (() => {
      const validProviders = ["minimax", "anthropic", "openrouter"];
      const rawProvider = process.env.LLM_PROVIDER ?? file.llmProvider;
      return validProviders.includes(rawProvider as string) ? (rawProvider as Config["llmProvider"]) : undefined;
    })(),
    toneGuideFile: process.env.TONE_GUIDE_FILE ?? file.toneGuideFile,
    skills: { ...DEFAULT_SKILLS, ...(file.skills ?? {}) },
    thresholds: file.thresholds,
  };
}

export function writeConfig(config: Partial<Config>): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  const existing = configExists()
    ? (JSON.parse(readFileSync(CONFIG_FILE, "utf-8")) as Config)
    : {};
  writeFileSync(CONFIG_FILE, JSON.stringify({ ...existing, ...config }, null, 2));
}

/** @deprecated use writeConfig */
export const saveConfig = writeConfig;

export function configPath(): string {
  return CONFIG_FILE;
}
