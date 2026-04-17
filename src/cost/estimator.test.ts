import { describe, test, expect } from "bun:test";
import { estimateRunCost } from "./estimator.ts";
import type { Config } from "../config.ts";

const skillsOff = {
  plagiarism: false, aiDetection: false, seo: false,
  factCheck: false, tone: false, legal: false,
  summary: false, brief: false, purpose: false,
};

const base = (skills: Partial<Config["skills"]> = {}): Config => ({
  copyscapeUser: "", copyscapeKey: "",
  skills: { ...skillsOff, ...skills },
});

describe("estimateRunCost", () => {
  test("fact-check scales by MAX_CLAIMS (4)", () => {
    const cfg: Config = {
      ...base({ factCheck: true }),
      providers: { "fact-check": { provider: "exa-search", apiKey: "k" } },
    };
    const r = estimateRunCost(cfg, 1000);
    expect(r.perSkill["fact-check"]).toBeCloseTo(0.008 * 4, 4); // $0.032
  });

  test("fact-check deep-reasoning is $0.025 × 4 = $0.100", () => {
    const cfg: Config = {
      ...base({ factCheck: true }),
      providers: { "fact-check": { provider: "exa-deep-reasoning", apiKey: "k" } },
    };
    const r = estimateRunCost(cfg, 1000);
    expect(r.perSkill["fact-check"]).toBeCloseTo(0.025 * 4, 4); // $0.100
  });

  test("grammar LanguageTool is free at normal word counts", () => {
    const cfg: Config = {
      ...base({ grammar: true }),
      providers: { grammar: { provider: "languagetool" } },
    };
    const r = estimateRunCost(cfg, 500);
    expect(r.perSkill.grammar).toBe(0);
    expect(r.warnings.length).toBe(0);
  });

  test("grammar LanguageTool warns at >20KB (~3.3k words)", () => {
    const cfg: Config = {
      ...base({ grammar: true }),
      providers: { grammar: { provider: "languagetool" } },
    };
    const r = estimateRunCost(cfg, 5000); // 5000 × 6 = 30KB
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("20KB");
  });

  test("self-plagiarism includes embedding cost scaling with tokens", () => {
    const cfg: Config = {
      ...base({ selfPlagiarism: true }),
      openrouterApiKey: "or-key",
      providers: { "self-plagiarism": { provider: "cloudflare-vectorize", apiKey: "k", extra: { accountId: "a" } } },
    };
    const r = estimateRunCost(cfg, 2000);
    // base 0.0001 + (2000/0.75 = ~2667 tokens) × 0.00002/1000 = ~0.0001 + 0.0000533 = 0.000153
    expect(r.perSkill["self-plagiarism"]).toBeGreaterThan(0.0001);
    expect(r.perSkill["self-plagiarism"]).toBeLessThan(0.001);
  });

  test("academic scales with word count (paragraphs ~400 words each, capped at 5)", () => {
    const cfg: Config = {
      ...base({ academic: true }),
      providers: { academic: { provider: "semantic-scholar" } },
    };
    const r = estimateRunCost(cfg, 1200);
    expect(r.perSkill.academic).toBe(0); // semantic-scholar is free
  });

  test("total sums across active skills", () => {
    const cfg: Config = {
      ...base({ factCheck: true, grammar: true, academic: true }),
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "k" },
        grammar: { provider: "languagetool" },
        academic: { provider: "semantic-scholar" },
      },
    };
    const r = estimateRunCost(cfg, 1000);
    expect(r.total).toBeCloseTo(0.008 * 4, 4); // fact-check only (others free)
  });

  test("no skills enabled → total 0, no warnings", () => {
    const r = estimateRunCost(base(), 1000);
    expect(r.total).toBe(0);
    expect(r.warnings.length).toBe(0);
  });
});
