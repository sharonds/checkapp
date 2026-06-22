import { test, expect, describe, mock, beforeEach } from "bun:test";
import { extractClaimsPrompt, extractClaimsPromptGrounded, claimConfidence, formatCitation, FactCheckSkill, parseExtractedClaims } from "./factcheck.ts";
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
  test("returns high for unsupported claims with 3+ sources", () => {
    expect(claimConfidence(5, false)).toBe("high");
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
    expect(withSources?.quote).toBe("73% of remote workers experience back pain");
    expect(withSources?.location?.paragraphIndex).toBe(0);
    expect(withSources?.auditRef?.claimId).toBe("claim-1");
    expect((result as any).audit.claims[0].quote).toBe("73% of remote workers experience back pain");
    expect((result as any).audit.coverage.claimsChecked).toBe(1);
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

  test("supported assessment without evidence source becomes unverified", async () => {
    let llmCallCount = 0;
    exaSearchHandler = async () => ({ results: [] });
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        if (llmCallCount === 1) return anthropicContent("[\"A source-free claim is verified\"]");
        return anthropicContent("{\"supported\":true,\"note\":\"yes\",\"claimType\":\"general\"}");
      },
    }));

    const result = await new FactCheckSkill().run("A source-free claim is verified.", cfgBase);

    expect(result.findings[0].severity).toBe("warn");
    expect(result.findings[0].text).toContain("No evidence source URL was returned");
    expect(result.findings[0].rewrite).toContain("Add a reliable source");
    expect(result.findings[0].rewrite).toContain("yes");
    expect((result as any).audit.factAssessments[0].rewrite).toContain("Add a reliable source");
    expect((result as any).audit.factAssessments[0].rewrite).toContain("yes");
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

  test("uses factAudit.standardMaxClaims and records claim-cap skips", async () => {
    let llmCallCount = 0;
    let exaCalls = 0;
    exaSearchHandler = async () => {
      exaCalls++;
      return {
        results: [{
          url: `https://example.com/${exaCalls}`,
          title: "Evidence",
          highlights: ["e"],
          text: "full text",
        }],
      };
    };
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        if (llmCallCount === 1) {
          return anthropicContent(JSON.stringify(["Claim one.", "Claim two.", "Claim three."]));
        }
        return anthropicContent("{\"supported\":true,\"note\":\"ok\",\"claimType\":\"general\"}");
      },
    }));

    const result = await new FactCheckSkill().run(
      "Claim one. Claim two. Claim three.",
      { ...cfgBase, factAudit: { standardMaxClaims: 2 } },
    );

    expect(exaCalls).toBe(2);
    expect((result as any).audit.coverage.claimsChecked).toBe(2);
    expect((result as any).audit.coverage.claimsSkipped).toBe(1);
    expect((result as any).audit.coverage.skipReasons.claim_cap).toBe(1);
    expect((result as any).audit.coverage.budgetStopReason).toBe("claim_cap");
  });

  test("filters non-string extracted claims before provider calls", async () => {
    let llmCallCount = 0;
    const exaQueries: unknown[] = [];
    exaSearchHandler = async (q) => {
      exaQueries.push(q);
      return {
        results: [{
          url: `https://example.com/${exaQueries.length}`,
          title: "Evidence",
          highlights: ["e"],
          text: "full text",
        }],
      };
    };
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        if (llmCallCount === 1) {
          return anthropicContent(JSON.stringify(["Claim one.", 123, null, { text: "bad" }, "Claim two."]));
        }
        return anthropicContent("{\"supported\":true,\"note\":\"ok\",\"claimType\":\"general\"}");
      },
    }));

    const result = await new FactCheckSkill().run("Claim one. Claim two.", cfgBase);

    expect(exaQueries).toEqual(["Claim one.", "Claim two."]);
    expect((result as any).audit.coverage.claimsExtracted).toBe(2);
  });

  test("warns instead of passing when a budget skips every extracted claim", async () => {
    let llmCallCount = 0;
    let exaCalls = 0;
    exaSearchHandler = async () => {
      exaCalls++;
      return { results: [] };
    };
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        llmCallCount++;
        if (llmCallCount === 1) return anthropicContent(JSON.stringify(["Claim one.", "Claim two."]));
        return anthropicContent("{\"supported\":true,\"note\":\"ok\",\"claimType\":\"general\"}");
      },
    }));

    const result = await new FactCheckSkill().run(
      "Claim one. Claim two.",
      { ...cfgBase, factAudit: { standardMaxClaims: 2, maxUsd: 0 } },
    );

    expect(exaCalls).toBe(0);
    expect(result.verdict).toBe("warn");
    expect(result.score).toBeLessThan(100);
    expect(result.summary).toContain("0 claims checked");
    expect((result as any).audit.coverage.claimsChecked).toBe(0);
    expect((result as any).audit.coverage.claimsSkipped).toBe(2);
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

  describe("claim extraction failure handling", () => {
    // Adapts the grounded tier's three tests to the basic tier's mock shape.
    // The basic tier uses MiniMax via the Anthropic SDK shape (api.minimax.io).

    test("empty extraction response reports extraction failure, not a claim-free article", async () => {
      // Reasoning models can exhaust max_tokens inside the thinking block and
      // return no text block at all — observed live with MiniMax-M2.7.
      // The LLM client returns "" when there is no text content block.
      mockFetch(urlRouter({
        "api.minimax.io": async () => jsonResponse({
          id: "msg_x", type: "message", role: "assistant", model: "MiniMax-M2.7",
          content: [{ type: "thinking", thinking: "..." }],
          stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 0 },
        }),
      }));
      // exaSearchHandler must not be called — set a sentinel that throws
      exaSearchHandler = async () => { throw new Error("Exa must not be called on extraction failure"); };
      const result = await new FactCheckSkill().run("73% of remote workers experience back pain.", cfgBase);
      expect(result.verdict).toBe("warn");
      expect(result.summary).not.toContain("No specific verifiable claims");
      expect(result.summary).toContain("Claim extraction failed");
      expect(result.findings[0]?.status).toBe("provider_error");
    });

    test("unparseable extraction response reports extraction failure", async () => {
      mockFetch(urlRouter({
        "api.minimax.io": async () => anthropicContent("I could not find any claims in this article."),
      }));
      exaSearchHandler = async () => { throw new Error("Exa must not be called on extraction failure"); };
      const result = await new FactCheckSkill().run("73% of remote workers experience back pain.", cfgBase);
      expect(result.verdict).toBe("warn");
      expect(result.summary).toContain("Claim extraction failed");
      expect(result.findings[0]?.status).toBe("provider_error");
    });

    test("a valid empty claims array still reports a claim-free article", async () => {
      mockFetch(urlRouter({
        "api.minimax.io": async () => anthropicContent("[]"),
      }));
      exaSearchHandler = async () => { throw new Error("Exa must not be called for empty claims"); };
      const result = await new FactCheckSkill().run("Some article with no verifiable claims.", cfgBase);
      expect(result.verdict).toBe("warn");
      expect(result.summary).toContain("No specific verifiable claims detected");
    });

    test("extraction failure on Hebrew text attaches a truthful Hebrew/RTL audit shell", async () => {
      // Thinking-only response: the LLM client returns "" → extraction returns null.
      // The result must carry an `audit` with real language/direction, truthful
      // zero-coverage, and must survive a safeParseAuditRecord round-trip.
      const { safeParseAuditRecord } = await import("../audit/types.ts");
      const { generateReport } = await import("../report.ts");

      mockFetch(urlRouter({
        "api.minimax.io": async () => jsonResponse({
          id: "msg_he_fail", type: "message", role: "assistant", model: "MiniMax-M2.7",
          content: [{ type: "thinking", thinking: "..." }],
          stop_reason: "max_tokens", usage: { input_tokens: 10, output_tokens: 0 },
        }),
      }));
      exaSearchHandler = async () => { throw new Error("Exa must not be called on extraction failure"); };

      const HEBREW_TEXT = "ירושלים היא עיר הבירה של ישראל ומרכז היסטורי ותרבותי.";
      const result = await new FactCheckSkill().run(HEBREW_TEXT, cfgBase);

      // audit field must exist
      const audit = (result as any).audit;
      expect(audit).toBeDefined();

      // language and direction derive from the real document
      expect(audit.language).toBe("he");
      expect(audit.direction).toBe("rtl");

      // coverage must be truthful zeros (no synthetic claims)
      expect(audit.coverage.claimsExtracted).toBe(0);
      expect(audit.coverage.claimsChecked).toBe(0);
      expect(audit.coverage.claimsSkipped).toBe(0);
      expect(audit.claims).toHaveLength(0);
      expect(audit.claimDecisions).toHaveLength(0);
      expect(audit.factAssessments).toHaveLength(0);
      expect(audit.providerAttempts).toHaveLength(0);

      // round-trip through safeParseAuditRecord must succeed
      const parsed = safeParseAuditRecord(JSON.parse(JSON.stringify(audit)));
      expect(parsed.ok).toBe(true);

      // generateReport must produce Hebrew/RTL shell
      const html = generateReport({
        source: "he-test.md",
        wordCount: 10,
        results: [result],
        totalCostUsd: 0.001,
        audit,
      });
      expect(html).toContain('lang="he"');
      expect(html).toContain('dir="rtl"');
      // localized provider_error label — no raw English "(low)" leaking
      expect(html).toContain("שגיאת ספק");
      expect(html).not.toContain("(low)");
    });
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

describe("parseExtractedClaims", () => {
  test("keeps valid {assertion, source} rows and drops malformed ones", () => {
    const raw = JSON.stringify([
      { assertion: "LEGO set 43013 contains 490 pieces", source: "סט 43013 מכיל כ-520 חלקים." },
      { assertion: "no source here" },                 // missing source → drop
      { source: "no assertion" },                       // missing assertion → drop
      "a bare string",                                  // wrong shape → drop
      { assertion: "  ", source: "  " },                // empty → drop
    ]);
    expect(parseExtractedClaims(raw)).toEqual([
      { assertion: "LEGO set 43013 contains 490 pieces", source: "סט 43013 מכיל כ-520 חלקים." },
    ]);
  });

  test("returns null on unparseable input (extraction failed)", () => {
    expect(parseExtractedClaims("")).toBeNull();
    expect(parseExtractedClaims("not json")).toBeNull();
  });

  test("parseExtractedClaims returns [] (not null) when JSON is valid but every row is malformed", () => {
    const raw = JSON.stringify([{ foo: "bar" }, "bare string", { assertion: "  ", source: "  " }]);
    expect(parseExtractedClaims(raw)).toEqual([]);
  });
});

test("extractClaimsPromptGrounded asks for atomic assertion + verbatim source per claim", () => {
  const p = extractClaimsPromptGrounded("מאמר לדוגמה");
  expect(p).toContain("assertion");
  expect(p).toContain("source");
  expect(p).toMatch(/self-contained|standalone/i);     // assertion must stand alone
  expect(p).toMatch(/verbatim|exactly/i);               // source copied verbatim
});
