import { describe, test, expect } from "vitest";
import { normalizeFinding, normalizeSkillResult } from "@/lib/normalize";

describe("dashboard normalize mirror", () => {
  test("normalizeFinding handles null/undefined gracefully", () => {
    expect(normalizeFinding(null).text).toBe("");
    expect(normalizeFinding(undefined).severity).toBe("info");
  });

  test("normalizeSkillResult restores findings array from malformed blobs", () => {
    const r = normalizeSkillResult({
      findings: [null, "oops", { severity: "warn", text: "ok" }],
    });
    expect(r.findings).toHaveLength(3);
    expect(r.findings[2].text).toBe("ok");
  });

  test("drops non-object elements from sources and citations", () => {
    const f = normalizeFinding({
      severity: "info",
      text: "x",
      sources: ["bad", { url: "https://ok.example", title: "Ok" }, null],
      citations: [42, { title: "Real" }],
    });
    expect(f.sources).toEqual([{ url: "https://ok.example", title: "Ok" }]);
    expect(f.citations).toEqual([{ title: "Real" }]);
  });

  test("preserves 'skipped' verdict on skill result (issue #39)", () => {
    // Regression guard: pre-fix validVerdicts omitted 'skipped', so a stored
    // skipped skill got silently coerced to 'warn', then the report page
    // recomputed the verdict from score=0 and rendered it as FAIL.
    const r = normalizeSkillResult({
      skillId: "factCheck",
      name: "Fact Check",
      score: 0,
      verdict: "skipped",
      summary: "provider not configured",
      findings: [],
      costUsd: 0,
    });
    expect(r.verdict).toBe("skipped");
    expect(r.score).toBe(0);
  });

  test("still coerces unknown verdict values to 'warn' (defensive default)", () => {
    const r = normalizeSkillResult({
      skillId: "seo",
      name: "SEO",
      score: 50,
      verdict: "exploded",
      summary: "",
      findings: [],
      costUsd: 0,
    });
    expect(r.verdict).toBe("warn");
  });
});
