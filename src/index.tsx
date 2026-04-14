#!/usr/bin/env bun
import { configExists, readConfig } from "./config.ts";
import { runSetup } from "./setup.tsx";
import { runCheck } from "./check.tsx";
import { openDb, queryRecent } from "./db.ts";
import { runBatch } from "./batch.ts";

const args = process.argv.slice(2);
const forceSetup = args.includes("--setup");
const showHistory = args.includes("--history");
const batchIndex = args.indexOf("--batch");
const batchDir = batchIndex !== -1 ? args[batchIndex + 1] : undefined;
const docUrl = args.find((a) => !a.startsWith("--") && a !== batchDir);

async function main() {
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
    console.log("  --batch <dir>  Check all .md/.txt files in a directory");
    console.log("  --setup        Re-run the credential setup wizard");
    console.log("  --history      Show the last 20 checks from history");
    console.log("");
    process.exit(0);
  }

  await runCheck(docUrl);
}

main().catch((err) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
