import { describe, test, expect } from "vitest";
import { estimateRunCost, type AppConfigForEstimate } from "./estimator";

const base = (skills: Partial<AppConfigForEstimate["skills"]> = {}): AppConfigForEstimate => ({
  skills: {
    factCheck: false,
    grammar: false,
    academic: false,
    selfPlagiarism: false,
    plagiarism: false,
    aiDetection: false,
    ...skills,
  },
  providers: {},
});

describe("estimateRunCost", () => {
  test("fact-check scales by MAX_CLAIMS (4)", () => {
    const r = estimateRunCost(
      {
        ...base({ factCheck: true }),
        providers: { "fact-check": { provider: "exa-search", apiKey: "k" } },
      },
      1000
    );
    expect(r.perSkill["fact-check"]).toBeCloseTo(0.008 * 4, 4);
  });

  test("fact-check uses selected standard tier pricing when the flag is on", () => {
    const r = estimateRunCost(
      {
        ...base({ factCheck: true }),
        factCheckTierFlag: true,
        factCheckTier: "standard",
        providers: { "fact-check": { provider: "exa-search", apiKey: "k" } },
      },
      1000
    );
    expect(r.perSkill["fact-check"]).toBeCloseTo(0.16, 4);
  });

  test("fact-check uses provider pricing when the flag is off", () => {
    const r = estimateRunCost(
      {
        ...base({ factCheck: true }),
        factCheckTierFlag: false,
        factCheckTier: "premium",
        providers: { "fact-check": { provider: "exa-search", apiKey: "k" } },
      },
      1000
    );
    expect(r.perSkill["fact-check"]).toBeCloseTo(0.008 * 4, 4);
  });

  test("grammar free at normal word counts", () => {
    const r = estimateRunCost(
      {
        ...base({ grammar: true }),
        providers: { grammar: { provider: "languagetool" } },
      },
      500
    );
    expect(r.perSkill.grammar).toBe(0);
  });

  test("includes AI detection cost when skill enabled", () => {
    const r = estimateRunCost(
      {
        ...base({ aiDetection: true }),
        providers: { "ai-detection": { provider: "copyscape", apiKey: "k" } } as any,
      },
      800
    );
    expect(r.perSkill.aiDetection).toBeCloseTo(0.03);
  });

  test("resolves legacy exaApiKey + copyscapeKey when providers not set", () => {
    const cfg: AppConfigForEstimate = {
      skills: { factCheck: true, plagiarism: true },
      providers: {},
      exaApiKey: "x" as any,
      copyscapeKey: "y" as any,
    };
    const r = estimateRunCost(cfg, 800);
    expect(r.perSkill["fact-check"]).toBeGreaterThan(0);
    expect(r.perSkill.plagiarism).toBeGreaterThan(0);
  });

  test("total sums across active skills", () => {
    const r = estimateRunCost(
      {
        ...base({ factCheck: true, grammar: true }),
        providers: {
          "fact-check": { provider: "exa-search", apiKey: "k" },
          grammar: { provider: "languagetool" },
        },
      },
      1000
    );
    expect(r.total).toBeCloseTo(0.008 * 4, 4); // fact-check only (grammar free)
  });

  test("no skills enabled → total 0, no warnings", () => {
    const r = estimateRunCost(base(), 1000);
    expect(r.total).toBe(0);
    expect(r.warnings.length).toBe(0);
  });
});
