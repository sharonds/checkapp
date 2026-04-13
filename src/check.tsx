import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { fetchGoogleDoc, countWords } from "./gdoc.ts";
import { checkCopyscape, type CopyscapeResult } from "./copyscape.ts";
import { readConfig } from "./config.ts";

type Phase =
  | { name: "reading" }
  | { name: "checking"; words: number }
  | { name: "done"; result: CopyscapeResult; words: number }
  | { name: "error"; message: string };

const DIVIDER = "─".repeat(48);

function verdictLabel(result: CopyscapeResult): { label: string; color: string } {
  if (result.verdict === "rewrite")
    return { label: "❌  REWRITE — similarity too high", color: "red" };
  if (result.verdict === "review")
    return { label: "⚠️   REVIEW — check flagged passages", color: "yellow" };
  return { label: "✅  PUBLISH — no issues found", color: "green" };
}

function similarityColor(pct: number): string {
  if (pct >= 26) return "red";
  if (pct >= 16) return "yellow";
  return "green";
}

function truncateUrl(url: string, max = 52): string {
  try {
    const { hostname, pathname } = new URL(url);
    const short = hostname + pathname;
    return short.length > max ? short.slice(0, max - 1) + "…" : short;
  } catch {
    return url.length > max ? url.slice(0, max - 1) + "…" : url;
  }
}

function Report({ result, words }: { result: CopyscapeResult; words: number }) {
  const { label, color } = verdictLabel(result);

  return (
    <Box flexDirection="column" paddingY={1}>
      <Text dimColor>{DIVIDER}</Text>

      <Box gap={2}>
        <Text bold>Words checked:</Text>
        <Text>{words.toLocaleString()}</Text>
      </Box>

      <Box gap={2}>
        <Text bold>Similarity:    </Text>
        <Text color={similarityColor(result.similarityPct)} bold>
          {result.similarityPct}%
        </Text>
        <Text dimColor>({result.matchedWords} / {result.totalWords} words matched)</Text>
      </Box>

      {result.totalMatches > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>Top matches ({result.totalMatches} source{result.totalMatches !== 1 ? "s" : ""}):</Text>
          {result.matches.slice(0, 5).map((m, i) => (
            <Box key={i} gap={2} paddingLeft={2}>
              <Text dimColor>{String(i + 1)}.</Text>
              <Text>{truncateUrl(m.url)}</Text>
              <Text color={similarityColor(Math.round((m.wordsMatched / result.totalWords) * 100))}>
                {m.wordsMatched} words
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {result.error && (
        <Text color="yellow">⚠  {result.error}</Text>
      )}

      <Text dimColor>{DIVIDER}</Text>

      <Text color={color as any} bold>
        {label}
      </Text>

      <Text dimColor>{DIVIDER}</Text>
    </Box>
  );
}

function Check({ docUrl }: { docUrl: string }) {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>({ name: "reading" });

  useEffect(() => {
    async function run() {
      try {
        const text = await fetchGoogleDoc(docUrl);
        const words = countWords(text);
        setPhase({ name: "checking", words });

        const config = readConfig();
        const result = await checkCopyscape(text, config);
        setPhase({ name: "done", result, words });
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
        <Text>Reading Google Doc…</Text>
      </Box>
    );
  }

  if (phase.name === "checking") {
    return (
      <Box gap={1} paddingY={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text>Running plagiarism check ({phase.words.toLocaleString()} words)…</Text>
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

  return <Report result={phase.result} words={phase.words} />;
}

export async function runCheck(docUrl: string): Promise<void> {
  const { waitUntilExit } = render(<Check docUrl={docUrl} />);
  await waitUntilExit();
}
