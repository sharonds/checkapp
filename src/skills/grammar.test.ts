import { describe, test, expect } from "bun:test";
import { GrammarSkill } from "./grammar.ts";
import type { Config } from "../config.ts";
import { mockFetch, urlRouter, jsonResponse } from "../testing/mock-fetch.ts";

const cfgBase: Config = {
  copyscapeUser: "", copyscapeKey: "",
  providers: { grammar: { provider: "languagetool" } },
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    grammar: true,
  },
};

// MiniMax uses the Anthropic SDK via /anthropic base URL — responses come back
// as { content: [{ type: "text", text: "..." }] }.
const anthropicContent = (text: string) => jsonResponse({
  id: "msg_1", type: "message", role: "assistant", model: "MiniMax-M2.7",
  content: [{ type: "text", text }],
  stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 },
});

describe("GrammarSkill — unconfigured provider", () => {
  test("returns 'skipped' verdict (not 'warn' or score:0) when provider unconfigured", async () => {
    const skill = new GrammarSkill();
    const res = await skill.run("Hello world.", { skills: { grammar: true } } as Config);
    expect(res.verdict).toBe("skipped");
    expect(res.score).toBe(0);
    // score:0 with verdict "skipped" means the threshold engine must exclude it from averages
  });
});

describe("GrammarSkill — LanguageTool path", () => {
  test("reports a spelling match with a rewrite suggestion", async () => {
    mockFetch(urlRouter({
      "languagetool.org": async () => jsonResponse({
        matches: [{
          message: "Possible spelling mistake found.",
          shortMessage: "Spelling mistake",
          offset: 6, length: 7,
          replacements: [{ value: "spelling" }],
          context: { text: "check speling here", offset: 6, length: 7 },
          rule: { id: "MORFOLOGIK_RULE_EN_US", description: "Spelling" },
          sentence: "check speling here",
        }],
      }),
    }));
    const r = await new GrammarSkill().run("check speling here", cfgBase);
    expect(r.skillId).toBe("grammar");
    expect(r.verdict).not.toBe("pass");
    expect(r.findings.length).toBeGreaterThan(0);
    expect(r.findings[0].rewrite).toContain("spelling");
    expect(r.findings[0].severity).toBe("error");
    expect(r.provider).toBe("languagetool");
  });

  test("returns pass when LanguageTool finds no issues", async () => {
    mockFetch(urlRouter({
      "languagetool.org": async () => jsonResponse({ matches: [] }),
    }));
    const r = await new GrammarSkill().run("perfectly correct text.", cfgBase);
    expect(r.verdict).toBe("pass");
    expect(r.findings.length).toBe(0);
    expect(r.score).toBe(100);
  });

  test("skipped verdict when no provider configured", async () => {
    const cfg: Config = { ...cfgBase, providers: {} };
    const r = await new GrammarSkill().run("x", cfg);
    expect(r.verdict).toBe("skipped");
    expect(r.findings.length).toBe(0);
  });

  test("caps at 50 findings for long texts", async () => {
    const many = Array.from({ length: 80 }, (_, i) => ({
      message: `Match ${i}`, offset: i, length: 1,
      replacements: [{ value: "x" }],
      context: { text: "text", offset: 0, length: 1 },
      rule: { id: "STYLE_RULE", description: "Style" },
      sentence: "Full sentence.",
    }));
    mockFetch(urlRouter({ "languagetool.org": async () => jsonResponse({ matches: many }) }));
    const r = await new GrammarSkill().run("text ".repeat(200), cfgBase);
    expect(r.findings.length).toBe(50);
  });

  test("retries on 429 via fetchWithBackoff (completes, not infinite)", async () => {
    let calls = 0;
    mockFetch(urlRouter({
      "languagetool.org": async () => {
        calls++;
        if (calls < 2) return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
        return jsonResponse({ matches: [] });
      },
    }));
    const r = await new GrammarSkill().run("x", cfgBase);
    expect(r.verdict).toBe("pass");
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("GrammarSkill — LLM fallback path", () => {
  test("uses LLM when provider is llm-fallback and LLM key is set", async () => {
    mockFetch(urlRouter({
      "api.minimax.io": async () =>
        anthropicContent('[{"quote":"i has","rewrite":"I have","rule":"Subject-verb"}]'),
      "languagetool.org": async () => jsonResponse({ matches: [] }),
    }));
    const cfg: Config = {
      ...cfgBase,
      providers: { grammar: { provider: "llm-fallback" } },
      minimaxApiKey: "mm-key",
    };
    const r = await new GrammarSkill().run("i has a apple.", cfg);
    expect(r.skillId).toBe("grammar");
    expect(r.provider).toBe("llm-fallback");
    expect(r.findings.length).toBeGreaterThanOrEqual(0);
  });

  test("llm-fallback without LLM key returns warn + info finding", async () => {
    const cfg: Config = {
      ...cfgBase,
      providers: { grammar: { provider: "llm-fallback" } },
    };
    const r = await new GrammarSkill().run("x", cfg);
    expect(r.verdict).toBe("warn");
    expect(r.findings[0].severity).toBe("info");
    expect(r.costUsd).toBe(0);
  });
});

describe("GrammarSkill — grammar-pass on AI rewrites (R9)", () => {
  test("LLM-fallback rewrites get a second LT pass to fix mechanical errors", async () => {
    let ltCallCount = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () =>
        anthropicContent('[{"quote":"i has an aples","rewrite":"I have aples","rule":"Grammar"}]'),
      "languagetool.org": async () => {
        ltCallCount++;
        return jsonResponse({
          matches: [{
            message: "Possible spelling mistake", offset: 7, length: 5,
            replacements: [{ value: "apples" }],
            context: { text: "I have aples", offset: 7, length: 5 },
            rule: { id: "MORFOLOGIK_RULE_EN_US", description: "Spelling" },
            sentence: "I have aples",
          }],
        });
      },
    }));
    const cfg: Config = {
      ...cfgBase,
      providers: { grammar: { provider: "llm-fallback" } },
      minimaxApiKey: "mm-key",
    };
    const r = await new GrammarSkill().run("i has an aples", cfg);
    expect(ltCallCount).toBeGreaterThan(0);
    const rewrite = r.findings[0]?.rewrite ?? "";
    expect(rewrite).toContain("apples");
    expect(rewrite).not.toContain("aples ");
  });

  test("LT failure during recheck is tolerated — rewrites still emitted as-is", async () => {
    mockFetch(urlRouter({
      "api.minimax.io": async () =>
        anthropicContent('[{"quote":"bad","rewrite":"good","rule":"r"}]'),
      "languagetool.org": async () => new Response("server down", { status: 500 }),
    }));
    const cfg: Config = { ...cfgBase, providers: { grammar: { provider: "llm-fallback" } }, minimaxApiKey: "mm-key" };
    const r = await new GrammarSkill().run("bad", cfg);
    expect(r.findings[0]?.rewrite).toBe("good");
  });
});

describe("GrammarSkill — review fixes", () => {
  test("recheck disabled via boolean false (not just string)", async () => {
    let ltCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () =>
        anthropicContent('[{"quote":"x","rewrite":"y","rule":"r"}]'),
      "languagetool.org": async () => {
        ltCalls++;
        return jsonResponse({ matches: [] });
      },
    }));
    const cfg: Config = {
      ...cfgBase,
      providers: { grammar: { provider: "llm-fallback", extra: { recheck: false as never } } },
      minimaxApiKey: "mm-key",
    };
    await new GrammarSkill().run("x", cfg);
    expect(ltCalls).toBe(0); // no recheck happened
  });

  test("recheck uses custom endpoint from extra.recheckEndpoint", async () => {
    let seenHost = "";
    mockFetch(urlRouter({
      "api.minimax.io": async () =>
        anthropicContent('[{"quote":"x","rewrite":"y","rule":"r"}]'),
      "lt.my-company.internal": async (req) => {
        seenHost = new URL(req.url).host;
        return jsonResponse({ matches: [] });
      },
    }));
    const cfg: Config = {
      ...cfgBase,
      providers: {
        grammar: {
          provider: "llm-fallback",
          extra: { recheckEndpoint: "https://lt.my-company.internal/v2/check" },
        },
      },
      minimaxApiKey: "mm-key",
    };
    await new GrammarSkill().run("x", cfg);
    expect(seenHost).toBe("lt.my-company.internal");
  });

  test("filters malformed LLM items (missing quote/rewrite)", async () => {
    mockFetch(urlRouter({
      "api.minimax.io": async () =>
        anthropicContent('[{"quote":"good","rewrite":"fixed","rule":"r"},{},{"quote":""},{"rewrite":"nope"}]'),
    }));
    const cfg: Config = {
      ...cfgBase,
      providers: { grammar: { provider: "llm-fallback", extra: { recheck: "false" } } },
      minimaxApiKey: "mm-key",
    };
    const r = await new GrammarSkill().run("x", cfg);
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].rewrite).toBe("fixed");
  });
});
