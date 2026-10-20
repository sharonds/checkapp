import { describe, expect, test } from "bun:test";
import type { Config } from "./config.ts";
import { jsonResponse, mockFetch } from "./testing/mock-fetch.ts";
import { FactCheckGroundedSkill } from "./skills/factcheck-grounded.ts";
import { checkPlagiarismGeminiGrounded } from "./plagiarism-gemini.ts";
import { checkAiDetectorGemini } from "./aidetector.ts";
import { createGeminiCapability, resetGeminiCapabilityHealthCache } from "./providers/gemini-capability.ts";

// Rules from the Gemini API docs (https://ai.google.dev/gemini-api/docs/latest-model,
// https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6, https://ai.google.dev/gemini-api/docs/thinking):
// - sampling params (temperature/top_p/top_k) are deprecated/ignored on 3.6+ and degrade 3.x reasoning
// - maxOutputTokens caps thinking + answer; keep >= 32,768 on thinking calls
// - send the key in x-goog-api-key, never in the URL
interface CapturedRequest {
  url: string;
  keyHeader: string | null;
  body: { generationConfig?: Record<string, unknown> } | null;
}

function captureGemini(respond: (body: Record<string, unknown>) => unknown): CapturedRequest[] {
  const seen: CapturedRequest[] = [];
  mockFetch(async (req) => {
    const text = req.method === "GET" ? "" : await req.text();
    const body = text ? JSON.parse(text) : null;
    seen.push({ url: req.url, keyHeader: req.headers.get("x-goog-api-key"), body });
    return jsonResponse(respond(body ?? {}));
  });
  return seen;
}

function expectHygienic(requests: CapturedRequest[], { thinking }: { thinking: boolean }) {
  expect(requests.length).toBeGreaterThan(0);
  for (const r of requests) {
    expect(r.url).not.toContain("key=");
    expect(r.keyHeader).toBe("gemini-key");
    const gc = r.body?.generationConfig;
    if (gc) {
      expect(gc.temperature).toBeUndefined();
      expect(gc.topP).toBeUndefined();
      expect(gc.topK).toBeUndefined();
      if (thinking) expect(gc.maxOutputTokens as number).toBeGreaterThanOrEqual(32_768);
    }
  }
}

const baseConfig: Config = {
  copyscapeUser: "",
  copyscapeKey: "",
  geminiApiKey: "gemini-key",
  skills: {
    plagiarism: false, aiDetection: false, seo: false, factCheck: true,
    tone: false, legal: false, summary: false, brief: false, purpose: false,
  },
  providers: { "fact-check": { provider: "gemini-grounded" } },
};

describe("Gemini request hygiene", () => {
  test("grounded fact-check (extraction + per-claim grounding)", async () => {
    const seen = captureGemini((body) =>
      body.tools
        ? { candidates: [{ content: { parts: [{ text: '{"supported":true,"note":"ok"}' }] } }] }
        : { candidates: [{ content: { parts: [{ text: '[{"assertion":"A is B","source":"A is B."}]' }] } }] },
    );
    await new FactCheckGroundedSkill().run("A is B.", baseConfig);
    expectHygienic(seen, { thinking: true });
  });

  test("Gemini grounded plagiarism", async () => {
    const seen = captureGemini(() => ({
      candidates: [{ content: { parts: [{ text: '{"verdict":"publish","similarity":0,"confidence":"low","matches":[]}' }] } }],
    }));
    await checkPlagiarismGeminiGrounded("Some article text.", {
      ...baseConfig,
      providers: { plagiarism: { provider: "gemini-grounded-plagiarism", apiKey: "gemini-key" } },
    });
    expectHygienic(seen, { thinking: true });
  });

  test("Gemini AI detection", async () => {
    const seen = captureGemini(() => ({
      candidates: [{ content: { parts: [{ text: '{"aiScore":0.1,"segments":[]}' }] } }],
    }));
    await checkAiDetectorGemini("Some article text.", baseConfig);
    expectHygienic(seen, { thinking: true });
  });

  test("capability health probe", async () => {
    const seen = captureGemini(() => ({ id: "int-probe", candidates: [] }));
    try {
      await createGeminiCapability({ apiKey: "gemini-key", cacheTtlMs: 0 }).checkHealth();
    } finally {
      resetGeminiCapabilityHealthCache();
    }
    expectHygienic(seen, { thinking: false });
  });
});
