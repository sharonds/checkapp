import { test, expect, describe, mock, beforeEach } from "bun:test";
import { extractClaimsPrompt, claimConfidence, formatCitation, FactCheckSkill } from "./factcheck.ts";
import type { Config } from "../config.ts";
import { mockFetch, urlRouter, jsonResponse } from "../testing/mock-fetch.ts";

// Exa SDK captures global.fetch at import time, so mockFetch (installed per-test)
// doesn't intercept it. Mock the Exa class itself to route through a configurable
// handler that the test can set.
//
// NOTE: mock.module("exa-js", ...) is PROCESS-GLOBAL in Bun — there is no
// documented clean-restore API (as of bun:test today), so this mock persists
// for the life of the test process. If "exa-js" is imported elsewhere in the
// suite, tests must tolerate this mocked implementation. Each test MUST set
// its own exaSearchHandler (reset to null in beforeEach below); the MockExa
// throws loudly if a test forgot to set one, so leakage across tests is
// impossible to miss silently.
let exaSearchHandler: ((q: string, opts: unknown) => Promise<any>) | null = null;
mock.module("exa-js", () => ({
  default: class MockExa {
    constructor(_key: string) {}
    async search(q: string, opts: unknown) {
      if (!exaSearchHandler) throw new Error("No exaSearchHandler set — each test must set one");
      return exaSearchHandler(q, opts);
    }
  },
}));

describe("extractClaimsPrompt", () => {
  test("returns a string containing the article text", () => {
    const prompt = extractClaimsPrompt("Vitamin D prevents cancer.");
    expect(prompt).toContain("Vitamin D prevents cancer");
  });

  test("asks for JSON array output", () => {
    const prompt = extractClaimsPrompt("Some article text.");
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain("claims");
  });
});

describe("claimConfidence", () => {
  test("returns high for 3+ sources when supported", () => {
    expect(claimConfidence(3, true)).toBe("high");
  });
  test("returns medium for 1-2 sources when supported", () => {
    expect(claimConfidence(2, true)).toBe("medium");
    expect(claimConfidence(1, true)).toBe("medium");
  });
  test("returns low when unsupported regardless of sources", () => {
    expect(claimConfidence(5, false)).toBe("low");
  });
  test("returns low when inconclusive", () => {
    expect(claimConfidence(3, null)).toBe("low");
  });
  test("returns low for 0 sources", () => {
    expect(claimConfidence(0, true)).toBe("low");
  });
});

describe("formatCitation", () => {
  test("formats URL as plain text domain", () => {
    const cite = formatCitation("https://www.cdc.gov/diabetes/basics/facts.html");
    expect(cite).toBe("cdc.gov");
  });
  test("strips www prefix", () => {
    expect(formatCitation("https://www.example.com/page")).toBe("example.com");
  });
  test("returns raw URL on parse failure", () => {
    expect(formatCitation("not-a-url")).toBe("not-a-url");
  });
});

describe("FactCheckSkill — Phase 7 evidence", () => {
  // Reset the process-global exa handler between tests so no test silently
  // inherits another test's handler. Each test must explicitly set its own.
  beforeEach(() => {
    exaSearchHandler = null;
  });

  const cfgBase: Config = {
    copyscapeUser: "", copyscapeKey: "",
    exaApiKey: "exa-key",
    minimaxApiKey: "mm-key",
    skills: {
      plagiarism: false, aiDetection: false, seo: false,
      factCheck: true, tone: false, legal: false,
      summary: false, brief: false, purpose: false,
    },
  };

  // MiniMax uses the Anthropic SDK via /anthropic base URL — responses come back
  // as { content: [{ type: "text", text: "..." }] }. Route handler returns that shape.
  const anthropicContent = (text: string) => jsonResponse({
    id: "msg_1", type: "message", role: "assistant", model: "MiniMax-M2.7",
    content: [{ type: "text", text }],
    stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
  });

  test("verified claim finding carries sources[] with url + title + quote", async () => {
    let llmCallCount = 0;
    let capturedOpts: any = null;
    exaSearchHandler = async (_q, opts) => {
      capturedOpts = opts;
      return {
        results: [{
          url: "https://example.com/study",
          title: "Remote work ergonomics study",
          publishedDate: "2023-05-01",
          highlights: ["73% of remote workers experience back pain"],
          text: "A full article describing the study and its findings.",
        }],
      };
    };
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        // First call = extract claims; subsequent = assess
        if (llmCallCount === 1) {
          return anthropicContent("[\"73% of remote workers experience back pain\"]");
        }
        return anthropicContent("{\"supported\":true,\"note\":\"ok\",\"claimType\":\"scientific\"}");
      },
    }));

    const skill = new FactCheckSkill();
    const result = await skill.run("73% of remote workers experience back pain.", cfgBase);

    const withSources = result.findings.find(f => f.sources && f.sources.length > 0);
    expect(withSources).toBeDefined();
    expect(withSources?.sources?.[0].url).toContain("example.com");
    expect(withSources?.sources?.[0].quote).toContain("73%");
    expect(capturedOpts).toMatchObject({
      type: "auto",
      numResults: 3,
      contents: {
        text: { maxCharacters: 4000 },
        highlights: { maxCharacters: 1000, numSentences: 3, query: "73% of remote workers experience back pain" },
      },
    });
    expect(result.provider).toBe("exa-search");
  });

  test("claimType is one of the 4 enum values", async () => {
    let llmCallCount = 0;
    exaSearchHandler = async (_q, opts) => ({
      contents: opts,
      results: [{ url: "https://s.com", title: "T", highlights: ["e"], text: "full text" }],
    });
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        if (llmCallCount === 1) return anthropicContent("[\"a claim\"]");
        return anthropicContent("{\"supported\":true,\"note\":\"n\",\"claimType\":\"medical\"}");
      },
    }));
    const result = await new FactCheckSkill().run("a claim", cfgBase);
    const valid = ["scientific", "medical", "financial", "general"];
    const f = result.findings.find(x => x.claimType);
    expect(f).toBeDefined();
    expect(valid).toContain(f?.claimType);
  });

  test("no provider configured → warn verdict with info finding", async () => {
    const { exaApiKey, ...cfgNoExa } = cfgBase;
    const result = await new FactCheckSkill().run("claim", cfgNoExa as Config);
    expect(result.verdict).toBe("warn");
    expect(result.summary.toLowerCase()).toContain("provider");
  });

  test("skips with 'skipped' verdict when provider is tavily (not implemented)", async () => {
    const skill = new FactCheckSkill();
    const config: Config = {
      ...cfgBase,
      providers: { "fact-check": { provider: "tavily", apiKey: "tv-test" } },
    };
    const res = await skill.run("Some article to check.", config);
    expect(res.verdict).toBe("skipped");
    expect(res.summary).toMatch(/tavily.*not implemented/i);
  });

  test("deep-reasoning mode passes type: 'deep-reasoning' + numResults: 5 to Exa", async () => {
    let capturedOpts: any = null;
    let llmCallCount = 0;
    exaSearchHandler = async (_q, opts) => {
      capturedOpts = opts;
      return {
        results: [{
          url: "https://s.com",
          title: "t",
          publishedDate: "2024-01-01",
          highlights: ["h"],
          text: "full text",
        }],
      };
    };
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        if (llmCallCount === 1) return anthropicContent("[\"a claim\"]");
        return anthropicContent("{\"supported\":true,\"note\":\"n\",\"claimType\":\"scientific\"}");
      },
    }));
    const cfg: Config = {
      ...cfgBase,
      providers: { "fact-check": { provider: "exa-deep-reasoning", apiKey: "k" } },
    };
    const result = await new FactCheckSkill().run("some claim", cfg);
    expect(capturedOpts?.type).toBe("deep-reasoning");
    expect(capturedOpts?.numResults).toBe(5);
    expect(capturedOpts?.contents).toMatchObject({
      text: { maxCharacters: 4000 },
      highlights: { maxCharacters: 1000, numSentences: 3, query: "a claim" },
    });
    // cost per claim should accumulate 0.025 (deep) + 0.001 (base) + 0.001 (assess) per claim
    expect(result.costUsd).toBeGreaterThanOrEqual(0.025);
  });
});
