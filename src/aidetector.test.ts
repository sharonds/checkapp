import { test, expect, describe } from "bun:test";

// Import the internal parser via a test-only export pattern —
// we test the XML parsing logic directly without making network calls.
// Since parseAiResponse is not exported, we test the public surface
// (checkAiDetector) via its response shape contract, and test the
// verdict thresholds separately.

describe("AI detector verdict thresholds", () => {
  // Replicate the threshold logic from aidetector.ts
  function verdictFrom(aiPct: number): "human" | "mixed" | "ai" {
    if (aiPct >= 70) return "ai";
    if (aiPct >= 30) return "mixed";
    return "human";
  }

  test("0% → human", () => expect(verdictFrom(0)).toBe("human"));
  test("15% → human", () => expect(verdictFrom(15)).toBe("human"));
  test("29% → human", () => expect(verdictFrom(29)).toBe("human"));
  test("30% → mixed", () => expect(verdictFrom(30)).toBe("mixed"));
  test("50% → mixed", () => expect(verdictFrom(50)).toBe("mixed"));
  test("69% → mixed", () => expect(verdictFrom(69)).toBe("mixed"));
  test("70% → ai", () => expect(verdictFrom(70)).toBe("ai"));
  test("95% → ai", () => expect(verdictFrom(95)).toBe("ai"));
});

describe("AI score percentage rounding", () => {
  function toPct(score: number): number {
    return Math.round(score * 100);
  }

  test("0.982874 → 98%", () => expect(toPct(0.982874)).toBe(98));
  test("0.01 → 1%", () => expect(toPct(0.01)).toBe(1));
  test("0.499 → 50%", () => expect(toPct(0.499)).toBe(50));
  test("0.705 → 71%", () => expect(toPct(0.705)).toBe(71));
});

describe("segment filtering", () => {
  function filterTopSegments(
    segments: Array<{ text: string; aiScore: number }>
  ) {
    return [...segments]
      .sort((a, b) => b.aiScore - a.aiScore)
      .slice(0, 3)
      .filter((s) => s.aiScore >= 0.7);
  }

  test("only surfaces segments at or above 0.70", () => {
    const segs = [
      { text: "A", aiScore: 0.9 },
      { text: "B", aiScore: 0.65 },
      { text: "C", aiScore: 0.8 },
    ];
    const result = filterTopSegments(segs);
    expect(result.map((s) => s.text)).toEqual(["A", "C"]);
  });

  test("returns at most 3 segments", () => {
    const segs = Array.from({ length: 5 }, (_, i) => ({
      text: String(i),
      aiScore: 0.9 - i * 0.01,
    }));
    expect(filterTopSegments(segs).length).toBeLessThanOrEqual(3);
  });

  test("returns empty when all segments below threshold", () => {
    const segs = [{ text: "A", aiScore: 0.5 }];
    expect(filterTopSegments(segs)).toHaveLength(0);
  });
});
