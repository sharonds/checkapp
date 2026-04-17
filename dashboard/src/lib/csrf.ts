import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const CONFIG_DIR = process.env.CHECKAPP_CONFIG_DIR ?? join(homedir(), ".checkapp");
const DEFAULT_TOKEN_PATH = join(CONFIG_DIR, "csrf.token");
const TOKEN_PATH = process.env.CHECKAPP_CSRF_PATH ?? DEFAULT_TOKEN_PATH;

/**
 * Read (or create on first call) the CheckApp local CSRF token.
 * 32 random bytes, hex-encoded. Stored at ~/.checkapp/csrf.token or CHECKAPP_CSRF_PATH override.
 * Regenerates token if file is empty or contains only whitespace.
 */
export function getCsrfToken(): string {
  const configDir = process.env.CHECKAPP_CONFIG_DIR ?? join(homedir(), ".checkapp");
  if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });

  const tokenPath = process.env.CHECKAPP_CSRF_PATH ?? join(configDir, "csrf.token");
  const existing = existsSync(tokenPath) ? readFileSync(tokenPath, "utf-8").trim() : "";
  if (existing.length >= 16) return existing;

  const fresh = randomBytes(32).toString("hex");
  writeFileSync(tokenPath, fresh, { mode: 0o600 });
  return fresh;
}
