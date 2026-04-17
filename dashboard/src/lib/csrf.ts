import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { randomBytes } from "crypto";

const CONFIG_DIR = process.env.CHECKAPP_CONFIG_DIR ?? join(homedir(), ".checkapp");
const CSRF_FILE = join(CONFIG_DIR, "csrf.token");

/**
 * Read (or create on first call) the CheckApp local CSRF token.
 * 32 random bytes, hex-encoded. Stored at ~/.checkapp/csrf.token.
 */
export function getCsrfToken(): string {
  if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true });
  if (!existsSync(CSRF_FILE)) {
    const token = randomBytes(32).toString("hex");
    writeFileSync(CSRF_FILE, token, { encoding: "utf-8", mode: 0o600 });
    return token;
  }
  return readFileSync(CSRF_FILE, "utf-8").trim();
}
