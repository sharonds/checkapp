import { describe, test, expect } from "bun:test";
import { normalizeFinding, normalizeSkillResult } from "./normalize.ts";

describe("normalizeFinding", () => {
  test("defaults missing arrays to undefined (stays absent, not crashing array-map)", () => {
    const old = { severity: "warn" as const, text: "old" };
    const n = normalizeFinding(old);
    expect(n.sources).toBeUndefined();
    expect(n.citations).toBeUndefined();
    expect(n.rewrite).toBeUndefined();
  });
  test("preserves new fields when present", () => {
    const x = normalizeFinding({ severity: "info" as const, text: "new", sources: [{ url: "u" }], rewrite: "r", citations: [{ title: "t" }] });
    expect(x.sources?.[0].url).toBe("u");
    expect(x.rewrite).toBe("r");
    expect(x.citations?.[0].title).toBe("t");
  });
  test("preserves whitelisted audit fields when present", () => {
    const x = normalizeFinding({
      severity: "error" as const,
      text: "bad claim",
      id: "finding-1",
      status: "unsupported",
      location: { sectionId: "s1", paragraphIndex: 2, sentenceIndex: 0, matchQuality: "fuzzy" },
      explanation: "The source disagrees.",
      explanationLanguage: "en",
      explanationDir: "ltr",
      confidenceRationale: "Official source contradicts it.",
      searchQueries: ["official claim"],
      provider: "gemini",
      model: "gemini-test",
      auditRef: { auditId: "audit-1", claimId: "claim-1" },
      unsafeExtra: { should: "drop" },
    });
    expect(x.id).toBe("finding-1");
    expect(x.status).toBe("unsupported");
    expect(x.location?.sectionId).toBe("s1");
    expect(x.location?.matchQuality).toBe("fuzzy");
    expect(x.searchQueries).toEqual(["official claim"]);
    expect(x.auditRef?.claimId).toBe("claim-1");
    expect((x as any).unsafeExtra).toBeUndefined();
  });
  test("coerces null to undefined so optional-chain checks work in React", () => {
    const x = normalizeFinding({ severity: "warn" as const, text: "x", sources: null as never, citations: null as never });
    expect(x.sources).toBeUndefined();
    expect(x.citations).toBeUndefined();
  });
});

describe("normalizeSkillResult", () => {
  test("normalizes each finding and defaults missing fields", () => {
    const raw = { skillId: "fact-check", name: "Fact Check", score: 80, verdict: "warn", summary: "s", findings: [{ severity: "warn", text: "t" }], costUsd: 0.01 };
    const r = normalizeSkillResult(raw);
    expect(r.findings[0].sources).toBeUndefined();
    expect(r.verdict).toBe("warn");
    expect(r.costUsd).toBe(0.01);
  });
  test("falls back to safe defaults for malformed input", () => {
    const r = normalizeSkillResult({});
    expect(r.skillId).toBe("");
    expect(r.findings).toEqual([]);
    expect(r.verdict).toBe("warn");
    expect(r.costUsd).toBe(0);
  });
});

test("survives nested garbage in findings[] — null, strings, numbers, valid mixed", () => {
  const r = normalizeSkillResult({ findings: [null, "oops", 42, { severity: "warn", text: "ok" }] });
  expect(r.findings).toHaveLength(4);
  expect(r.findings[0].text).toBe("");            // null → fallback
  expect(r.findings[1].text).toBe("");            // string → fallback
  expect(r.findings[2].text).toBe("");            // number → fallback
  expect(r.findings[3].text).toBe("ok");          // valid preserved
  expect(r.findings[3].severity).toBe("warn");
});

test("normalizeFinding returns safe default on null/undefined/primitives", () => {
  expect(normalizeFinding(null).text).toBe("");
  expect(normalizeFinding(undefined).severity).toBe("info");
  expect(normalizeFinding("hi").text).toBe("");
  expect(normalizeFinding(42).severity).toBe("info");
});

test("normalizeFinding rejects unknown severity value", () => {
  const r = normalizeFinding({ severity: "critical", text: "x" });
  expect(r.severity).toBe("info");
});

test("drops non-object sources/citations from findings", () => {
  const out = normalizeSkillResult({
    skillId: "test",
    name: "Test",
    score: 50,
    verdict: "warn",
    summary: "s",
    findings: [
      {
        severity: "warn",
        text: "claim",
        sources: ["bad", { url: "https://ok.example", title: "Ok" }, null],
        citations: [42, { title: "Real", doi: "10.x" }],
      },
    ],
    costUsd: 0,
  } as any);
  expect(out.findings[0].sources).toEqual([{ url: "https://ok.example", title: "Ok" }]);
  expect(out.findings[0].citations).toEqual([{ title: "Real", doi: "10.x" }]);
});
