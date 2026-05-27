import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { checkPlagiarismGeminiGrounded } from "./plagiarism-gemini.ts";
import type { Config } from "./config.ts";

const config: Config = {
  copyscapeUser: "",
  copyscapeKey: "",
  geminiApiKey: "gemini-key",
  providers: { plagiarism: { provider: "gemini-grounded-plagiarism" } },
  skills: {
    plagiarism: true, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

describe("checkPlagiarismGeminiGrounded", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("calls Gemini with Google Search, URL context, structured output, and thinking", async () => {
    let requestUrl = "";
    let requestKey = "";
    let requestBody: any;
    globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
      requestUrl = String(url);
      requestKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      requestBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => geminiResponse({
          overallSimilarityPct: 28,
          verdict: "rewrite",
          confidence: "high",
          matches: [{
            sourceUrl: "https://example.com/source",
            sourceTitle: "Source",
            matchedArticleText: "Copied sentence from source.",
            matchedSourceText: "Copied sentence from source.",
            similarityPct: 95,
            matchType: "exact",
            confidence: "high",
            explanation: "Exact copied sentence.",
          }],
        }),
      } as Response;
    };

    const result = await checkPlagiarismGeminiGrounded("Copied sentence from source.", config);

    expect(requestUrl).toContain("/models/gemini-3-pro-preview:generateContent");
    expect(requestKey).toBe("gemini-key");
    expect(requestBody.tools).toEqual([{ google_search: {} }, { url_context: {} }]);
    expect(requestBody.generationConfig.maxOutputTokens).toBe(8192);
    expect(requestBody.generationConfig.thinkingConfig.thinkingLevel).toBe("high");
    expect(requestBody.generationConfig.responseMimeType).toBe("application/json");
    expect(requestBody.generationConfig.responseSchema.required).toContain("matches");
    expect(result.verdict).toBe("rewrite");
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].url).toBe("https://example.com/source");
    expect(result.matches[0].snippet).toContain("[high confidence");
  });

  test("keeps ungrounded Gemini matches as reduced-confidence review findings", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 18,
            verdict: "review",
            confidence: "high",
            matches: [{
              sourceUrl: "https://not-grounded.example/source",
              sourceTitle: "Ungrounded",
              matchedArticleText: "Copied sentence.",
              similarityPct: 80,
              matchType: "exact",
              confidence: "high",
              explanation: "Model claimed a match.",
            }],
          }) }] },
          groundingMetadata: { groundingChunks: [] },
        }],
      }),
    } as Response);

    const result = await checkPlagiarismGeminiGrounded("Copied sentence.", config);

    expect(result.matches).toHaveLength(1);
    expect(result.similarityPct).toBe(100);
    expect(result.verdict).toBe("rewrite");
    expect(result.confidence).toBe("medium");
    expect(result.matches[0].snippet).toContain("without Google grounding metadata");
    expect(result.matches[0].snippet).toContain("[low confidence");
  });

  test("caps ungrounded source-text overlap at medium confidence", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 18,
            verdict: "review",
            confidence: "high",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "Copied sentence from a public source.",
              matchedSourceText: "Copied sentence from a public source.",
              similarityPct: 80,
              matchType: "exact",
              confidence: "high",
              explanation: "Exact copied sentence.",
            }],
          }) }] },
          groundingMetadata: { groundingChunks: [] },
        }],
      }),
    } as Response);

    const result = await checkPlagiarismGeminiGrounded("Copied sentence from a public source.", config);

    expect(result.matches).toHaveLength(1);
    expect(result.similarityPct).toBe(100);
    expect(result.verdict).toBe("rewrite");
    expect(result.confidence).toBe("medium");
    expect(result.matches[0].snippet).toContain("[medium confidence");
  });

  test("does not hardcode 16 percent similarity for short grounded matches", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 16,
            verdict: "review",
            confidence: "high",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "short match",
              matchedSourceText: "short match",
              similarityPct: 95,
              matchType: "exact",
              confidence: "high",
              explanation: "Short exact copied phrase.",
            }],
          }) }] },
          groundingMetadata: {
            groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
          },
        }],
      }),
    } as Response);

    const result = await checkPlagiarismGeminiGrounded(
      "short match plus enough original words to keep computed similarity safely below the sixteen percent review threshold for this test case",
      config
    );

    expect(result.matches).toHaveLength(1);
    expect(result.matchedWords).toBe(2);
    expect(result.similarityPct).toBeLessThan(16);
    expect(result.verdict).toBe("publish");
  });

  test("drops matches with non-http source URLs before report rendering", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 90,
            verdict: "rewrite",
            confidence: "high",
            matches: [{
              sourceUrl: "javascript:alert(1)",
              sourceTitle: "Unsafe",
              matchedArticleText: "Copied sentence.",
              similarityPct: 90,
              matchType: "exact",
              confidence: "high",
              explanation: "Unsafe URL should not be rendered.",
            }],
          }) }] },
          groundingMetadata: { groundingChunks: [] },
        }],
      }),
    } as Response);

    const result = await checkPlagiarismGeminiGrounded("Copied sentence.", config);

    expect(result.matches).toHaveLength(0);
    expect(result.totalMatches).toBe(0);
    expect(result.similarityPct).toBe(0);
    expect(result.verdict).toBe("publish");
  });

  test("returns skipped when Gemini API key is missing", async () => {
    const result = await checkPlagiarismGeminiGrounded("text", { ...config, geminiApiKey: undefined });

    expect(result.verdict).toBe("skipped");
    expect(result.error).toMatch(/Gemini API key/i);
  });

  test("returns skipped for unsafe configured model names", async () => {
    const result = await checkPlagiarismGeminiGrounded("text", {
      ...config,
      providers: {
        plagiarism: {
          provider: "gemini-grounded-plagiarism",
          extra: { model: "gemini-3-pro-preview?key=leak" },
        },
      },
    });

    expect(result.verdict).toBe("skipped");
    expect(result.error).toMatch(/model is invalid/i);
  });

  test("returns skipped for non-2xx Gemini responses", async () => {
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      text: async () => "model not found",
    } as Response);

    const result = await checkPlagiarismGeminiGrounded("Copied sentence.", config);

    expect(result.verdict).toBe("skipped");
    expect(result.error).toContain("HTTP 404");
    expect(result.costUsd).toBe(0);
  });

  test("returns skipped on Gemini network errors", async () => {
    globalThis.fetch = async () => {
      throw new Error("socket closed");
    };

    const result = await checkPlagiarismGeminiGrounded("Copied sentence.", config);

    expect(result.verdict).toBe("skipped");
    expect(result.error).toContain("network error");
    expect(result.error).toContain("socket closed");
    expect(result.costUsd).toBe(0);
  });

  test("returns skipped when Gemini JSON body cannot be parsed", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);

    const result = await checkPlagiarismGeminiGrounded("Copied sentence.", config);

    expect(result.verdict).toBe("skipped");
    expect(result.error).toMatch(/could not parse API response body/i);
    expect(result.costUsd).toBe(0);
  });
});

function geminiResponse(payload: unknown) {
  return {
    candidates: [{
      content: { parts: [{ text: JSON.stringify(payload) }] },
      groundingMetadata: {
        webSearchQueries: ["Copied sentence from source"],
        groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
      },
    }],
  };
}
