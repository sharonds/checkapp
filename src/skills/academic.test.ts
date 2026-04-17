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
