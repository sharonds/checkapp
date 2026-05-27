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
    const calls: string[] = [];
    globalThis.fetch = async (url: string | URL) => {
      calls.push(String(url));
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
    expect(calls.some((u) => u.includes("generativelanguage.googleapis.com"))).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("auto-falls back to Gemini when Copyscape returns English-only error", async () => {
    const calls: string[] = [];
    globalThis.fetch = async (url: string | URL) => {
      const u = String(url);
      calls.push(u);
      if (u.includes("copyscape.com")) {
        return {
          ok: true,
          text: async () => "<error>The AI checker currently only works with English text.</error>",
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.2, segments: [] }) }] } }]
        }),
      } as Response;
    };
    const skill = new AiDetectionSkill();
    const result = await skill.run("Hebrew text כאן.", baseConfig);
    expect(calls.some((u) => u.includes("generativelanguage"))).toBe(true);
    expect(result.findings.some((f) => f.text.toLowerCase().includes("gemini"))).toBe(true);
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
    await skill.run("English text.", baseConfig);
    expect(calls.some((u) => u.includes("copyscape.com"))).toBe(true);
  });
});

test("AiDetectionSkill has correct id and name", () => {
  const skill = new AiDetectionSkill();
  expect(skill.id).toBe("ai-detection");
  expect(skill.name).toBe("AI Detection");
});
