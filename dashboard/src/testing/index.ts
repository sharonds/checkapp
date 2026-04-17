import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { writeAppConfig, readAppConfig } from "@/lib/config";
import type { SkillId, SkillProviderConfig } from "@/lib/providers";

const TEST_CSRF = "test-csrf-" + "x".repeat(32);

export function csrfTokenForTests(): string {
  return TEST_CSRF;
}

export function writeTokenFile(contents: string, path = process.env.CHECKAPP_CSRF_PATH ?? "/tmp/checkapp-test-csrf") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, { mode: 0o600 });
  process.env.CHECKAPP_CSRF_PATH = path;
}

export function writeTestConfig(partial: { providers?: Partial<Record<SkillId, SkillProviderConfig>>; skills?: Record<string, boolean> }) {
  writeAppConfig(partial);
  return readAppConfig();
}
