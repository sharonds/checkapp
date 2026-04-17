import { describe, test, expect } from "bun:test";
import { SelfPlagiarismSkill } from "./selfplagiarism.ts";
import type { Config } from "../config.ts";
import { mockFetch, urlRouter, jsonResponse } from "../testing/mock-fetch.ts";

const cfgBase: Config = {
  copyscapeUser: "", copyscapeKey: "",
  providers: { "self-plagiarism": { provider: "cloudflare-vectorize", apiKey: "cf-key", extra: { accountId: "acct", indexName: "articles" } } },
  openrouterApiKey: "or-key",
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    selfPlagiarism: true,
  },
};

describe("SelfPlagiarismSkill", () => {
  test("flags high-similarity match with rewrite suggestion", async () => {
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => jsonResponse({ data: [{ embedding: Array(768).fill(0.1) }] }),
      "vectorize/v2/indexes/articles/query": async () => jsonResponse({
        result: { matches: [{
          id: "post-1", score: 0.92,
          metadata: { title: "Old post", url: "https://blog.example/old", publishedAt: "2025-09-01T00:00:00Z", snippet: "same idea" },
        }] },
      }),
    }));
    const r = await new SelfPlagiarismSkill().run("new article text", cfgBase);
    expect(r.verdict).toBe("warn"); // 1 hit at 0.92 → warn-severity finding forces warn verdict (was previously pass due to score≥75)
    expect(r.score).toBe(80); // score unchanged — 100 - 20
    expect(r.findings.length).toBe(1);
    expect(r.findings[0].sources?.[0].title).toBe("Old post");
    expect(r.findings[0].sources?.[0].url).toBe("https://blog.example/old");
    expect(r.findings[0].sources?.[0].relevanceScore).toBe(0.92);
    expect(r.findings[0].rewrite).toContain("linking to the original");
    expect(r.findings[0].severity).toBe("warn"); // 0.92 < 0.95 threshold
  });

  test("0.95+ similarity is severity=error", async () => {
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => jsonResponse({ data: [{ embedding: Array(768).fill(0.1) }] }),
      "vectorize/v2/indexes/articles/query": async () => jsonResponse({
        result: { matches: [{ id: "p", score: 0.97, metadata: { title: "T" } }] },
      }),
    }));
    const r = await new SelfPlagiarismSkill().run("text", cfgBase);
    expect(r.findings[0].severity).toBe("error");
  });

  test("3 hits: verdict stays fail, severity override does not upgrade to warn", async () => {
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => jsonResponse({ data: [{ embedding: Array(768).fill(0.1) }] }),
      "vectorize/v2/indexes/articles/query": async () => jsonResponse({
        result: { matches: [
          { id: "p1", score: 0.9, metadata: { title: "a" } },
          { id: "p2", score: 0.88, metadata: { title: "b" } },
          { id: "p3", score: 0.87, metadata: { title: "c" } },
        ] },
      }),
    }));
    const r = await new SelfPlagiarismSkill().run("text", cfgBase);
    expect(r.score).toBe(40);
    expect(r.verdict).toBe("fail"); // base verdict fail preserved (override only downgrades pass, not upgrade warn/fail)
  });

  test("no matches above threshold returns pass with empty findings", async () => {
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => jsonResponse({ data: [{ embedding: Array(768).fill(0.1) }] }),
      "vectorize/v2/indexes/articles/query": async () => jsonResponse({
        result: { matches: [{ id: "p", score: 0.5, metadata: { title: "T" } }] },
      }),
    }));
    const r = await new SelfPlagiarismSkill().run("text", cfgBase);
    expect(r.verdict).toBe("pass");
    expect(r.findings.length).toBe(0);
  });

  test("empty index returns pass + hint to run index command", async () => {
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => jsonResponse({ data: [{ embedding: Array(768).fill(0.1) }] }),
      "vectorize/v2/indexes/articles/query": async () => jsonResponse({ result: { matches: [] } }),
    }));
    const r = await new SelfPlagiarismSkill().run("text", cfgBase);
    expect(r.verdict).toBe("pass");
    expect(r.summary.toLowerCase()).toContain("checkapp index");
  });

  test("no provider configured → skipped", async () => {
    const cfg: Config = { ...cfgBase, providers: {} };
    const r = await new SelfPlagiarismSkill().run("text", cfg);
    expect(r.verdict).toBe("skipped");
    expect(r.findings.length).toBe(0);
  });

  test("no OpenRouter key → skipped", async () => {
    const { openrouterApiKey, ...cfgNoOr } = cfgBase;
    const r = await new SelfPlagiarismSkill().run("text", cfgNoOr as Config);
    expect(r.verdict).toBe("skipped");
    expect(r.findings.length).toBe(0);
  });

  test("missing accountId → skipped", async () => {
    const cfg: Config = {
      ...cfgBase,
      providers: { "self-plagiarism": { provider: "cloudflare-vectorize", apiKey: "k", extra: { indexName: "articles" } } },
    };
    const r = await new SelfPlagiarismSkill().run("text", cfg);
    expect(r.verdict).toBe("skipped");
    expect(r.findings.length).toBe(0);
  });

  test("embed failure → warn with friendly error", async () => {
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => new Response("bad request", { status: 400 }),
    }));
    const r = await new SelfPlagiarismSkill().run("text", cfgBase);
    expect(r.verdict).toBe("warn");
    expect(r.summary).toContain("failed");
  });
});
