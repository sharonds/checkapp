import { describe, test, expect } from "bun:test";
import { oaSearch } from "../../src/providers/openalex.ts";

const RUN = process.env.OPENALEX_INTEGRATION === "1";
const mailto = process.env.OPENALEX_MAILTO;

describe.skipIf(!RUN)("OpenAlex live API", () => {
  test("returns a well-formed paper list for a well-known medical query", async () => {
    const papers = await oaSearch(
      "Vitamin D supplementation acute respiratory tract infections",
      5,
      { mailto }
    );
    expect(papers.length).toBeGreaterThan(0);
    for (const p of papers) {
      expect(typeof p.paperId).toBe("string");
      expect(p.paperId.length).toBeGreaterThan(0);
      expect(typeof p.title).toBe("string");
      expect(p.title.length).toBeGreaterThan(0);
      expect(Array.isArray(p.authors)).toBe(true);
    }
    const topical = papers.some((p) =>
      /vitamin|respiratory|infection/i.test(p.title)
    );
    expect(topical).toBe(true);
  }, 15000);

  test("does not throw for a low-signal query", async () => {
    const papers = await oaSearch("zxqvwypqxcvbnmasdfgklqwerty", 3, { mailto });
    expect(Array.isArray(papers)).toBe(true);
  }, 15000);
});
