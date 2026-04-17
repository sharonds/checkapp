import { describe, test, expect } from "vitest";
import { safeHref, sanitizeText } from "@/lib/sanitize";

describe("safeHref", () => {
  test("allows http/https", () => {
    expect(safeHref("https://example.com")).toBe("https://example.com/");
    expect(safeHref("http://example.com/path?q=1")).toBe("http://example.com/path?q=1");
  });
  test("allows mailto", () => {
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
  });
  test("blocks javascript: (case-insensitive)", () => {
    expect(safeHref("javascript:alert(1)")).toBe("#");
    expect(safeHref("JaVaScRiPt:alert(1)")).toBe("#");
    expect(safeHref("  javascript:x")).toBe("#");
  });
  test("blocks data: URIs", () => {
    expect(safeHref("data:text/html,<script>")).toBe("#");
  });
  test("blocks file: and vbscript:", () => {
    expect(safeHref("file:///etc/passwd")).toBe("#");
    expect(safeHref("vbscript:msgbox")).toBe("#");
  });
  test("rejects empty / malformed", () => {
    expect(safeHref("")).toBe("#");
    expect(safeHref("not a url")).toBe("#");
    expect(safeHref(null)).toBe("#");
    expect(safeHref(undefined)).toBe("#");
    expect(safeHref(42)).toBe("#");
  });
});

describe("sanitizeText", () => {
  test("preserves plain content", () => {
    expect(sanitizeText("Hello World")).toBe("Hello World");
  });
  test("strips C0 control chars but keeps backslashes + quotes", () => {
    expect(sanitizeText("a\\b")).toBe("a\\b");
    expect(sanitizeText('quote " inside')).toBe('quote " inside');
    expect(sanitizeText("bell\x07char")).toBe("bellchar");
    expect(sanitizeText("null\x00byte")).toBe("nullbyte");
  });
  test("preserves newlines and tabs (\\n \\t are not C0 controls)", () => {
    expect(sanitizeText("line1\nline2\ttabbed")).toBe("line1\nline2\ttabbed");
  });
  test("truncates to maxLen with ellipsis", () => {
    const long = "x".repeat(3000);
    const r = sanitizeText(long, 2000);
    expect(r.length).toBe(2001); // 2000 + "…"
    expect(r.endsWith("…")).toBe(true);
  });
  test("non-strings return empty", () => {
    expect(sanitizeText(null)).toBe("");
    expect(sanitizeText(undefined)).toBe("");
    expect(sanitizeText({})).toBe("");
  });
});
