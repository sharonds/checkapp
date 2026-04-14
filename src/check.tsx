import React, { useState, useEffect } from "react";
import { render, Box, Text, useApp } from "ink";
import Spinner from "ink-spinner";
import { fetchGoogleDoc, countWords } from "./gdoc.ts";
import { checkCopyscape, type CopyscapeResult } from "./copyscape.ts";
import { extractPages } from "./parallel.ts";
import { findMatchingPassages } from "./passage.ts";
import { readConfig } from "./config.ts";

export interface MatchedPassage {
  url: string;
  passages: string[];
}

type Phase =
  | { name: "reading" }
  | { name: "checking"; words: number }
  | { name: "enriching"; result: CopyscapeResult; words: number }
  | {
      name: "done";
      result: CopyscapeResult;
      words: number;
      matchedPassages: MatchedPassage[];
      /** Set when Parallel enrichment was attempted but failed */
      enrichmentError?: string;
      /** True when a Parallel key is configured (controls upsell hint) */
      hasParallelKey: boolean;
    }
  | { name: "error"; message: string };

const DIVIDER = "─".repeat(48);

function verdictLabel(result: CopyscapeResult): {
  label: string;
  color: string;
} {
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

function truncatePassage(text: string, max = 80): string {
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

/**
 * Normalise a URL for comparison by stripping scheme differences and trailing
 * slashes. Copyscape and Parallel may return the same page as http vs https
 * or with/without a trailing slash.
 */
function normaliseUrl(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname + pathname.replace(/\/$/, "");
  } catch {
    return url;
  }
}

function Report({
  result,
  words,
  matchedPassages,
  enrichmentError,
  hasParallelKey,
}: {
  result: CopyscapeResult;
  words: number;
  matchedPassages: MatchedPassage[];
  enrichmentError?: string;
  hasParallelKey: boolean;
}) {
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
        <Text dimColor>
          ({result.matchedWords} / {result.totalWords} words matched)
        </Text>
      </Box>

      {result.totalMatches > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>
            Top matches ({result.totalMatches} source
            {result.totalMatches !== 1 ? "s" : ""}):
          </Text>
          {result.matches.slice(0, 5).map((m, i) => {
            // Use normalised URLs to match despite http/https or trailing slash differences
            const enrichment = matchedPassages.find(
              (mp) => normaliseUrl(mp.url) === normaliseUrl(m.url)
            );
            const matchPct = Math.round(
              (m.wordsMatched / result.totalWords) * 100
            );
            return (
              <Box key={i} flexDirection="column" paddingLeft={2} marginTop={0}>
                <Box gap={2}>
                  <Text dimColor>{String(i + 1)}.</Text>
                  <Text>{truncateUrl(m.url)}</Text>
                  <Text color={similarityColor(matchPct)}>
                    {m.wordsMatched} words
                  </Text>
                </Box>
                {enrichment &&
                  enrichment.passages.slice(0, 3).map((p, j) => (
                    <Box key={j} paddingLeft={4}>
                      <Text dimColor>↳ </Text>
                      <Text color="yellow" italic>
                        "{truncatePassage(p)}"
                      </Text>
                    </Box>
                  ))}
              </Box>
            );
          })}
        </Box>
      )}

      {result.error && <Text color="yellow">⚠  {result.error}</Text>}

      {/* Show enrichment failure as a dim warning — not a fatal error */}
      {enrichmentError && (
        <Text dimColor>⚠  {enrichmentError}</Text>
      )}

      {/* Upsell: only when there are matches and no parallel key configured */}
      {result.totalMatches > 0 && !hasParallelKey && (
        <Text dimColor>
          Tip: run `article-checker --setup` to add a Parallel AI key for passage evidence
        </Text>
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

        let matchedPassages: MatchedPassage[] = [];
        let enrichmentError: string | undefined;

        if (config.parallelApiKey && result.matches.length > 0) {
          setPhase({ name: "enriching", result, words });
          try {
            const urlsToEnrich = result.matches.slice(0, 3).map((m) => m.url);
            const pages = await extractPages(urlsToEnrich, config.parallelApiKey);

            matchedPassages = pages
              .filter((page) => !page.error)
              .map((page) => ({
                url: page.url,
                passages: findMatchingPassages(text, page.content),
              }))
              .filter((mp) => mp.passages.length > 0);

            // Surface paywalled/unavailable pages as a soft warning
            const failedCount = pages.filter((p) => p.error).length;
            if (failedCount > 0 && matchedPassages.length === 0) {
              enrichmentError = `${failedCount} source${failedCount !== 1 ? "s" : ""} could not be fetched (may be paywalled)`;
            }
          } catch {
            enrichmentError = "Passage enrichment unavailable — check your Parallel API key";
          }
        }

        setPhase({
          name: "done",
          result,
          words,
          matchedPassages,
          enrichmentError,
          hasParallelKey: !!config.parallelApiKey,
        });
        setTimeout(exit, 300);
      } catch (err) {
        setPhase({
          name: "error",
          message: String(err).replace(/^Error:\s*/, ""),
        });
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

  if (phase.name === "enriching") {
    return (
      <Box gap={1} paddingY={1}>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text>
          Enriching {Math.min(phase.result.matches.length, 3)} source
          {Math.min(phase.result.matches.length, 3) !== 1 ? "s" : ""} with passage evidence…
        </Text>
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
      result={phase.result}
      words={phase.words}
      matchedPassages={phase.matchedPassages}
      enrichmentError={phase.enrichmentError}
      hasParallelKey={phase.hasParallelKey}
    />
  );
}

export async function runCheck(docUrl: string): Promise<void> {
  const { waitUntilExit } = render(<Check docUrl={docUrl} />);
  await waitUntilExit();
}
