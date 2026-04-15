import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
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
}

export interface Config {
  copyscapeUser: string;
  copyscapeKey: string;
  parallelApiKey?: string;
  exaApiKey?: string;
  anthropicApiKey?: string;
  minimaxApiKey?: string;
  toneGuideFile?: string;
  skills: SkillsConfig;
  thresholds?: Record<string, Threshold>;
  contexts?: Record<string, string>;
}

const CONFIG_DIR = join(homedir(), ".article-checker");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

const DEFAULT_SKILLS: SkillsConfig = {
  plagiarism: true,
  aiDetection: true,
  seo: true,
  factCheck: false,
  tone: false,
  legal: false,
  summary: false,
  brief: false,
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
