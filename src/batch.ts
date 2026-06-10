import { readdirSync, existsSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, extname, basename } from "path";
import { readConfig } from "./config.ts";
import { applyThreshold } from "./thresholds.ts";
import { SkillRegistry } from "./skills/registry.ts";
import { buildSkills } from "./checker.ts";
import { openDb, insertCheck, loadAllContexts } from "./db.ts";
import { generateReport } from "./report.ts";
import { formatScore, summarizeResults } from "./output-summary.ts";
import type { OverallSummary } from "./output-summary.ts";
import type { SkillResult } from "./skills/types.ts";

/**
 * Discover all .md and .txt files in a directory (non-recursive).
 */
export function discoverArticles(dir: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const exts = new Set([".md", ".txt"]);
  return readdirSync(dir)
    .filter((f) => exts.has(extname(f).toLowerCase()))
    .map((f) => join(dir, f))
    .sort();
}

export interface BatchResult {
  file: string;
  score: number | null;
  verdict: string;
  costUsd: number;
  reportPath: string;
}

export function summarizeBatchResults(results: SkillResult[]): OverallSummary {
  return summarizeResults(results);
}

export async function runBatch(dir: string): Promise<BatchResult[]> {
  const files = discoverArticles(dir);
  if (files.length === 0) {
    console.log(`No .md or .txt files found in ${dir}`);
    return [];
  }

  const config = readConfig();
  const results: BatchResult[] = [];
  const db = openDb();
  try {
    const contexts = loadAllContexts(db);
    const configWithContexts = { ...config, contexts };

    // Use shared buildSkills() from checker.ts (single source of truth)
    const registry = new SkillRegistry(buildSkills(configWithContexts));

    console.log(`\nChecking ${files.length} articles in ${dir}...\n`);

    for (const file of files) {
      const text = readFileSync(file, "utf-8");
      const wordCount = text.split(/\s+/).filter(Boolean).length;

      console.log(`  Checking ${basename(file)}...`);

      const rawOutput = await registry.runAllWithAudit(text, configWithContexts);
      const skillResults = rawOutput.results.map((r) => ({
        ...r,
        verdict: applyThreshold(r.score, r.verdict, configWithContexts.thresholds?.[r.skillId]),
      }));
      const totalCostUsd = skillResults.reduce((sum, r) => sum + r.costUsd, 0);
      const overall = summarizeBatchResults(skillResults);

      // Save to DB
      insertCheck(db, {
        source: file,
        wordCount,
        results: skillResults,
        totalCostUsd,
        audit: rawOutput.audit,
      });

      // Write individual HTML report
      const reportPath = `checkapp-report-${basename(file, extname(file))}.html`;
      writeFileSync(
        reportPath,
        generateReport({
          source: file,
          wordCount,
          results: skillResults,
          totalCostUsd,
          audit: rawOutput.audit,
          createdAt: new Date().toISOString(),
        })
      );

      results.push({
        file: basename(file),
        score: overall.score,
        verdict: overall.verdict,
        costUsd: totalCostUsd,
        reportPath,
      });
    }
  } finally {
    db.close();
  }

  // Print summary table
  console.log(
    `\n${"─".repeat(48)}`
  );
  console.log(`Batch: ${results.length} articles checked\n`);
  for (const r of results) {
    const icon =
      r.verdict === "pass" ? "✅" : r.verdict === "warn" ? "⚠️" : r.verdict === "skipped" ? "–" : "❌";
    const name = r.file.padEnd(30);
    console.log(
      `  ${name} ${formatScore(r.score)}  ${icon} ${r.verdict.toUpperCase()}`
    );
  }
  const scoredResults = results.filter((r) => r.score !== null);
  const avgScore = scoredResults.length > 0
    ? Math.round(scoredResults.reduce((s, r) => s + (r.score ?? 0), 0) / scoredResults.length)
    : null;
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  console.log(
    `\nAverage: ${formatScore(avgScore)} | API cost: $${totalCost.toFixed(3)}`
  );
  console.log(`${"─".repeat(48)}\n`);

  return results;
}
