import type { Config } from "./config.ts";
import type { CopyscapeMatch, CopyscapeResult } from "./copyscape.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_MODEL = "gemini-3.1-pro-preview";
const ESTIMATED_COST_USD = 0.04;

type Confidence = "high" | "medium" | "low";
type MatchType = "exact" | "near_exact" | "paraphrase" | "uncertain";

interface GeminiPlagiarismMatch {
  sourceUrl: string;
  sourceTitle: string;
  matchedArticleText: string;
  matchedSourceText?: string;
  similarityPct: number;
  matchType: MatchType;
  confidence: Confidence;
  explanation: string;
}

interface GeminiPlagiarismJson {
  overallSimilarityPct: number;
  verdict: "publish" | "review" | "rewrite";
  confidence: Confidence;
  matches: GeminiPlagiarismMatch[];
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  groundingMetadata?: {
    webSearchQueries?: string[];
    groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>;
    groundingSupports?: unknown[];
  };
  urlContextMetadata?: unknown;
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
}

export interface GeminiGroundedPlagiarismResult extends CopyscapeResult {
  confidence: Confidence;
  searchQueries: string[];
  groundedSourceUrls: string[];
  costUsd: number;
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    overallSimilarityPct: {
      type: "number",
      minimum: 0,
      maximum: 100,
      description: "Estimated percentage of the article that likely matches public web sources.",
    },
    verdict: {
      type: "string",
      enum: ["publish", "review", "rewrite"],
      description: "publish for no meaningful matches, review for moderate matches, rewrite for high-risk copying.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Overall evidence confidence based on grounded sources.",
    },
    matches: {
      type: "array",
      maxItems: 10,
      items: {
        type: "object",
              properties: {
          sourceUrl: { type: "string", description: "Public source URL for the suspected match." },
          sourceTitle: { type: "string", description: "Title of the public source." },
          matchedArticleText: { type: "string", description: "Exact article passage suspected of matching." },
          matchedSourceText: { type: "string", description: "Matching source passage when available." },
          similarityPct: { type: "number", minimum: 0, maximum: 100 },
          matchType: { type: "string", enum: ["exact", "near_exact", "paraphrase", "uncertain"] },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          explanation: { type: "string" },
        },
        required: [
          "sourceUrl",
          "sourceTitle",
          "matchedArticleText",
          "similarityPct",
          "matchType",
          "confidence",
          "explanation",
        ],
      },
    },
  },
  required: ["overallSimilarityPct", "verdict", "confidence", "matches"],
} as const;

const PROMPT = `You are a plagiarism evidence checker for editorial review.

Analyze the article against public web sources using Google Search grounding and URL context.

Rules:
- Report only matches supported by public source URLs.
- Prioritize exact and near-exact copied passages over general topical similarity.
- For Hebrew and other non-English content, search in the original language and transliterated/entity terms when useful.
- Do not claim high confidence unless you can ground the match to a source URL.
- If no grounded evidence is found, return publish, 0 similarity, low or medium confidence, and an empty matches array.
- Return only JSON matching the schema.`;

export function geminiGroundedPlagiarismCostUsd(): number {
  return ESTIMATED_COST_USD;
}

export async function checkPlagiarismGeminiGrounded(
  text: string,
  config: Config
): Promise<GeminiGroundedPlagiarismResult> {
  const providerConfig = config.providers?.plagiarism;
  const apiKey = providerConfig?.provider === "gemini-grounded-plagiarism"
    ? providerConfig.apiKey ?? config.geminiApiKey
    : config.geminiApiKey;
  if (!apiKey) {
    return skipped("Gemini API key not configured — set GEMINI_API_KEY, config.geminiApiKey, or providers.plagiarism.apiKey.");
  }

  const model = providerConfig?.extra?.model || DEFAULT_MODEL;
  const url = `${GEMINI_BASE}/models/${model}:generateContent`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: `${PROMPT}\n\nArticle:\n${text}` }] }],
        tools: [{ google_search: {} }, { url_context: {} }],
        generationConfig: {
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: "high" },
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });
  } catch (err) {
    return skipped(`Gemini grounded plagiarism network error: ${(err as Error).message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const detail = body ? ` — ${body.slice(0, 300)}` : "";
    return skipped(`Gemini grounded plagiarism error: HTTP ${response.status}${detail}`);
  }

  let data: GeminiGenerateResponse;
  try {
    data = await response.json() as GeminiGenerateResponse;
  } catch {
    return skipped("Gemini grounded plagiarism: could not parse API response body");
  }

  const candidate = data.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text ?? "";
  const groundedSourceUrls = extractGroundedUrls(candidate);
  const searchQueries = candidate?.groundingMetadata?.webSearchQueries ?? [];

  let parsed: GeminiPlagiarismJson;
  try {
    parsed = JSON.parse(stripJsonFence(rawText)) as GeminiPlagiarismJson;
  } catch {
    return skipped(`Gemini grounded plagiarism: could not parse response — ${rawText.slice(0, 120)}`);
  }

  const matches = normalizeMatches(parsed.matches ?? [], groundedSourceUrls);
  const similarityPct = clampPct(Number(parsed.overallSimilarityPct) || maxSimilarity(matches));
  const verdict = normalizeVerdict(parsed.verdict, similarityPct);

  return {
    totalMatches: matches.length,
    totalWords: 0,
    matchedWords: estimateMatchedWords(text, similarityPct),
    similarityPct,
    matches,
    verdict,
    confidence: normalizeConfidence(parsed.confidence),
    searchQueries,
    groundedSourceUrls,
    costUsd: ESTIMATED_COST_USD,
  };
}

function normalizeMatches(matches: GeminiPlagiarismMatch[], groundedUrls: string[]): CopyscapeMatch[] {
  return matches
    .filter((m) => m && typeof m.sourceUrl === "string" && typeof m.matchedArticleText === "string")
    .filter((m) => isHttpUrl(m.sourceUrl))
    .map((m) => {
      const grounded = groundedUrls.some((url) => sameUrl(url, m.sourceUrl));
      const confidence = grounded
        ? normalizeConfidence(m.confidence)
        : hasTextOverlap(m.matchedArticleText, m.matchedSourceText, m.similarityPct)
          ? capConfidence(normalizeConfidence(m.confidence), "medium")
          : "low";
      const matchType = normalizeMatchType(m.matchType);
      return {
        url: m.sourceUrl,
        title: m.sourceTitle || m.sourceUrl,
        wordsMatched: countWords(m.matchedArticleText),
        snippet: [
          `[${confidence} confidence · ${matchType.replace("_", "-")}] ${m.explanation || "Grounded source match."}`,
          m.matchedSourceText ? `Source: ${m.matchedSourceText}` : "",
          `Article: ${m.matchedArticleText}`,
        ].filter(Boolean).join("\n"),
      };
    });
}

function extractGroundedUrls(candidate: GeminiCandidate | undefined): string[] {
  const urls = new Set<string>();
  for (const chunk of candidate?.groundingMetadata?.groundingChunks ?? []) {
    if (chunk.web?.uri) urls.add(chunk.web.uri);
  }
  collectUrls(candidate?.urlContextMetadata, urls);
  return [...urls];
}

function collectUrls(value: unknown, urls: Set<string>): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
    return;
  }
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (typeof nested === "string" && /url/i.test(key) && /^https?:\/\//i.test(nested)) {
      urls.add(nested);
    } else {
      collectUrls(nested, urls);
    }
  }
}

function skipped(error: string): GeminiGroundedPlagiarismResult {
  return {
    totalMatches: 0,
    totalWords: 0,
    matchedWords: 0,
    similarityPct: 0,
    matches: [],
    verdict: "skipped",
    error,
    confidence: "low",
    searchQueries: [],
    groundedSourceUrls: [],
    costUsd: 0,
  };
}

function normalizeVerdict(verdict: unknown, similarityPct: number): GeminiGroundedPlagiarismResult["verdict"] {
  if (verdict === "publish" || verdict === "review" || verdict === "rewrite") return verdict;
  if (similarityPct >= 26) return "rewrite";
  if (similarityPct >= 16) return "review";
  return "publish";
}

function normalizeConfidence(confidence: unknown): Confidence {
  return confidence === "high" || confidence === "medium" || confidence === "low" ? confidence : "low";
}

function normalizeMatchType(matchType: unknown): MatchType {
  return matchType === "exact" || matchType === "near_exact" || matchType === "paraphrase" || matchType === "uncertain"
    ? matchType
    : "uncertain";
}

function capConfidence(confidence: Confidence, maximum: Confidence): Confidence {
  const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
  if (rank[confidence] <= rank[maximum]) return confidence;
  return maximum;
}

function hasTextOverlap(articleText: string, sourceText: string | undefined, similarityPct: number): boolean {
  if (!sourceText) return false;
  const article = normalizeText(articleText);
  const source = normalizeText(sourceText);
  if (!article || !source) return false;
  if (similarityPct >= 70 && tokenOverlapRatio(article, source) >= 0.5) return true;
  return article.includes(source.slice(0, Math.min(source.length, 80))) ||
    source.includes(article.slice(0, Math.min(article.length, 80)));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenOverlapRatio(a: string, b: string): number {
  const left = new Set(a.split(/\s+/).filter((token) => token.length > 2));
  const right = new Set(b.split(/\s+/).filter((token) => token.length > 2));
  if (left.size === 0 || right.size === 0) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap++;
  }
  return overlap / Math.min(left.size, right.size);
}

function sameUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    return left.hostname.replace(/^www\./, "") === right.hostname.replace(/^www\./, "") &&
      left.pathname.replace(/\/$/, "") === right.pathname.replace(/\/$/, "");
  } catch {
    return a === b;
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function stripJsonFence(value: string): string {
  return value.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
}

function clampPct(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

function maxSimilarity(matches: CopyscapeMatch[]): number {
  return matches.reduce((max, match) => Math.max(max, match.wordsMatched > 0 ? 16 : 0), 0);
}

function estimateMatchedWords(text: string, similarityPct: number): number {
  return Math.round(countWords(text) * (similarityPct / 100));
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
