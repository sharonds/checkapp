import { describe, expect, test } from "bun:test";
import { analyzeDocument, locateQuote, factRewriteSuggestion, plagiarismRewriteSuggestion } from "./document.ts";

describe("audit document analysis", () => {
  test("segments multi-section English documents with stable locations", () => {
    const text = "# Intro\n\nVitamin C cures every cold. The second sentence is here.\n\n# Details\n\nThis claim appears later.";
    const analysis = analyzeDocument(text);
    expect(analysis.sectionsDetected).toBe(2);
    expect(analysis.paragraphsScanned).toBe(2);
    expect(analysis.sentencesScanned).toBe(3);
    const located = locateQuote(text, "Vitamin C cures every cold.", analysis);
    expect(located.quote).toBe("Vitamin C cures every cold.");
    expect(located.location?.sectionId).toBe("section-1");
    expect(located.location?.paragraphIndex).toBe(0);
    expect(located.location?.startOffset).toBeGreaterThan(0);
    expect(located.location?.matchQuality).toBe("exact");
  });

  test("fuzzy quote matches are labeled approximate and omit exact offsets", () => {
    const text = "# Games\n\nRummikub is a tile game for two to four players.";
    const analysis = analyzeDocument(text);
    const located = locateQuote(text, "Rummikub supports two players only.", analysis);

    expect(located.location?.sectionTitle).toBe("Games");
    expect(located.quote).toBe("Rummikub is a tile game for two to four players.");
    expect(located.location?.paragraphIndex).toBe(0);
    expect(located.location?.matchQuality).toBe("fuzzy");
    expect(located.location?.startOffset).toBeUndefined();
    expect(located.location?.endOffset).toBeUndefined();
  });

  test("normalized whitespace matches are approximate unless raw quote offsets are known", () => {
    const text = "# Games\n\nRummikub is a tile game for two to four players.";
    const analysis = analyzeDocument(text);
    const located = locateQuote(text, "Rummikub is a tile game for two   to four players.", analysis);

    expect(located.location?.matchQuality).toBe("fuzzy");
    expect(located.location?.startOffset).toBeUndefined();
    expect(located.location?.endOffset).toBeUndefined();
  });

  test("case-insensitive exact matching keeps offsets aligned when earlier characters fold to multiple code units", () => {
    const text = "İstanbul reports: WINS were recorded after the final.";
    const analysis = analyzeDocument(text);
    const located = locateQuote(text, "wins were recorded", analysis);

    expect(located.quote).toBe("WINS were recorded");
    expect(located.location?.matchQuality).toBe("exact");
    expect(text.slice(located.location?.startOffset, located.location?.endOffset)).toBe(located.quote);
  });

  test("case-insensitive locate preserves exact offsets for supported fold paths", () => {
    const text = "straße appears first. WINS were recorded after the final.";
    const located = locateQuote(text, "wins were recorded");
    expect(located.quote).toBe("WINS were recorded");
    expect(located.location?.matchQuality).toBe("exact");
    expect(text.slice(located.location?.startOffset, located.location?.endOffset)).toBe(located.quote);
  });

  test("case-insensitive locate still matches after earlier length-changing characters", () => {
    const text = "İstanbul hosted the event and WINS were recorded.";
    const located = locateQuote(text, "wins were recorded");
    expect(located?.quote).toBe("WINS were recorded");
    expect(located?.location?.matchQuality).toBe("exact");
  });

  test("documents the Turkish İ limitation: İstanbul/istanbul is not an exact pair (degrades to fuzzy)", () => {
    // The accent-sensitive collator treats the dot-above as significant, so
    // this pair never matched exactly — before or after the prefilter. It
    // falls through to the fuzzy/token-overlap path instead of being lost.
    const text = "İstanbul hosted the annual technology conference downtown.";
    const located = locateQuote(text, "istanbul hosted the annual technology conference");
    expect(located?.location?.matchQuality).not.toBe("exact");
  });

  test("locateQuote stays under 500ms for 10 unmatched quotes on a 10k-word article", () => {
    const words = Array.from({ length: 10_000 }, (_, i) => `word${i % 700}`);
    const text = Array.from({ length: 500 }, (_, p) => words.slice(p * 20, p * 20 + 20).join(" ")).join("\n\n");
    const doc = analyzeDocument(text);
    const quotes = Array.from({ length: 10 }, (_, i) => `completely absent phrase ${i} ציטוט שאינו קיים`);
    const start = performance.now();
    for (const q of quotes) locateQuote(text, q, doc);
    // Performance non-regression guard. This may already pass on PR3; keep the
    // threshold broad enough to avoid CI noise while catching accidental O(n*m)
    // regressions in the case-insensitive scan.
    expect(performance.now() - start).toBeLessThan(500);
  });

  test("preserves Hebrew and mixed Hebrew-English direction metadata", () => {
    const hebrew = "המשחק Rummikub מתאים לשני שחקנים בלבד. בפועל יש עוד טענה.";
    const analysis = analyzeDocument(hebrew);
    expect(analysis.language).toBe("he");
    expect(analysis.direction).toBe("rtl");
    const located = locateQuote(hebrew, "Rummikub מתאים לשני שחקנים", analysis);
    expect(located.quote).toBe("Rummikub מתאים לשני שחקנים");
    expect(located.language).toBe("he");
    expect(located.direction).toBe("rtl");
    expect(factRewriteSuggestion(located.quote, "he", false, "המקור הרשמי סותר את הטענה")).toContain("יש לנסח מחדש");
    expect(plagiarismRewriteSuggestion(located.quote, "he")).toContain("ייחוס מפורש");
  });

  test("mixed English-majority documents use English report language and LTR direction", () => {
    const text = "This English report mentions רמיקוב once while the surrounding article remains English.";
    const analysis = analyzeDocument(text);

    expect(analysis.language).toBe("en");
    expect(analysis.direction).toBe("ltr");
  });

  test("repeated exact quotes resolve deterministically to the first matching location", () => {
    const text = "# A\n\nRepeat this claim.\n\n# B\n\nRepeat this claim.";
    const analysis = analyzeDocument(text);
    const located = locateQuote(text, "Repeat this claim.", analysis);
    expect(located.location?.sectionId).toBe("section-1");
    expect(located.location?.paragraphIndex).toBe(0);
    expect(located.location?.matchQuality).toBe("exact");
  });
});
