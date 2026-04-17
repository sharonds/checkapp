import { readdirSync, existsSync, statSync, readFileSync, writeFileSync } from "fs";
import { join, extname, basename } from "path";
import { readConfig } from "./config.ts";
import { applyThreshold } from "./thresholds.ts";
import { SkillRegistry } from "./skills/registry.ts";
import { buildSkills } from "./checker.ts";
import { openDb, insertCheck, loadAllContexts } from "./db.ts";
import { generateReport } from "./report.ts";

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
  score: number;
  verdict: string;
  costUsd: number;
  reportPath: string;
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

      const rawSkillResults = await registry.runAll(text, configWithContexts);
      const skillResults = rawSkillResults.map((r) => ({
        ...r,
        verdict: applyThreshold(r.score, r.verdict, configWithContexts.thresholds?.[r.skillId]),
      }));
      const totalCostUsd = skillResults.reduce((sum, r) => sum + r.costUsd, 0);
      const overallScore =
        skillResults.length > 0
          ? Math.round(
              skillResults.reduce((s, r) => s + r.score, 0) / skillResults.length
            )
          : 0;
      const overallVerdict = skillResults.some((r) => r.verdict === "fail")
        ? "fail"
        : skillResults.some((r) => r.verdict === "warn")
          ? "warn"
          : "pass";

      // Save to DB
      insertCheck(db, {
        source: file,
        wordCount,
        results: skillResults,
        totalCostUsd,
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
          createdAt: new Date().toISOString(),
        })
      );

      results.push({
        file: basename(file),
        score: overallScore,
        verdict: overallVerdict,
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
      r.verdict === "pass" ? "✅" : r.verdict === "warn" ? "⚠️" : "❌";
    const name = r.file.padEnd(30);
    console.log(
      `  ${name} ${r.score}/100  ${icon} ${r.verdict.toUpperCase()}`
    );
  }
  const avgScore = Math.round(
    results.reduce((s, r) => s + r.score, 0) / results.length
  );
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  console.log(
    `\nAverage: ${avgScore}/100 | API cost: $${totalCost.toFixed(3)}`
  );
  console.log(`${"─".repeat(48)}\n`);

  return results;
}
