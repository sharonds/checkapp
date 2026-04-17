#!/usr/bin/env bun
import { configExists, readConfig } from "./config.ts";
import { runSetup } from "./setup.tsx";
import { runCheck } from "./check.tsx";
import { openDb, queryRecent } from "./db.ts";
import { runBatch } from "./batch.ts";
import { resolveProvider } from "./providers/resolve.ts";
import type { Finding } from "./skills/types.ts";

const args = process.argv.slice(2);
const forceSetup = args.includes("--setup");
const showHistory = args.includes("--history");
const showUi = args.includes("--ui");
const deepFactCheck = args.includes("--deep-fact-check");
const estimateOnly = args.includes("--estimate-cost");
const batchIndex = args.indexOf("--batch");
const batchDir = batchIndex !== -1 ? args[batchIndex + 1] : undefined;
const outputIndex = args.indexOf("--output");
const outputPath = outputIndex !== -1 ? args[outputIndex + 1] : undefined;
if (outputPath && outputPath.startsWith("--")) {
  console.error("Error: --output requires a file path (e.g., --output report.md)");
  process.exit(1);
}
if (outputIndex !== -1 && !outputPath) {
  console.error("Error: --output requires a file path");
  process.exit(1);
}
const docUrl = args.find((a) => !a.startsWith("--") && a !== batchDir && a !== outputPath);

export function resolveDeepFactCheckEnv(deps: { configExists: () => boolean; env: NodeJS.ProcessEnv }): { allowed: boolean; apiKey?: string } {
  const envKey = deps.env.EXA_API_KEY;
  if (envKey) return { allowed: true, apiKey: envKey };
  if (!deps.configExists()) return { allowed: false };
  const cfg = readConfig();
  const existing = resolveProvider(cfg, "fact-check");
  if (existing?.apiKey) {
    return { allowed: true, apiKey: existing.apiKey };
  }
  return { allowed: false };
}

export function summarizeFixRun(r: { fixable: Finding[]; remaining: Finding[] }): string {
  if (r.fixable.length === 0 && r.remaining.length === 0) return "article is clean!";
  const parts: string[] = [];
  const warn = r.remaining.filter(f => f.severity === "warn").length;
  const err = r.remaining.filter(f => f.severity === "error").length;
  if (err) parts.push(`${err} error${err === 1 ? "" : "s"}`);
  if (warn) parts.push(`${warn} warning${warn === 1 ? "" : "s"}`);
  if (parts.length) return `Fixable findings applied; ${parts.join(", ")} remain.`;
  return "Fixable findings applied; article is clean!";
}

// Unset the deep-fact-check env vars after the run so they can't leak into
// child processes spawned later (e.g. --ui subprocess) or linger on exit.
const cleanupDeepEnv = () => {
  delete process.env.CHECKAPP_DEEP_FACT_CHECK;
  delete process.env.CHECKAPP_DEEP_FACT_CHECK_KEY;
};

async function main() {
  // index <dir>: ingest past articles into the self-plagiarism vector index.
  if (args[0] === "index") {
    const { indexArchive } = await import("./cli/index-archive.ts");
    const dir = args[1] ?? `${process.env.HOME}/checkapp/archive`;
    try {
      await indexArchive(dir);
      process.exit(0);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  }

  // --estimate-cost: print pre-flight cost estimate for the configured skills.
  // Requires a source file/URL so we can count words and scale the estimate.
  if (estimateOnly) {
    if (!docUrl) {
      console.error("Usage: checkapp <source> --estimate-cost");
      process.exit(1);
    }
    if (!configExists()) {
      console.error("--estimate-cost requires a CheckApp config (run --setup first)");
      process.exit(1);
    }
    const config = readConfig();
    const { fetchGoogleDoc } = await import("./gdoc.ts");
    const text = await fetchGoogleDoc(docUrl);
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const { estimateRunCost } = await import("./cost/estimator.ts");
    const est = estimateRunCost(config, wordCount);
    console.log(`Estimated cost: $${est.total.toFixed(4)}  (${wordCount} words)`);
    console.log("Per-skill breakdown:");
    for (const [k, v] of Object.entries(est.perSkill)) {
      console.log(`  ${k.padEnd(20)}  $${v.toFixed(4)}`);
    }
    for (const w of est.warnings) {
      console.log(`\u26a0 ${w}`);
    }
    process.exit(0);
  }

  // --deep-fact-check: resolve the Exa API key from env or config, then activate
  // deep-reasoning mode. Works env-only or with config. Downstream readConfig()
  // calls honor the env-var sidecar so this propagates to checker/runCheck.
  //
  // SECURITY: env vars are unset immediately after the run (process.on("exit")
  // handler below) so they don't leak into any child processes spawned later
  // (e.g. --ui subprocess) or stick around on error/exit paths.
  if (deepFactCheck) {
    const dfc = resolveDeepFactCheckEnv({ configExists, env: process.env });
    if (!dfc.allowed || !dfc.apiKey) {
      console.error("--deep-fact-check requires an Exa API key (set EXA_API_KEY env var or configure via --setup)");
      process.exit(1);
    }
    process.env.CHECKAPP_DEEP_FACT_CHECK = "1";
    process.env.CHECKAPP_DEEP_FACT_CHECK_KEY = dfc.apiKey;
    process.once("exit", cleanupDeepEnv);
  }

  // --fix: run checks then generate AI rewrites for flagged sentences
  if (args.includes("--fix")) {
    const { runCheckHeadless } = await import("./checker.ts");
    const { regenerateArticle } = await import("./regenerate.ts");
    const { fetchGoogleDoc } = await import("./gdoc.ts");

    // Find source (same logic as --ci, skip flag values)
    const flagsWithValues = ["--output", "--batch"];
    const flagValueArgs = new Set<string>();
    for (const flag of flagsWithValues) {
      const idx = args.indexOf(flag);
      if (idx !== -1 && args[idx + 1]) flagValueArgs.add(args[idx + 1]);
    }
    const source = args.find((a) => !a.startsWith("--") && !flagValueArgs.has(a));
    if (!source) { console.error("Usage: checkapp --fix <file>"); process.exit(1); }

    console.log("Running checks...");
    const text = await fetchGoogleDoc(source);
    const result = await runCheckHeadless(source, { text });
    const hasFixableIssues = result.results.some(r => r.findings.some(f => (f.severity === "warn" || f.severity === "error") && f.quote));

    if (!hasFixableIssues) {
      console.log("\nNo fixable issues found — article is clean!");

      // List non-quoted issues that exist but can't be auto-fixed
      const hasNonFixableIssues = result.results.some(r => r.findings.some(f => (f.severity === "warn" || f.severity === "error") && !f.quote));
      if (hasNonFixableIssues) {
        console.log("\nNote: There are issues that cannot be auto-fixed (they lack quoted context):");
        for (const r of result.results) {
          const nonFixable = r.findings.filter(f => (f.severity === "warn" || f.severity === "error") && !f.quote);
          if (nonFixable.length > 0) {
            console.log(`  ${r.name}:`);
            for (const f of nonFixable) {
              console.log(`    - ${f.text}`);
            }
          }
        }
      }
      process.exit(0);
    }

    console.log(`Found issues. Generating rewrites...\n`);
    const regen = await regenerateArticle(text, result.results);

    if (regen.rewrites.length === 0) {
      console.log("No rewrites suggested.");
      process.exit(0);
    }

    console.log(`Suggested rewrites (${regen.rewrites.length}):\n`);
    for (const r of regen.rewrites) {
      console.log(`  - "${r.original}"`);
      console.log(`  + "${r.rewritten}"`);
      console.log(`     Reason: ${r.reason}\n`);
    }
    console.log(`Summary: ${regen.summary}`);
    process.exit(0);
  }

  // --ci / --json: headless check with structured output, no Ink UI
  if (args.includes("--ci") || args.includes("--json")) {
    const { runCheckHeadless } = await import("./checker.ts");
    const flagsWithValues = ["--output", "--batch"];
    const flagValueArgs = new Set<string>();
    for (const flag of flagsWithValues) {
      const idx = args.indexOf(flag);
      if (idx !== -1 && args[idx + 1]) flagValueArgs.add(args[idx + 1]);
    }
    const source = args.find((a) => !a.startsWith("--") && !flagValueArgs.has(a));
    if (!source) {
      console.error("Usage: checkapp --ci <file-or-url>");
      process.exit(1);
    }

    try {
      const result = await runCheckHeadless(source);

      if (args.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        // CI summary
        console.log(`\nCheckApp — ${result.source}`);
        console.log(`Words: ${result.wordCount} | Cost: $${result.totalCostUsd.toFixed(3)}\n`);
        for (const r of result.results) {
          const icon = r.verdict === "pass" ? "PASS" : r.verdict === "warn" ? "WARN" : "FAIL";
          console.log(`  ${icon}  ${r.name}: ${r.score}/100 — ${r.summary}`);
        }
        const overall = Math.round(result.results.reduce((s, r) => s + r.score, 0) / (result.results.length || 1));
        const hasFail = result.results.some(r => r.verdict === "fail");
        console.log(`\nOverall: ${overall}/100 ${hasFail ? "FAILED" : "PASSED"}`);
      }

      const hasFail = result.results.some(r => r.verdict === "fail");
      process.exit(hasFail ? 1 : 0);
    } catch (err) {
      console.error("Check failed:", err instanceof Error ? err.message : err);
      process.exit(2);
    }
  }

  // --mcp: start MCP server for Claude Code / Cursor integration
  if (args.includes("--mcp")) {
    const { startMcpServer } = await import("./mcp-server.ts");
    await startMcpServer();
    // Server runs until stdin closes — don't exit
    await new Promise(() => {});
  }

  // context subcommand: manage tone guides, briefs, policies
  if (args[0] === "context") {
    const { runContextCommand } = await import("./context.ts");
    runContextCommand(args.slice(1));
    process.exit(0);
  }

  // --ui: start the dashboard dev server and open browser
  if (showUi) {
    const { spawn } = await import("child_process");
    const openModule = await import("open");
    const openBrowser = openModule.default;
    const { join } = await import("path");

    const dashDir = join(import.meta.dir, "..", "dashboard");
    const { existsSync } = await import("fs");
    if (!existsSync(dashDir)) {
      console.error("Dashboard not found at " + dashDir);
      console.error("The --ui flag requires the dashboard/ directory. If you installed via binary, run from the source repo instead.");
      process.exit(1);
    }
    console.log("Starting CheckApp dashboard...");
    console.log("Opening http://localhost:3000\n");

    const { CHECKAPP_DEEP_FACT_CHECK, CHECKAPP_DEEP_FACT_CHECK_KEY, ...cleanEnv } = process.env;
    const child = spawn("bun", ["run", "dev"], {
      cwd: dashDir,
      stdio: "inherit",
      env: cleanEnv,
    });

    // Wait a bit for the server to start, then open browser
    setTimeout(() => openBrowser("http://localhost:3000"), 3000);

    // Keep alive until user presses Ctrl+C
    child.on("exit", (code) => process.exit(code ?? 0));
    process.on("SIGINT", () => { child.kill(); process.exit(0); });

    // Block forever
    await new Promise(() => {});
  }

  // --history: show recent checks from SQLite
  if (showHistory) {
    const db = openDb();
    const rows = queryRecent(db, 20);
    db.close();

    if (rows.length === 0) {
      console.log("No checks found. Run checkapp <file> to get started.");
      process.exit(0);
    }

    console.log(`\nLast ${rows.length} checks:\n`);
    for (const row of rows) {
      const overall = row.results.length > 0
        ? Math.round(row.results.reduce((s, r) => s + r.score, 0) / row.results.length)
        : 0;
      const verdict = row.results.some(r => r.verdict === "fail") ? "❌"
        : row.results.some(r => r.verdict === "warn") ? "⚠️ " : "✅";
      console.log(`  ${verdict}  ${row.createdAt}  ${row.source}  (${overall}/100, $${row.totalCostUsd.toFixed(3)})`);
    }
    console.log("");
    process.exit(0);
  }

  // --batch <dir>: check all .md/.txt files in the directory
  if (batchDir) {
    await runBatch(batchDir);
    process.exit(0);
  }

  const hasEnvCredentials = !!(process.env.COPYSCAPE_USER && process.env.COPYSCAPE_KEY);
  const needsSetup = forceSetup || (!configExists() && !hasEnvCredentials);

  if (needsSetup) {
    const existingConfig = configExists() ? readConfig() : undefined;
    await runSetup(existingConfig);
    if (!docUrl) process.exit(0);
  }

  if (!docUrl) {
    console.log("");
    console.log("Usage:");
    console.log("  checkapp <google-doc-url-or-file>");
    console.log("");
    console.log("Examples:");
    console.log('  checkapp "https://docs.google.com/document/d/XXXX/edit"');
    console.log('  checkapp ./my-article.md');
    console.log("");
    console.log("Options:");
    console.log("  --fix             Run checks then suggest AI rewrites for flagged sentences");
    console.log("  --deep-fact-check Use Exa deep-reasoning for fact-checks (slower, deeper)");
    console.log("  --estimate-cost   Print estimated cost for the configured skills (B7)");
    console.log("  --mcp             Start MCP server (for Claude Code, Cursor, etc.)");
    console.log("  --ui              Open the local web dashboard");
    console.log("  --ci              Headless check — exits 1 if any skill fails");
    console.log("  --json            Headless check — outputs structured JSON");
    console.log("  --batch <dir>     Check all .md/.txt files in a directory");
    console.log("  --output <path>   Export report to .md or .html file");
    console.log("  --setup           Re-run the credential setup wizard");
    console.log("  --history         Show the last 20 checks from history");
    console.log("");
    console.log("Self-plagiarism index:");
    console.log("  index <dir>                 Ingest .md articles into Cloudflare Vectorize");
    console.log("");
    console.log("Context management:");
    console.log("  context add <type> <file>   Add a context document (tone-guide, brief, etc.)");
    console.log("  context list                List all saved contexts");
    console.log("  context show <type>         Show context content");
    console.log("  context remove <type>       Remove a context");
    console.log("");
    process.exit(0);
  }

  await runCheck(docUrl, outputPath);
}

// Only run main if this is the entry point (not imported for testing)
if (import.meta.main) {
  main()
    .catch((err) => {
      console.error("Unexpected error:", err);
      process.exit(1);
    })
    .finally(() => {
      cleanupDeepEnv();
    });
}
