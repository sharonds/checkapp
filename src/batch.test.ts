import { describe, it, expect } from "bun:test";
import { discoverArticles } from "./batch.ts";

describe("discoverArticles", () => {
  it("finds .md and .txt files in demo directory", () => {
    const files = discoverArticles("demo");
    expect(files.length).toBeGreaterThan(0);
    expect(
      files.every((f) => f.endsWith(".md") || f.endsWith(".txt"))
    ).toBe(true);
  });

  it("returns sorted file paths", () => {
    const files = discoverArticles("demo");
    const sorted = [...files].sort();
    expect(files).toEqual(sorted);
  });

  it("returns empty for nonexistent dir", () => {
    expect(discoverArticles("/tmp/nonexistent-xyz-abc")).toEqual([]);
  });

  it("returns empty for a file path (not dir)", () => {
    expect(discoverArticles("package.json")).toEqual([]);
  });
});
