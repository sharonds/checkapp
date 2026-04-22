import { describe, test, expect } from "bun:test";
import { AcademicSkill } from "./academic.ts";
import type { Config } from "../config.ts";
import type { SkillResult } from "./types.ts";
import { mockFetch, urlRouter, jsonResponse } from "../testing/mock-fetch.ts";

const cfgBase: Config = {
  copyscapeUser: "", copyscapeKey: "",
  providers: { academic: { provider: "semantic-scholar" } },
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    academic: true,
  },
};

describe("AcademicSkill — standalone (run)", () => {
  test("scans plain text for claim-like sentences when no priorFindings", async () => {
    mockFetch(urlRouter({
      "api.semanticscholar.org": async () => jsonResponse({
        data: [{
          paperId: "1", title: "Remote work ergonomics",
          authors: [{ name: "Smith" }], year: 2023,
          externalIds: { DOI: "10.1/abc" },
          abstract: "Study...",
          url: "https://example.org/paper",
        }],
      }),
    }));
    const r = await new AcademicSkill().run(
      "A 2023 study found 73 percent of remote workers experience back pain. Separate trivia sentence.",
      cfgBase,
    );
    expect(r.findings.length).toBeGreaterThanOrEqual(1);
    expect(r.findings[0].citations?.[0].doi).toBe("10.1/abc");
  });

  test("no-provider returns skipped verdict", async () => {
    const cfg: Config = { ...cfgBase, providers: {} };
    const r = await new AcademicSkill().run("anything", cfg);
    expect(r.verdict).toBe("skipped");
    expect(r.findings.length).toBe(0);
  });

  test("pass verdict with no findings when text has no claim-like sentences", async () => {
    mockFetch(urlRouter({ "api.semanticscholar.org": async () => jsonResponse({ data: [] }) }));
    const r = await new AcademicSkill().run("hello world.", cfgBase);
    expect(r.verdict).toBe("pass");
    expect(r.findings.length).toBe(0);
  });
});

describe("AcademicSkill — enricher", () => {
  test("consumes fact-check priorResults and targets scientific/medical/financial claims only", async () => {
    mockFetch(urlRouter({
      "api.semanticscholar.org": async () => jsonResponse({
        data: [{ paperId: "p1", title: "T", authors: [{ name: "A" }], year: 2023, externalIds: { DOI: "10.1/x" } }],
      }),
    }));
    const factCheckResult: SkillResult = {
      skillId: "fact-check", name: "Fact Check", score: 80, verdict: "warn",
      summary: "", costUsd: 0,
      findings: [
        { severity: "warn", text: `Unverified: "73 percent of remote workers" — note`, claimType: "scientific" },
        { severity: "info", text: `Verified: "general trivia" — note`, claimType: "general" },
        { severity: "warn", text: `Unverified: "medical claim X" — note`, claimType: "medical" },
      ],
    };
    const r = await new AcademicSkill().enrich("the article text", cfgBase, [factCheckResult]);
    expect(r.findings.length).toBe(2);
    expect(r.findings.every(f => f.citations?.length)).toBe(true);
  });

  test("returns pass with empty findings when no matching claimType", async () => {
    const factCheckResult: SkillResult = {
      skillId: "fact-check", name: "Fact Check", score: 80, verdict: "pass",
      summary: "", costUsd: 0,
      findings: [{ severity: "info", text: `Verified: "general stuff" — note`, claimType: "general" }],
    };
    const r = await new AcademicSkill().enrich("text", cfgBase, [factCheckResult]);
    expect(r.verdict).toBe("pass");
    expect(r.findings.length).toBe(0);
  });
});

const baseConfig: Config = {
  copyscapeUser: "", copyscapeKey: "",
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    academic: true,
  },
};

const sampleText = "A 2017 study found that vitamin D supplementation reduces the risk of acute respiratory tract infections.";

describe("AcademicSkill provider routing", () => {
  test("routes to OpenAlex when openalexMailto is configured", async () => {
    let openalexCalls = 0;
    let ssCalls = 0;
    mockFetch(urlRouter({
      "api.openalex.org": async () => {
        openalexCalls++;
        return jsonResponse({
          results: [{
            id: "https://openalex.org/W1",
            doi: "https://doi.org/10.1136/bmj.i6583",
            title: "Vitamin D supplementation to prevent acute respiratory tract infections",
            publication_year: 2017,
            authorships: [{ author: { display_name: "Martineau AR" } }],
            primary_location: { landing_page_url: "https://www.bmj.com/content/356/bmj.i6583" },
          }],
        });
      },
      "api.semanticscholar.org": async () => {
        ssCalls++;
        return jsonResponse({ data: [] });
      },
    }));

    const skill = new AcademicSkill();
    const result = await skill.enrich(sampleText, { ...baseConfig, openalexMailto: "test@example.com" }, []);

    expect(openalexCalls).toBeGreaterThan(0);
    expect(ssCalls).toBe(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });

  test("routes to Semantic Scholar via legacy explicit providers config (no openalexMailto)", async () => {
    let openalexCalls = 0;
    let ssCalls = 0;
    mockFetch(urlRouter({
      "api.openalex.org": async () => {
        openalexCalls++;
        return jsonResponse({ results: [] });
      },
      "api.semanticscholar.org": async () => {
        ssCalls++;
        return jsonResponse({
          data: [{
            paperId: "S1", title: "Some SS paper", year: 2019, authors: [{ name: "X" }],
          }],
        });
      },
    }));

    const skill = new AcademicSkill();
    await skill.enrich(sampleText, {
      ...baseConfig,
      providers: { academic: { provider: "semantic-scholar", apiKey: "ss-key" } },
    } as Config, []);

    expect(ssCalls).toBeGreaterThan(0);
    expect(openalexCalls).toBe(0);
  });
});
