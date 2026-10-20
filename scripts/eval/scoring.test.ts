import { describe, expect, test } from "bun:test";
import { appClaimsFromAudit, computeMetrics, normalizeSentence, scoreRows, sentencesMatch, wilson, type GoldRow } from "./scoring.ts";

// Synthetic data only — the real corpus lives outside the repo.
const gold = (over: Partial<GoldRow>): GoldRow => ({
  id: "g", doc: "a.md", class: "article", sentence: "The kettle holds 1.7 litres.", verdict: "supported", ...over,
});

describe("sentence matching", () => {
  test("normalises whitespace, quotes and trailing punctuation (incl. Hebrew geresh/gershayim)", () => {
    expect(normalizeSentence('  ערכה  של 2,842 ״חלקים״. ')).toBe(normalizeSentence('ערכה של 2,842 "חלקים"'));
  });

  test("matches containment either way and high token overlap, not unrelated sentences", () => {
    expect(sentencesMatch("The kettle holds 1.7 litres.", "The kettle holds 1.7 litres")).toBe(true);
    expect(sentencesMatch("Kettle: The kettle holds 1.7 litres.", "The kettle holds 1.7 litres.")).toBe(true);
    expect(sentencesMatch("The kettle holds 1.7 litres of water.", "The kettle holds 1.7 litres.")).toBe(true);
    expect(sentencesMatch("The toaster has 6 slots.", "The kettle holds 1.7 litres.")).toBe(false);
  });

  test("a different number is not a match (planted 8kg vs original 12kg must not be conflated)", () => {
    expect(sentencesMatch("The dryer takes 8 kg.", "The dryer takes 12 kg.")).toBe(false);
  });
});

describe("audit → app claims", () => {
  test("joins claims to their assessments by claimId", () => {
    const audit = {
      claims: [{ id: "claim-1", quote: "Q1" }, { id: "claim-2", quote: "Q2" }],
      factAssessments: [{ claimId: "claim-2", status: "unsupported" }, { claimId: "claim-1", status: "supported" }],
    };
    expect(appClaimsFromAudit("a.md", audit)).toEqual([
      { doc: "a.md", quote: "Q1", status: "supported" },
      { doc: "a.md", quote: "Q2", status: "unsupported" },
    ]);
  });
});

describe("row scoring", () => {
  const app = [
    { doc: "a.md", quote: "The kettle holds 1.7 litres.", status: "supported" },
    { doc: "a.md", quote: "The toaster has 6 slots.", status: "unsupported" },
    { doc: "a.md", quote: "The fridge is A+++ rated.", status: "unverified" },
  ];

  test("maps gold verdicts to true/false/excluded/traceability and app statuses to flags", () => {
    const rows = scoreRows([
      gold({ id: "t1", sentence: "The kettle holds 1.7 litres.", verdict: "supported" }),
      gold({ id: "f1", sentence: "The toaster has 6 slots.", verdict: "partially_supported" }),
      gold({ id: "f2", sentence: "The fridge is A+++ rated.", verdict: "fabricated" }),
      gold({ id: "f3", sentence: "The oven reaches 900 degrees.", verdict: "unsupported" }),
      gold({ id: "x1", sentence: "Great value.", verdict: "not_checkworthy" }),
      gold({ id: "x2", sentence: "Later.", verdict: "skip" }),
      gold({ id: "x3", sentence: "No verdict yet.", verdict: undefined }),
      gold({ id: "tr", class: "traceability", sentence: "Policy covers 60 days.", verdict: "not_publicly_verifiable" }),
    ], app);
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId.t1).toMatchObject({ goldBinary: "true", matched: true, flaggedStrict: false, flaggedLenient: false });
    expect(byId.f1).toMatchObject({ goldBinary: "false", matched: true, flaggedStrict: true, flaggedLenient: true });
    expect(byId.f2).toMatchObject({ goldBinary: "false", matched: true, flaggedStrict: false, flaggedLenient: true });
    expect(byId.f3).toMatchObject({ goldBinary: "false", matched: false, flaggedStrict: false, flaggedLenient: false });
    expect(byId.x1.goldBinary).toBe("excluded");
    expect(byId.x2.goldBinary).toBe("excluded");
    expect(byId.x3.goldBinary).toBe("excluded");
    expect(byId.tr.goldBinary).toBe("traceability");
  });

  test("only compares a gold row with app claims from the same document", () => {
    const rows = scoreRows([gold({ doc: "b.md", sentence: "The toaster has 6 slots.", verdict: "unsupported" })], app);
    expect(rows[0]!.matched).toBe(false);
  });
});

describe("metrics", () => {
  test("Wilson interval is bounded and sensible", () => {
    const [lo, hi] = wilson(8, 10);
    expect(lo).toBeGreaterThan(0.44);
    expect(lo).toBeLessThan(0.5);
    expect(hi).toBeGreaterThan(0.94);
    expect(hi).toBeLessThan(0.97);
    expect(wilson(0, 0)).toEqual([0, 1]);
  });

  test("computes end-to-end recall, matched recall, false alarms, coverage, kappa, cost and latency", () => {
    const rows = [
      { id: "t1", doc: "a.md", class: "article", goldBinary: "true", matched: true, appStatuses: ["supported"], flaggedStrict: false, flaggedLenient: false },
      { id: "t2", doc: "a.md", class: "article", goldBinary: "true", matched: true, appStatuses: ["unsupported"], flaggedStrict: true, flaggedLenient: true },
      { id: "f1", doc: "a.md", class: "article", goldBinary: "false", matched: true, appStatuses: ["unsupported"], flaggedStrict: true, flaggedLenient: true },
      { id: "f2", doc: "a.md", class: "article", goldBinary: "false", matched: true, appStatuses: ["unverified"], flaggedStrict: false, flaggedLenient: true },
      { id: "f3", doc: "a.md", class: "planted", goldBinary: "false", matched: false, appStatuses: [], flaggedStrict: false, flaggedLenient: false },
      { id: "tr", doc: "a.md", class: "traceability", goldBinary: "traceability", matched: true, appStatuses: ["supported"], flaggedStrict: false, flaggedLenient: false },
      { id: "x", doc: "a.md", class: "article", goldBinary: "excluded", matched: false, appStatuses: [], flaggedStrict: false, flaggedLenient: false },
    ] as const;
    const m = computeMetrics([...rows], [{ doc: "a.md", costUsd: 0.5, wallMs: 1000 }, { doc: "b.md", costUsd: 0.3, wallMs: 3000 }]);
    expect(m.counts).toMatchObject({ scorable: 5, goldTrue: 2, goldFalse: 3, traceability: 1, excluded: 1 });
    expect(m.recallFalseStrict.value).toBeCloseTo(1 / 3);
    expect(m.recallFalseLenient.value).toBeCloseTo(2 / 3);
    expect(m.matchedRecallFalseLenient.value).toBeCloseTo(1);
    expect(m.falseAlarmRate.value).toBeCloseTo(1 / 2);
    expect(m.coverage.value).toBeCloseTo(4 / 5);
    expect(m.traceabilityFlagRate.value).toBe(0);
    expect(m.byClass.planted.recallFalseLenient.value).toBe(0);
    expect(m.costPerArticleUsd).toBeCloseTo(0.4);
    expect(m.latencyMs).toMatchObject({ p50: 1000, p90: 3000 });
    expect(typeof m.kappa).toBe("number");
  });
});
