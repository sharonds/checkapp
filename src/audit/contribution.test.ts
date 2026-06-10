import { describe, expect, test } from "bun:test";
import { SkillRegistry } from "../skills/registry.ts";
import type { Config } from "../config.ts";
import type { Skill, SkillResult } from "../skills/types.ts";
import { mergeAuditContributions, mergeAuditContributionsWithRefs, normalizeSkillRunOutput, remapResultAuditRefs } from "./contribution.ts";
import type { AuditRecord } from "./types.ts";

const config: Config = {
  copyscapeUser: "",
  copyscapeKey: "",
  skills: { plagiarism: false, aiDetection: false, seo: false, factCheck: false, tone: false, legal: false, summary: false, brief: false, purpose: false },
};

const result: SkillResult = {
  skillId: "test",
  name: "Test",
  score: 90,
  verdict: "pass",
  summary: "ok",
  findings: [],
  costUsd: 0,
};

const audit: AuditRecord = {
  version: 1,
  auditId: "audit-1",
  language: "en",
  direction: "ltr",
  coverage: {
    wordsScanned: 10,
    sectionsDetected: 1,
    paragraphsScanned: 1,
    sentencesScanned: 1,
    claimsExtracted: 1,
    claimsChecked: 1,
    claimsSkipped: 0,
    skipReasons: {},
    plagiarismPassagesChecked: 0,
    plagiarismPassagesSkipped: 0,
    providerFailures: 0,
    providerRetries: 0,
  },
  segments: [],
  claims: [],
  claimDecisions: [],
  factAssessments: [],
  plagiarismFindings: [],
  providerAttempts: [],
  createdAt: "2026-06-09T00:00:00.000Z",
};

describe("AuditContribution", () => {
  test("normalizes legacy SkillResult output", () => {
    expect(normalizeSkillRunOutput(result)).toEqual({ result, audit: undefined });
  });

  test("normalizes audit-producing output", () => {
    expect(normalizeSkillRunOutput({ kind: "audit-result", result, audit }).audit?.auditId).toBe("audit-1");
  });

  test("does not treat arbitrary result properties as audit wrappers without an explicit tag", () => {
    const oddResult = {
      ...result,
      result: { nested: true },
    } as unknown as SkillResult;
    const output = normalizeSkillRunOutput(oddResult);
    expect(output.result).toBe(oddResult);
    expect(output.audit).toBeUndefined();
  });

  test("drops malformed optional audit while preserving the skill result", () => {
    const output = normalizeSkillRunOutput({
      kind: "audit-result",
      result,
      audit: { ...audit, version: 2 } as unknown as AuditRecord,
    });
    expect(output.result).toBe(result);
    expect(output.audit).toBeUndefined();
  });

  test("merges audit contributions conservatively", () => {
    const merged = mergeAuditContributions([audit, { ...audit, auditId: "audit-2", providerAttempts: [{ id: "p1", provider: "fake", status: "success" }] }]);
    expect(merged?.auditId).toBe("audit-1");
    expect(merged?.providerAttempts).toHaveLength(1);
    expect(merged?.providerAttempts[0].id).toBe("a2-p1");
    expect(merged?.coverage.wordsScanned).toBe(10);
  });

  test("remaps result audit refs to the merged audit identity", () => {
    const second: AuditRecord = {
      ...audit,
      auditId: "audit-2",
      claims: [{ id: "claim-1", quote: "q", normalizedClaim: "q", type: "general" }],
      claimDecisions: [{ claimId: "claim-1", decision: "checked" }],
      factAssessments: [{ id: "assessment-1", claimId: "claim-1", status: "supported", sources: [] }],
    };
    const merged = mergeAuditContributionsWithRefs([audit, second]);
    const [remapped] = remapResultAuditRefs([{
      ...result,
      findings: [{ severity: "info", text: "t", auditRef: { auditId: "audit-2", claimId: "claim-1", assessmentId: "assessment-1" } }],
    }], merged.refMap, merged.audit?.auditId);
    expect(remapped.findings[0].auditRef).toEqual({
      auditId: "audit-1",
      claimId: "a2-claim-1",
      assessmentId: "a2-assessment-1",
    });
  });

  test("remaps plagiarism passageIds when duplicate segments are deduped", () => {
    const withSegment: AuditRecord = {
      ...audit,
      segments: [{
        id: "seg-1",
        sectionId: "section-1",
        text: "Repeated passage.",
        paragraphIndex: 0,
        sentenceIndex: 0,
        startOffset: 0,
        endOffset: 17,
      }],
    };
    const second: AuditRecord = {
      ...withSegment,
      auditId: "audit-2",
      plagiarismFindings: [{
        id: "plagiarism-1",
        quote: "Repeated passage.",
        source: { url: "https://example.com", accepted: true },
        status: "plagiarism_match",
        passageIds: ["seg-1"],
      }],
    };
    const merged = mergeAuditContributions([withSegment, second]);
    expect(merged?.segments.map((segment) => segment.id)).toEqual(["seg-1"]);
    expect(merged?.plagiarismFindings[0].passageIds).toEqual(["seg-1"]);
  });

  test("remaps fuzzy locations to an existing deduped section instead of a missing prefixed section", () => {
    const withSegment: AuditRecord = {
      ...audit,
      segments: [{
        id: "seg-1",
        sectionId: "section-1",
        text: "Repeated passage.",
        paragraphIndex: 0,
        sentenceIndex: 0,
        startOffset: 0,
        endOffset: 17,
      }],
    };
    const second: AuditRecord = {
      ...withSegment,
      auditId: "audit-2",
      claims: [{
        id: "claim-1",
        quote: "Repeated passage.",
        normalizedClaim: "Repeated passage.",
        type: "general",
        location: {
          sectionId: "section-1",
          paragraphIndex: 0,
          sentenceIndex: 0,
          matchQuality: "fuzzy",
        },
      }],
      claimDecisions: [{ claimId: "claim-1", decision: "checked" }],
    };

    const merged = mergeAuditContributions([withSegment, second]);
    const sectionIds = new Set(merged?.segments.map((segment) => segment.sectionId));
    expect(merged?.claims[0].location?.sectionId).toBe("section-1");
    expect(sectionIds.has(merged?.claims[0].location?.sectionId)).toBe(true);
  });

  test("registry can return legacy results plus merged audit", async () => {
    const legacy: Skill = { id: "legacy", name: "Legacy", async run() { return result; } };
    const audited: Skill = {
      id: "audited",
      name: "Audited",
      async run() {
        return { kind: "audit-result", result: { ...result, skillId: "audited", name: "Audited" }, audit };
      },
    };
    const registry = new SkillRegistry([legacy, audited]);
    const output = await registry.runAllWithAudit("text", config);
    expect(output.results.map((r) => r.skillId).sort()).toEqual(["audited", "test"]);
    expect(output.audit?.auditId).toBe("audit-1");
  });
});
