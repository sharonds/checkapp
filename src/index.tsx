#!/usr/bin/env bun
import { configExists, readConfig } from "./config.ts";
import { runSetup } from "./setup.tsx";
import { runCheck } from "./check.tsx";
import { openDb, queryRecent } from "./db.ts";
import { runBatch } from "./batch.ts";

const args = process.argv.slice(2);
const forceSetup = args.includes("--setup");
const showHistory = args.includes("--history");
const showUi = args.includes("--ui");
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

async function main() {
  // --ci / --json: headless check with structured output, no Ink UI
  if (args.includes("--ci") || args.includes("--json")) {
    const { runCheckHeadless } = await import("./checker.ts");
    const source = args.find((a) => !a.startsWith("--") && a !== args[args.indexOf("--output") + 1]);
    if (!source) {
      console.error("Usage: article-checker --ci <file-or-url>");
      process.exit(1);
    }

    try {
      const result = await runCheckHeadless(source);

      if (args.includes("--json")) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        // CI summary
        console.log(`\nArticle Checker — ${result.source}`);
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
    console.log("Starting Article Checker dashboard...");
    console.log("Opening http://localhost:3000\n");

    const child = spawn("bun", ["run", "dev"], {
      cwd: dashDir,
      stdio: "inherit",
      env: { ...process.env },
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
      console.log("No checks found. Run article-checker <file> to get started.");
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
    console.log("  article-checker <google-doc-url-or-file>");
    console.log("");
    console.log("Examples:");
    console.log('  article-checker "https://docs.google.com/document/d/XXXX/edit"');
    console.log('  article-checker ./my-article.md');
    console.log("");
    console.log("Options:");
    console.log("  --mcp             Start MCP server (for Claude Code, Cursor, etc.)");
    console.log("  --ui              Open the local web dashboard");
    console.log("  --ci              Headless check — exits 1 if any skill fails");
    console.log("  --json            Headless check — outputs structured JSON");
    console.log("  --batch <dir>     Check all .md/.txt files in a directory");
    console.log("  --output <path>   Export report to .md or .html file");
    console.log("  --setup           Re-run the credential setup wizard");
    console.log("  --history         Show the last 20 checks from history");
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

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
