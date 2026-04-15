import type { Config } from "./config.ts";

export interface CopyscapeMatch {
  url: string;
  title: string;
  wordsMatched: number;
  snippet: string;
}

export interface CopyscapeResult {
  totalMatches: number;
  totalWords: number;
  matchedWords: number;
  similarityPct: number;
  matches: CopyscapeMatch[];
  verdict: "publish" | "review" | "rewrite";
  error?: string;
}

const COPYSCAPE_API = "https://www.copyscape.com/api/";

// Thresholds
const THRESHOLD_REVIEW = 16;   // 16%+ → review
const THRESHOLD_REWRITE = 26;  // 26%+ → rewrite

export async function checkCopyscape(
  text: string,
  config: Config
): Promise<CopyscapeResult> {
  const body = new URLSearchParams({
    u: config.copyscapeUser,
    k: config.copyscapeKey,
    o: "csearch",          // content search
    e: "UTF-8",
    c: "10",               // max results
    t: text,
  });

  const response = await fetch(COPYSCAPE_API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new Error(`Copyscape API error: HTTP ${response.status}`);
  }

  const xml = await response.text();
  return parseResponse(xml);
}

function parseResponse(xml: string): CopyscapeResult {
  // Check for API-level errors
  const errorMatch = xml.match(/<error>([\s\S]*?)<\/error>/);
  if (errorMatch) {
    const msg = errorMatch[1].trim();
    // Insufficient credits is a known recoverable error
    if (msg.toLowerCase().includes("insufficient")) {
      return {
        totalMatches: 0,
        totalWords: 0,
        matchedWords: 0,
        similarityPct: 0,
        matches: [],
        verdict: "publish",
        error: `Copyscape credits insufficient. Top up at copyscape.com → My Account.`,
      };
    }
    throw new Error(`Copyscape error: ${msg}`);
  }

  const totalMatches = parseInt(
    xml.match(/<count>(\d+)<\/count>/)?.[1] ?? "0"
  );
  // querywords = total words in the submitted text
  const totalWords = parseInt(
    xml.match(/<querywords>(\d+)<\/querywords>/)?.[1] ?? "0"
  );

  const matches: CopyscapeMatch[] = [];
  const resultBlocks = [...xml.matchAll(/<result>([\s\S]*?)<\/result>/g)];
  for (const block of resultBlocks) {
    const inner = block[1];
    const url = inner.match(/<url>(.*?)<\/url>/)?.[1]?.trim() ?? "";
    const title = inner.match(/<title>(.*?)<\/title>/)?.[1]?.trim() ?? url;
    const wordsMatched = parseInt(
      inner.match(/<wordsmatched>(\d+)<\/wordsmatched>/)?.[1] ?? "0"
    );
    let snippet = inner
      .match(/<htmlsnippet>([\s\S]*?)<\/htmlsnippet>/)?.[1]
      ?.trim() ?? "";
    // Strip HTML tags iteratively until no tags remain (handles partial/nested tags)
    let prev = "";
    while (prev !== snippet) {
      prev = snippet;
      snippet = snippet.replace(/<[^>]*>/g, "");
    }

    matches.push({ url, title, wordsMatched, snippet });
  }

  // allwordsmatched / allpercentmatched: aggregate across all full comparisons (present when c>=3)
  // Falls back to top result's per-result fields if aggregates are unavailable
  const allWordsMatched = parseInt(
    xml.match(/<allwordsmatched>(\d+)<\/allwordsmatched>/)?.[1] ?? "0"
  );
  const allPercentMatched = parseInt(
    xml.match(/<allpercentmatched>(\d+)<\/allpercentmatched>/)?.[1] ?? "0"
  );

  const matchedWords = allWordsMatched > 0 ? allWordsMatched : (matches[0]?.wordsMatched ?? 0);
  const similarityPct =
    allPercentMatched > 0
      ? allPercentMatched
      : totalWords > 0
      ? Math.round((matchedWords / totalWords) * 100)
      : 0;

  const verdict =
    similarityPct >= THRESHOLD_REWRITE
      ? "rewrite"
      : similarityPct >= THRESHOLD_REVIEW
      ? "review"
      : "publish";

  return { totalMatches, totalWords, matchedWords, similarityPct, matches, verdict };
}
