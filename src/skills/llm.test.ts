import { describe, it, expect } from "bun:test";
import { getLlmClient, parseJsonResponse } from "./llm.ts";
import type { Config } from "../config.ts";
import { jsonResponse, mockFetch } from "../testing/mock-fetch.ts";

const baseConfig: Config = {
  copyscapeUser: "",
  copyscapeKey: "",
  skills: {
    plagiarism: false,
    aiDetection: false,
    seo: false,
    factCheck: false,
    tone: false,
    legal: false,
    summary: false,
    brief: false,
  },
};

describe("getLlmClient", () => {
  it("returns null when no keys configured", () => {
    expect(getLlmClient(baseConfig)).toBeNull();
  });

  it("prefers minimax when key set and no explicit provider", () => {
    const c = getLlmClient({ ...baseConfig, minimaxApiKey: "mk" });
    expect(c!.provider).toBe("minimax");
  });

  it("uses anthropic when only anthropic key set", () => {
    const c = getLlmClient({ ...baseConfig, anthropicApiKey: "ak" });
    expect(c!.provider).toBe("anthropic");
  });

  it("uses openrouter when key set and provider is openrouter", () => {
    const c = getLlmClient({ ...baseConfig, openrouterApiKey: "ok", llmProvider: "openrouter" });
    expect(c!.provider).toBe("openrouter");
    expect(c!.model).toBe("anthropic/claude-3.5-haiku");
  });

  it("uses gemini when key set and provider is gemini", () => {
    const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk", llmProvider: "gemini" });
    expect(c!.provider).toBe("gemini");
    expect(c!.model).toBe("gemini-3.1-pro-preview");
  });

  it("uses the capability layer model selection for gemini", () => {
    const prior = process.env.GEMINI_MODEL_PRO;
    process.env.GEMINI_MODEL_PRO = "gemini-custom-pro";
    try {
      const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk", llmProvider: "gemini" });
      expect(c!.provider).toBe("gemini");
      expect(c!.model).toBe("gemini-custom-pro");
    } finally {
      if (prior === undefined) {
        delete process.env.GEMINI_MODEL_PRO;
      } else {
        process.env.GEMINI_MODEL_PRO = prior;
      }
    }
  });

  it("auto-detects openrouter when only openrouter key set", () => {
    const c = getLlmClient({ ...baseConfig, openrouterApiKey: "ok" });
    expect(c!.provider).toBe("openrouter");
  });

  it("auto-detects gemini before openrouter", () => {
    const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk", openrouterApiKey: "ok" });
    expect(c!.provider).toBe("gemini");
  });

  it("respects explicit provider preference over auto-detect", () => {
    const c = getLlmClient({ ...baseConfig, minimaxApiKey: "mk", anthropicApiKey: "ak", llmProvider: "anthropic" });
    expect(c!.provider).toBe("anthropic");
  });

  it("call function is defined", () => {
    const c = getLlmClient({ ...baseConfig, minimaxApiKey: "mk" });
    expect(typeof c!.call).toBe("function");
  });

  it("falls back to auto-detect when explicit provider key is missing", () => {
    const c = getLlmClient({ ...baseConfig, minimaxApiKey: "mk", llmProvider: "openrouter" });
    // Falls through explicit check (no openrouter key), then auto-detects minimax
    expect(c!.provider).toBe("minimax");
  });

  it("calls Gemini generateContent and filters thought parts", async () => {
    let capturedUrl = "";
    let capturedKeyHeader: string | null = null;
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch(async (req) => {
      capturedUrl = req.url;
      capturedKeyHeader = req.headers.get("x-goog-api-key");
      capturedBody = JSON.parse((req as Request).body ? await req.text() : "{}") as Record<string, unknown>;
      return jsonResponse({
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "internal" },
                { text: "visible" },
                { text: " output" },
              ],
            },
          },
        ],
      });
    });

    const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk" });
    expect(c!.provider).toBe("gemini");

    const result = await c!.call("prompt text", 16);
    expect(result).toBe("visible output");
    // Key goes in the x-goog-api-key header (Gemini docs), never the URL where it can leak into logs.
    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent",
    );
    expect(capturedKeyHeader).toBe("gk");
    expect(capturedBody).toMatchObject({
      contents: [{ parts: [{ text: "prompt text" }] }],
      generationConfig: {
        maxOutputTokens: 32768,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
    // Sampling params are deprecated/ignored on Gemini 3.6+ and degrade Gemini 3.x reasoning.
    expect((capturedBody as any).generationConfig.temperature).toBeUndefined();
  });

  // Gemini's maxOutputTokens caps thinking + answer; Google advises >= 32,768 (latest-model migration checklist).
  it("Gemini maxOutputTokens floors at 32768 when caller passes no budget", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch(async (req) => {
      capturedBody = JSON.parse((req as Request).body ? await req.text() : "{}") as Record<string, unknown>;
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "x" }] } }] });
    });
    const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk" });
    await c!.call("hi");
    expect((capturedBody as any).generationConfig.maxOutputTokens).toBe(32768);
  });

  // Changed 2026-10-20: small caps truncate thinking models; lower thinkingLevel to save tokens instead.
  it("Gemini maxOutputTokens floors small explicit budgets at 32768", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch(async (req) => {
      capturedBody = JSON.parse((req as Request).body ? await req.text() : "{}") as Record<string, unknown>;
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "x" }] } }] });
    });
    const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk" });
    await c!.call("hi", 512);
    expect((capturedBody as any).generationConfig.maxOutputTokens).toBe(32768);
  });

  it("Gemini maxOutputTokens caps at the 65536 model output limit", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch(async (req) => {
      capturedBody = JSON.parse((req as Request).body ? await req.text() : "{}") as Record<string, unknown>;
      return jsonResponse({ candidates: [{ content: { parts: [{ text: "x" }] } }] });
    });
    const c = getLlmClient({ ...baseConfig, geminiApiKey: "gk" });
    await c!.call("hi", 100000);
    expect((capturedBody as any).generationConfig.maxOutputTokens).toBe(65536);
  });
});

describe("parseJsonResponse", () => {
  it("parses clean JSON", () => {
    expect(parseJsonResponse('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown code fences", () => {
    expect(parseJsonResponse('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("strips code fences without language tag", () => {
    expect(parseJsonResponse('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJsonResponse("not json")).toThrow();
  });
});

describe("parseJsonResponse — Hebrew gershayim", () => {
  // Gemini sometimes copies Hebrew abbreviations such as ק"ג or פיפ"א into a JSON string without
  // escaping the quote, which made a whole article fail claim extraction.
  it("repairs an unescaped ASCII quote between two Hebrew letters", () => {
    const raw = '[{"assertion":"FIFA set","source":"ערכת פיפ"א (סט 43020) שוקלת 2 ק"ג."}]';
    expect(parseJsonResponse<Array<{ source: string }>>(raw)[0]!.source).toBe('ערכת פיפ"א (סט 43020) שוקלת 2 ק"ג.');
  });

  it("still throws on JSON that is broken for other reasons", () => {
    expect(() => parseJsonResponse("[{\"a\": }]")).toThrow();
  });
});
