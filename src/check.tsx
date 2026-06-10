import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { fetchGoogleDoc, countWords } from "./gdoc.ts";
import { readConfig } from "./config.ts";
import { runCheckCore, loadContextsIntoConfig } from "./checker-core.ts";
import { insertCheck } from "./db.ts";
import { generateReport } from "./report.ts";
import { writeFileSync } from "fs";
import type { SkillResult } from "./skills/types.ts";
import { exportReport } from "./export.ts";
import { formatScore, formatSkillScore, summarizeResults } from "./output-summary.ts";

type Phase =
  | { name: "reading" }
  | { name: "checking"; words: number }
  | { name: "done"; results: SkillResult[]; words: number; reportPath: string; totalCostUsd: number }
  | { name: "error"; message: string };

const DIVIDER = "─".repeat(48);

const VERDICT_COLOR = { pass: "green", warn: "yellow", fail: "red", skipped: "gray" } as const;
const VERDICT_ICON = { pass: "✅", warn: "⚠️ ", fail: "❌", skipped: "–" };

function Report({ results, words, reportPath, totalCostUsd }: {
  results: SkillResult[];
  words: number;
  reportPath: string;
  totalCostUsd: number;
}) {
  const overall = summarizeResults(results);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text dimColor>{DIVIDER}</Text>
      <Box gap={2}><Text bold>Words checked:</Text><Text>{words.toLocaleString()}</Text></Box>
      <Box gap={2}><Text bold>API cost:      </Text><Text dimColor>${totalCostUsd.toFixed(3)}</Text></Box>
      <Box flexDirection="column" marginTop={1}>
        {results.map((r) => (
          <Box key={r.skillId} gap={2}>
            <Text color={VERDICT_COLOR[r.verdict]}>{VERDICT_ICON[r.verdict]}</Text>
            <Text bold>{r.name}:</Text>
            <Text>{r.summary}</Text>
            <Text dimColor>({formatSkillScore(r)})</Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>{DIVIDER}</Text>
      <Text color={VERDICT_COLOR[overall.verdict]} bold>
        Overall: {formatScore(overall.score)}
      </Text>
      <Text dimColor>Report: {reportPath}</Text>
      <Text dimColor>{DIVIDER}</Text>
    </Box>
  );
}

function Check({ docUrl, outputPath }: { docUrl: string; outputPath?: string }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>({ name: "reading" });

  useEffect(() => {
    async function run() {
      try {
        const text = await fetchGoogleDoc(docUrl);
        const words = countWords(text);
        setPhase({ name: "checking", words });

        const sourceLabel = process.env.ARTICLE_CHECKER_SOURCE || docUrl;
        const { config, db } = loadContextsIntoConfig(readConfig());
        let coreResult;
        try {
          coreResult = await runCheckCore(text, config);
          insertCheck(db, {
            source: sourceLabel,
            wordCount: words,
            results: coreResult.results,
            totalCostUsd: coreResult.totalCostUsd,
            audit: coreResult.audit,
          });
        } finally {
          db.close();
        }

        const reportPath = outputPath ?? "checkapp-report.html";
        writeFileSync(reportPath, generateReport({ source: sourceLabel, wordCount: words, results: coreResult.results, totalCostUsd: coreResult.totalCostUsd, audit: coreResult.audit }));

        // Export to custom path if --output was specified (redundant but kept for backwards compat)
        if (outputPath) {
          exportReport({ source: sourceLabel, wordCount: words, results: coreResult.results, totalCostUsd: coreResult.totalCostUsd, audit: coreResult.audit }, outputPath);
          console.log(`\nReport exported to ${outputPath}`);
        }

        // Open in browser (best-effort)
        import("open").then(({ default: open }) => open(reportPath)).catch(() => {});

        setPhase({ name: "done", results: coreResult.results, words, reportPath, totalCostUsd: coreResult.totalCostUsd });
        setTimeout(exit, 300);
      } catch (err) {
        setPhase({ name: "error", message: String(err).replace(/^Error:\s*/, "") });
        setTimeout(exit, 300);
      }
    }
    run();
  }, []);

  if (phase.name === "reading") {
    return (
      <Box gap={1} paddingY={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text>Reading article…</Text>
      </Box>
    );
  }

  if (phase.name === "checking") {
    return (
      <Box gap={1} paddingY={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text>Running {Object.values(readConfig().skills).filter(Boolean).length} checks ({phase.words.toLocaleString()} words)…</Text>
      </Box>
    );
  }

  if (phase.name === "error") {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="red" bold>✗ Error</Text>
        <Text>{phase.message}</Text>
      </Box>
    );
  }

  return (
    <Report
      results={phase.results}
      words={phase.words}
      reportPath={phase.reportPath}
      totalCostUsd={phase.totalCostUsd}
    />
  );
}

export async function runCheck(docUrl: string, outputPath?: string): Promise<void> {
  const { waitUntilExit } = render(<Check docUrl={docUrl} outputPath={outputPath} />);
  await waitUntilExit();
}
