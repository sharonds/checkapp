import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("package surface guard rejects nested env files in fixture packages", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  for (const path of [
    "src/index.tsx",
    "src/report.ts",
    "src/audit/types.ts",
    "shared/check-summary.ts",
    "shared/report-url.ts",
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "docs/api.md",
    "docs/security.md",
    "docs/ARCHITECTURE.md",
    "dashboard/.env.local",
  ]) {
    const fullPath = join(root, path);
    mkdirSync(fullPath.replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(fullPath, path === "dashboard/.env.local" ? "SECRET=value\n" : "");
    if (path === "src/index.tsx") chmodSync(fullPath, 0o755);
  }

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("forbidden packaged file: dashboard/.env.local");
});

test("package surface guard rejects a non-executable CLI bin", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  for (const path of [
    "src/index.tsx",
    "src/report.ts",
    "src/audit/types.ts",
    "shared/check-summary.ts",
    "shared/report-url.ts",
    "README.md",
    "AGENTS.md",
    "SECURITY.md",
    "docs/api.md",
    "docs/security.md",
    "docs/ARCHITECTURE.md",
  ]) {
    const fullPath = join(root, path);
    mkdirSync(fullPath.replace(/\/[^/]+$/, ""), { recursive: true });
    writeFileSync(fullPath, path === "src/index.tsx" ? "#!/usr/bin/env bun\n" : "");
  }

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("CLI bin is not executable: src/index.tsx");
});
