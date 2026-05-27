import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { AiDetectionSkill } from "./aidetection.ts";
import type { Config } from "../config.ts";

const baseConfig: Config = {
  copyscapeUser: "user",
  copyscapeKey: "key",
  geminiApiKey: "gemini-key",
  skills: {
    plagiarism: false, aiDetection: true, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

describe("AiDetectionSkill routing", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("uses Gemini when provider is explicitly set to gemini-ai-detection", async () => {
    const calls: Array<{ url: string; key?: string }> = [];
    globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), key: headers.get("x-goog-api-key") ?? undefined });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.1, segments: [] }) }] } }]
        }),
      } as Response;
    };
    const config: Config = {
      ...baseConfig,
      providers: { "ai-detection": { provider: "gemini-ai-detection" } },
    };
    const skill = new AiDetectionSkill();
    const result = await skill.run("Some article.", config);
    expect(calls.some((c) => new URL(c.url).hostname === "generativelanguage.googleapis.com")).toBe(true);
    expect(result.provider).toBe("gemini-ai-detection");
    expect(result.error).toBeUndefined();
  });

  test("uses provider-scoped key for explicit Gemini AI detection", async () => {
    const calls: Array<{ url: string; key?: string }> = [];
    globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), key: headers.get("x-goog-api-key") ?? undefined });
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.1, segments: [] }) }] } }]
        }),
      } as Response;
    };
    const config: Config = {
      ...baseConfig,
      geminiApiKey: undefined,
      providers: { "ai-detection": { provider: "gemini-ai-detection", apiKey: "provider-key" } },
    };
    const result = await new AiDetectionSkill().run("Some article.", config);
    expect(result.provider).toBe("gemini-ai-detection");
    expect(calls[0]?.key).toBe("provider-key");
  });

  test("Gemini error result records gemini-ai-detection provider and zero cost", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429 } as Response);
    const config: Config = {
      ...baseConfig,
      providers: { "ai-detection": { provider: "gemini-ai-detection" } },
    };
    const result = await new AiDetectionSkill().run("Some article.", config);
    expect(result.provider).toBe("gemini-ai-detection");
    expect(result.verdict).toBe("fail");
    expect(result.costUsd).toBe(0);
  });

  test("returns skipped verdict when Copyscape returns English-only error, even with Gemini key set", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>The AI checker currently only works with English text.</error>",
    } as Response);
    // geminiApiKey is set on baseConfig — auto-fallback must NOT happen without explicit provider config
    const skill = new AiDetectionSkill();
    const result = await skill.run("Hebrew text כאן.", baseConfig);
    expect(result.verdict).toBe("skipped");
    expect(result.score).toBe(0);
    expect(result.summary).toMatch(/gemini-ai-detection/i);
    expect(result.provider).toBe("copyscape");
    expect(result.error).toBeUndefined();
  });

  test("returns skipped verdict when Copyscape fails English-only and no Gemini key", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>The AI checker currently only works with English text.</error>",
    } as Response);
    const config: Config = { ...baseConfig, geminiApiKey: undefined };
    const skill = new AiDetectionSkill();
    const result = await skill.run("Hebrew text.", config);
    expect(result.verdict).toBe("skipped");
    expect(result.score).toBe(0);
    expect(result.provider).toBe("copyscape");
    expect(result.error).toBeUndefined();
  });

  test("uses Copyscape when no provider override and Copyscape succeeds", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (url: string | URL) => {
      calls.push(String(url));
      return {
        ok: true,
        text: async () => "<aiscore>0.1</aiscore>",
      } as Response;
    };
    const skill = new AiDetectionSkill();
    const result = await skill.run("English text.", baseConfig);
    expect(calls.some((u) => new URL(u).hostname === "www.copyscape.com")).toBe(true);
    expect(result.provider).toBe("copyscape");
  });

  test("returns skipped provider result when Copyscape credits are insufficient", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>Insufficient credits.</error>",
    } as Response);
    const result = await new AiDetectionSkill().run("English text.", baseConfig);
    expect(result.verdict).toBe("skipped");
    expect(result.provider).toBe("copyscape");
    expect(result.error).toBeUndefined();
  });

  test("Copyscape API failure records copyscape provider", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500 } as Response);
    const result = await new AiDetectionSkill().run("English text.", baseConfig);
    expect(result.verdict).toBe("fail");
    expect(result.provider).toBe("copyscape");
    expect(result.error).toMatch(/HTTP 500/);
  });
});

test("AiDetectionSkill has correct id and name", () => {
  const skill = new AiDetectionSkill();
  expect(skill.id).toBe("ai-detection");
  expect(skill.name).toBe("AI Detection");
});
