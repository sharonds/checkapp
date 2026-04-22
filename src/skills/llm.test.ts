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
    let capturedBody: Record<string, unknown> | null = null;
    mockFetch(async (req) => {
      capturedUrl = req.url;
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
    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent?key=gk",
    );
    expect(capturedBody).toMatchObject({
      contents: [{ parts: [{ text: "prompt text" }] }],
      generationConfig: {
        maxOutputTokens: 8192,
        temperature: 0.1,
        thinkingConfig: { thinkingLevel: "low" },
      },
    });
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
