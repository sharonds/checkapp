import { describe, test, expect } from "vitest";

export function isRerunnableSource(source: string): boolean {
  if (source === "mcp-check") return false;
  if (source.startsWith("http://") || source.startsWith("https://")) {
    return /docs\.google\.com\/document/.test(source);
  }
  return source.startsWith("/") || /\.(md|txt|markdown)$/i.test(source);
}

describe("isRerunnableSource", () => {
  test.each([
    ["mcp-check", false],
    ["custom-label", false],
    ["/abs/path/article.md", true],
    ["https://docs.google.com/document/d/xyz/edit", true],
  ])("isRerunnableSource(%s) → %s", (source, expected) => {
    expect(isRerunnableSource(source)).toBe(expected);
  });

  test("returns false for http URLs that aren't Google Docs", () => {
    expect(isRerunnableSource("http://example.com")).toBe(false);
    expect(isRerunnableSource("https://example.com")).toBe(false);
  });

  test("returns true for .txt files", () => {
    expect(isRerunnableSource("/path/to/file.txt")).toBe(true);
    expect(isRerunnableSource("file.txt")).toBe(true); // file extension matches
  });

  test("returns true for .markdown files", () => {
    expect(isRerunnableSource("/path/article.markdown")).toBe(true);
  });
});
