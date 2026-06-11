import { mkdtempSync, rmSync, existsSync, readdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, relative } from "path";
import { spawnSync } from "child_process";

function run(cmd: string, args: string[], cwd = process.cwd()): string {
  const result = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}

function assertPackageSurface(root: string): void {
  const required = [
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
  ];
  for (const path of required) {
    if (!existsSync(join(root, path))) throw new Error(`missing packaged file: ${path}`);
  }
  if ((statSync(join(root, "src/index.tsx")).mode & 0o111) === 0) {
    throw new Error("CLI bin is not executable: src/index.tsx");
  }

  const forbiddenPatterns = [
    /\.test\.tsx?$/,
    /(^|\/)__tests__(\/|$)/,
    /^src\/testing\//,
    // src/e2e/* is intentionally packaged because provider adapters import
    // the inert CHECKAPP_E2E gates at runtime; fixture data under tests/ is not.
    /^dashboard\//,
    /^docs\/fact-audit-coverage-(ard|prd|validation)\.md$/,
    /^poc-replacement\//,
    /(^|\/)\.env/,
  ];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (forbiddenPatterns.some((pattern) => pattern.test(rel))) {
      throw new Error(`forbidden packaged file: ${rel}`);
    }
  }
}

const fixtureRoot = process.env.CHECKAPP_PACKAGE_SURFACE_ROOT;
if (fixtureRoot) {
  assertPackageSurface(fixtureRoot);
  console.log("Package surface OK");
} else {
  const temp = mkdtempSync(join(tmpdir(), "checkapp-pack-"));
  try {
    const packJson = JSON.parse(run("npm", ["pack", "--json"])) as Array<{ filename: string }>;
    const filename = packJson[0]?.filename;
    if (!filename) throw new Error("npm pack did not return a filename");

    run("tar", ["-xzf", filename, "-C", temp]);
    rmSync(filename, { force: true });

    const root = join(temp, "package");
    assertPackageSurface(root);
  run("bun", ["install", "--production"], root);
  run("bun", ["src/index.tsx", "--help"], root);
  console.log("Package surface OK");
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
