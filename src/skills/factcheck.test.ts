import { test, expect, describe } from "bun:test";
import { extractClaimsPrompt, claimConfidence, formatCitation } from "./factcheck.ts";

describe("extractClaimsPrompt", () => {
  test("returns a string containing the article text", () => {
    const prompt = extractClaimsPrompt("Vitamin D prevents cancer.");
    expect(prompt).toContain("Vitamin D prevents cancer");
  });

  test("asks for JSON array output", () => {
    const prompt = extractClaimsPrompt("Some article text.");
    expect(prompt.toLowerCase()).toContain("json");
    expect(prompt).toContain("claims");
  });
});

describe("claimConfidence", () => {
  test("returns high for 3+ sources when supported", () => {
    expect(claimConfidence(3, true)).toBe("high");
  });
  test("returns medium for 1-2 sources when supported", () => {
    expect(claimConfidence(2, true)).toBe("medium");
    expect(claimConfidence(1, true)).toBe("medium");
  });
  test("returns low when unsupported regardless of sources", () => {
    expect(claimConfidence(5, false)).toBe("low");
  });
  test("returns low when inconclusive", () => {
    expect(claimConfidence(3, null)).toBe("low");
  });
  test("returns low for 0 sources", () => {
    expect(claimConfidence(0, true)).toBe("low");
  });
});

describe("formatCitation", () => {
  test("formats URL as markdown link with domain", () => {
    const cite = formatCitation("https://www.cdc.gov/diabetes/basics/facts.html");
    expect(cite).toContain("cdc.gov");
    expect(cite).toContain("[");
    expect(cite).toContain("](");
  });
  test("strips www prefix", () => {
    expect(formatCitation("https://www.example.com/page")).toContain("[example.com]");
  });
  test("returns raw URL on parse failure", () => {
    expect(formatCitation("not-a-url")).toBe("not-a-url");
  });
});
