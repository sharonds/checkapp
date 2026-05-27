import { describe, expect, test } from "bun:test";
import { safeReportUrl } from "./report-sanitize.ts";

describe("safeReportUrl", () => {
  test("allows http and https report URLs", () => {
    expect(safeReportUrl("https://example.com/path?q=1")).toBe("https://example.com/path?q=1");
    expect(safeReportUrl("http://example.com/")).toBe("http://example.com/");
  });

  test("rejects non-web protocols", () => {
    expect(safeReportUrl("mailto:editor@example.com")).toBeNull();
    expect(safeReportUrl("javascript:alert(1)")).toBeNull();
    expect(safeReportUrl("file:///etc/passwd")).toBeNull();
  });
});
