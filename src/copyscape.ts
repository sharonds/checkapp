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
    xml.match(/<totalcount>(\d+)<\/totalcount>/)?.[1] ?? "0"
  );
  const totalWords = parseInt(
    xml.match(/<allwordcount>(\d+)<\/allwordcount>/)?.[1] ?? "0"
  );
  const matchedWords = parseInt(
    xml.match(/<querywordcount>(\d+)<\/querywordcount>/)?.[1] ?? "0"
  );

  const similarityPct =
    totalWords > 0 ? Math.round((matchedWords / totalWords) * 100) : 0;

  const matches: CopyscapeMatch[] = [];
  const resultBlocks = [...xml.matchAll(/<result>([\s\S]*?)<\/result>/g)];
  for (const block of resultBlocks) {
    const inner = block[1];
    const url = inner.match(/<url>(.*?)<\/url>/)?.[1]?.trim() ?? "";
    const title = inner.match(/<title>(.*?)<\/title>/)?.[1]?.trim() ?? url;
    const wordsMatched = parseInt(
      inner.match(/<minwordsmatched>(\d+)<\/minwordsmatched>/)?.[1] ?? "0"
    );
    const snippet = inner
      .match(/<htmlsnippet>([\s\S]*?)<\/htmlsnippet>/)?.[1]
      ?.replace(/<[^>]+>/g, "")   // strip HTML tags
      .trim() ?? "";

    matches.push({ url, title, wordsMatched, snippet });
  }

  const verdict =
    similarityPct >= THRESHOLD_REWRITE
      ? "rewrite"
      : similarityPct >= THRESHOLD_REVIEW
      ? "review"
      : "publish";

  return { totalMatches, totalWords, matchedWords, similarityPct, matches, verdict };
}
