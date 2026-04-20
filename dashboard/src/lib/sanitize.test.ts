import { describe, test, expect } from "vitest";
import { sanitizeText, safeHref } from "./sanitize";

describe("sanitizeText", () => {
  test("does not double-ellipsize already-truncated input", () => {
    // Simulate text that already ends with "…"
    const input = "This is a very long text that has already been truncated and ends with an ellipsis…";
    const result = sanitizeText(input, 50);
    // Should end with exactly one "…"
    expect(result).toBe("This is a very long text that has already been t…");
    expect(result.match(/…/g)).toHaveLength(1);
  });

  test("adds ellipsis when truncating text not ending with ellipsis", () => {
    const input = "This is a very long text that needs to be truncated";
    const result = sanitizeText(input, 20);
    expect(result).toBe("This is a very long …");
    expect(result.match(/…/g)).toHaveLength(1);
  });

  test("strips control characters before truncating", () => {
    const input = "Hello\x00World\x1Ftest";
    const result = sanitizeText(input, 100);
    expect(result).toBe("HelloWorldtest");
  });

  test("returns empty string for non-string input", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText(123)).toBe("");
  });
});

describe("safeHref", () => {
  test("allows https URLs", () => {
    const result = safeHref("https://example.com");
    expect(result).toBe("https://example.com/");
  });

  test("blocks javascript: URLs", () => {
    const result = safeHref("javascript:alert('xss')");
    expect(result).toBe("#");
  });

  test("returns # for empty string", () => {
    expect(safeHref("")).toBe("#");
  });

  test("returns # for non-string input", () => {
    expect(safeHref(null)).toBe("#");
    expect(safeHref(123)).toBe("#");
  });
});
