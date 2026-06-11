import { checkAiDetectorGemini } from "./aidetector.ts";
import { resetGeminiCapabilityHealthCache } from "./providers/gemini-capability.ts";
import type { Config } from "./config.ts";
import { test, expect, describe, beforeEach, afterEach } from "bun:test";

const geminiConfig: Config = {
  copyscapeUser: "",
  copyscapeKey: "",
  geminiApiKey: "test-key",
  skills: {
    plagiarism: false, aiDetection: true, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

describe("checkAiDetectorGemini", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("calls the capability-resolved Gemini pro model", async () => {
    resetGeminiCapabilityHealthCache();
    const calls: string[] = [];
    let requestBody: { generationConfig?: { maxOutputTokens?: number; responseMimeType?: string } } | undefined;
    globalThis.fetch = async (url: string | URL, init?: RequestInit) => {
      calls.push(String(url));
      requestBody = JSON.parse(String(init?.body));
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.15, segments: [] }) }] } }]
        }),
      } as Response;
    };
    await checkAiDetectorGemini("Some article text.", geminiConfig);
    expect(calls[0]).toContain("/models/gemini-3.1-pro-preview:generateContent");
    expect(requestBody?.generationConfig?.maxOutputTokens).toBe(2048);
    expect(requestBody?.generationConfig?.responseMimeType).toBe("application/json");
  });

  test("honors the GEMINI_MODEL_PRO env override (resolver-routed, not hardcoded)", async () => {
    const saved = process.env.GEMINI_MODEL_PRO;
    process.env.GEMINI_MODEL_PRO = "gemini-test-override";
    resetGeminiCapabilityHealthCache();
    const calls: string[] = [];
    globalThis.fetch = async (url: string | URL, _init?: RequestInit) => {
      calls.push(String(url));
      return {
        ok: true,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.15, segments: [] }) }] } }]
        }),
      } as Response;
    };
    try {
      await checkAiDetectorGemini("Some article text.", geminiConfig);
      expect(calls[0]).toContain("/models/gemini-test-override:generateContent");
    } finally {
      if (saved === undefined) delete process.env.GEMINI_MODEL_PRO;
      else process.env.GEMINI_MODEL_PRO = saved;
      resetGeminiCapabilityHealthCache();
    }
  });

  test("maps 0.82 aiScore to 'ai' verdict", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.82, segments: [{ text: "This sentence.", aiScore: 0.9 }] }) }] } }]
      }),
    } as Response);
    const result = await checkAiDetectorGemini("Some article text.", geminiConfig);
    expect(result.verdict).toBe("ai");
    expect(result.aiPct).toBe(82);
    expect(result.topSegments).toHaveLength(1);
    expect(result.topSegments[0].aiScore).toBe(0.9);
  });

  test("maps 0.15 aiScore to 'human' verdict", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 0.15, segments: [] }) }] } }]
      }),
    } as Response);
    const result = await checkAiDetectorGemini("Human-written text.", geminiConfig);
    expect(result.verdict).toBe("human");
    expect(result.aiPct).toBe(15);
    expect(result.topSegments).toHaveLength(0);
  });

  test("clamps out-of-range aiScore to [0,1]", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ aiScore: 1.5, segments: [] }) }] } }]
      }),
    } as Response);
    const result = await checkAiDetectorGemini("text", geminiConfig);
    expect(result.aiScore).toBeLessThanOrEqual(1);
    expect(result.aiScore).toBeGreaterThanOrEqual(0);
  });

  test("returns error result when Gemini API key is missing", async () => {
    const configNoKey = { ...geminiConfig, geminiApiKey: undefined };
    const result = await checkAiDetectorGemini("text", configNoKey);
    expect(result.error).toMatch(/Gemini API key/i);
    expect(result.aiPct).toBe(0);
    expect(result.verdict).toBe("human");
  });

  test("returns error result when Gemini response is not valid JSON", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "I cannot analyze this." }] } }]
      }),
    } as Response);
    const result = await checkAiDetectorGemini("text", geminiConfig);
    expect(result.error).toMatch(/parse/i);
    expect(result.verdict).toBe("human");
  });

  test("returns error result on HTTP failure", async () => {
    globalThis.fetch = async () => ({ ok: false, status: 429 } as Response);
    const result = await checkAiDetectorGemini("text", geminiConfig);
    expect(result.error).toMatch(/429/);
    expect(result.verdict).toBe("human");
  });

  test("returns error result on network failure", async () => {
    globalThis.fetch = async () => { throw new Error("ECONNREFUSED"); };
    const result = await checkAiDetectorGemini("text", geminiConfig);
    expect(result.error).toMatch(/network error/i);
    expect(result.aiPct).toBe(0);
    expect(result.verdict).toBe("human");
  });
});

// Import the internal parser via a test-only export pattern —
// we test the XML parsing logic directly without making network calls.
// Since parseAiResponse is not exported, we test the public surface
// (checkAiDetector) via its response shape contract, and test the
// verdict thresholds separately.

describe("AI detector verdict thresholds", () => {
  // Replicate the threshold logic from aidetector.ts
  function verdictFrom(aiPct: number): "human" | "mixed" | "ai" {
    if (aiPct >= 70) return "ai";
    if (aiPct >= 30) return "mixed";
    return "human";
  }

  test("0% → human", () => expect(verdictFrom(0)).toBe("human"));
  test("15% → human", () => expect(verdictFrom(15)).toBe("human"));
  test("29% → human", () => expect(verdictFrom(29)).toBe("human"));
  test("30% → mixed", () => expect(verdictFrom(30)).toBe("mixed"));
  test("50% → mixed", () => expect(verdictFrom(50)).toBe("mixed"));
  test("69% → mixed", () => expect(verdictFrom(69)).toBe("mixed"));
  test("70% → ai", () => expect(verdictFrom(70)).toBe("ai"));
  test("95% → ai", () => expect(verdictFrom(95)).toBe("ai"));
});

describe("AI score percentage rounding", () => {
  function toPct(score: number): number {
    return Math.round(score * 100);
  }

  test("0.982874 → 98%", () => expect(toPct(0.982874)).toBe(98));
  test("0.01 → 1%", () => expect(toPct(0.01)).toBe(1));
  test("0.499 → 50%", () => expect(toPct(0.499)).toBe(50));
  test("0.705 → 71%", () => expect(toPct(0.705)).toBe(71));
});

describe("segment filtering", () => {
  function filterTopSegments(
    segments: Array<{ text: string; aiScore: number }>
  ) {
    return [...segments]
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 3)
      .filter((s) => s.aiScore >= 0.7);
  }

  test("only surfaces segments at or above 0.70", () => {
    const segs = [
      { text: "A", aiScore: 0.9 },
      { text: "B", aiScore: 0.65 },
      { text: "C", aiScore: 0.8 },
    ];
    const result = filterTopSegments(segs);
    expect(result.map((s) => s.text)).toEqual(["A", "C"]);
  });

  test("returns at most 3 segments", () => {
    const segs = Array.from({ length: 5 }, (_, i) => ({
      text: String(i),
      aiScore: 0.9 - i * 0.01,
    }));
    expect(filterTopSegments(segs).length).toBeLessThanOrEqual(3);
  });

  test("returns empty when all segments below threshold", () => {
    const segs = [{ text: "A", aiScore: 0.5 }];
    expect(filterTopSegments(segs)).toHaveLength(0);
  });
});
