import { join } from "path";
import { homedir } from "os";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";

const CONFIG_DIR = join(homedir(), ".article-checker");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export interface Config {
  copyscapeUser: string;
  copyscapeKey: string;
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE);
}

export function readConfig(): Config {
  const text = readFileSync(CONFIG_FILE, "utf-8");
  return JSON.parse(text) as Config;
}

export function saveConfig(config: Config): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

export function configPath(): string {
  return CONFIG_FILE;
}
