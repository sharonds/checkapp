import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { spawnSync } from "child_process";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeRequiredPackageFiles(root: string, options: { executableBin?: boolean; extraFiles?: Record<string, string> } = {}): void {
  const files: Record<string, string> = {
    "package.json": JSON.stringify({ name: "checkapp", bin: { checkapp: "src/index.tsx" } }),
    "src/index.tsx": "#!/usr/bin/env bun\n",
    "src/report.ts": "",
    "src/audit/types.ts": "",
    "shared/check-summary.ts": "",
    "shared/report-url.ts": "",
    "README.md": "",
    "AGENTS.md": "",
    "SECURITY.md": "",
    "docs/api.md": "",
    "docs/security.md": "",
    "docs/ARCHITECTURE.md": "",
    ...options.extraFiles,
  };

  for (const [path, content] of Object.entries(files)) {
    const fullPath = join(root, path);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, content);
    if (path === "src/index.tsx" && options.executableBin) chmodSync(fullPath, 0o755);
  }
}

test("package surface guard rejects nested env files in fixture packages", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  writeRequiredPackageFiles(root, {
    executableBin: true,
    extraFiles: { "dashboard/.env.local": "SECRET=value\n" },
  });

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("forbidden packaged file: dashboard/.env.local");
});

test("package surface guard does not require POSIX execute bits on Windows", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  writeRequiredPackageFiles(root, {
    extraFiles: { "dashboard/.env.local": "SECRET=value\n" },
  });

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root, CHECKAPP_PACKAGE_SURFACE_PLATFORM: "win32" },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("forbidden packaged file: dashboard/.env.local");
  expect(`${result.stdout}\n${result.stderr}`).not.toContain("CLI bin is not executable");
});

test("package surface guard normalizes Windows-style package paths before forbidden checks", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  writeRequiredPackageFiles(root, {
    extraFiles: { "dashboard\\.env.local": "SECRET=value\n" },
  });

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root, CHECKAPP_PACKAGE_SURFACE_PLATFORM: "win32" },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("forbidden packaged file: dashboard/.env.local");
});

test("package surface guard accepts a valid Windows fixture without POSIX execute bits", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  writeRequiredPackageFiles(root);

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root, CHECKAPP_PACKAGE_SURFACE_PLATFORM: "win32" },
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  expect(result.stdout).toContain("Package surface OK");
});

test.skipIf(process.platform === "win32")("package surface guard rejects a non-executable CLI bin on POSIX", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  writeRequiredPackageFiles(root);

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain("CLI bin is not executable: src/index.tsx");
});

test("package surface guard rejects missing npm bin metadata", () => {
  const root = mkdtempSync(join(tmpdir(), "checkapp-package-fixture-"));
  tempDirs.push(root);
  writeRequiredPackageFiles(root, { executableBin: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "checkapp" }));

  const result = spawnSync("bun", ["run", "scripts/check-package-surface.ts"], {
    cwd: process.cwd(),
    env: { ...process.env, CHECKAPP_PACKAGE_SURFACE_ROOT: root },
    encoding: "utf8",
  });

  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain('package.json must define bin.checkapp as "src/index.tsx"');
});
