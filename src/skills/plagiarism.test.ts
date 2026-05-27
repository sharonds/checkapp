import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { PlagiarismSkill } from "./plagiarism.ts";
import type { Config } from "../config.ts";

const config: Config = {
  copyscapeUser: "user",
  copyscapeKey: "key",
  skills: {
    plagiarism: true, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

test("PlagiarismSkill has correct id and name", () => {
  const skill = new PlagiarismSkill();
  expect(skill.id).toBe("plagiarism");
  expect(skill.name).toBe("Plagiarism Check");
});

describe("PlagiarismSkill Copyscape results", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("marks insufficient Copyscape credits as skipped, not pass", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>Insufficient credits.</error>",
    } as Response);

    const result = await new PlagiarismSkill().run("Article text", config);

    expect(result.verdict).toBe("skipped");
    expect(result.score).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(result.provider).toBe("copyscape");
    expect(result.summary).toMatch(/credits insufficient/i);
    expect(result.error).toBeUndefined();
  });

  test("records Copyscape as the provider on successful plagiarism checks", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<count>0</count><querywords>250</querywords>",
    } as Response);

    const result = await new PlagiarismSkill().run("Article text", config);

    expect(result.verdict).toBe("pass");
    expect(result.score).toBe(100);
    expect(result.provider).toBe("copyscape");
    expect(result.summary).toBe("0% similarity — 0 sources matched");
  });

  test("routes to explicit Gemini grounded plagiarism provider", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 22,
            verdict: "review",
            confidence: "medium",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "Copied sentence from source.",
              matchedSourceText: "Copied sentence from source.",
              similarityPct: 90,
              matchType: "exact",
              confidence: "high",
              explanation: "Exact copied sentence.",
            }],
          }) }] },
          groundingMetadata: {
            webSearchQueries: ["Copied sentence from source"],
            groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
          },
        }],
      }),
    } as Response);

    const result = await new PlagiarismSkill().run("Copied sentence from source plus enough original surrounding editorial context to keep overlap in moderate review range today.", {
      ...config,
      geminiApiKey: "gemini-key",
      providers: { plagiarism: { provider: "gemini-grounded-plagiarism" } },
    });

    expect(result.provider).toBe("gemini-grounded-plagiarism");
    expect(result.verdict).toBe("warn");
    expect(result.summary).toContain("22% grounded similarity");
    expect(result.findings[0].sources?.[0].url).toBe("https://example.com/source");
    expect(result.findings[0].confidence).toBe("high");
  });

  test("uses explicit Gemini fallback when Copyscape credits are insufficient", async () => {
    let calls = 0;
    globalThis.fetch = async (url: string | URL) => {
      calls++;
      if (String(url).includes("copyscape.com")) {
        return {
          ok: true,
          text: async () => "<error>Insufficient credits.</error>",
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({
              overallSimilarityPct: 0,
              verdict: "publish",
              confidence: "low",
              matches: [],
            }) }] },
            groundingMetadata: { webSearchQueries: [], groundingChunks: [] },
          }],
        }),
      } as Response;
    };

    const result = await new PlagiarismSkill().run("Original article text.", {
      ...config,
      geminiApiKey: "gemini-key",
      providers: { plagiarism: { provider: "copyscape", extra: { fallbackProvider: "gemini-grounded-plagiarism" } } },
    });

    expect(calls).toBe(2);
    expect(result.provider).toBe("gemini-grounded-plagiarism");
    expect(result.verdict).toBe("pass");
    expect(result.summary).toContain("after Copyscape skipped");
    expect(result.summary).toContain("article content was sent to Google Gemini");
  });

  test("mentions Gemini fallback configuration when Copyscape skips without fallback", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>Insufficient credits.</error>",
    } as Response);

    const result = await new PlagiarismSkill().run("Article text", config);

    expect(result.verdict).toBe("skipped");
    expect(result.summary).toContain("fallbackProvider");
    expect(result.summary).toContain("gemini-grounded-plagiarism");
  });

  test("labels ungrounded Gemini evidence as reduced confidence, not grounded", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 80,
            verdict: "rewrite",
            confidence: "high",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "Copied sentence from source.",
              matchedSourceText: "Copied sentence from source.",
              similarityPct: 90,
              matchType: "exact",
              confidence: "high",
              explanation: "Exact copied sentence.",
            }],
          }) }] },
          groundingMetadata: { groundingChunks: [] },
        }],
      }),
    } as Response);

    const result = await new PlagiarismSkill().run("Copied sentence from source.", {
      ...config,
      geminiApiKey: "gemini-key",
      providers: { plagiarism: { provider: "gemini-grounded-plagiarism" } },
    });

    expect(result.verdict).toBe("fail");
    expect(result.summary).toContain("reduced-confidence Gemini similarity");
    expect(result.summary).not.toContain("grounded similarity");
  });
});
