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
});
