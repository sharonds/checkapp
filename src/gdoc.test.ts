import { test, expect, describe } from "bun:test";
import { writeFileSync, unlinkSync } from "fs";
import { isLocalPath, fetchGoogleDoc } from "./gdoc.ts";

describe("isLocalPath", () => {
  test("absolute path is local", () => {
    expect(isLocalPath("/home/user/article.txt")).toBe(true);
  });

  test("relative path with ./ is local", () => {
    expect(isLocalPath("./article.md")).toBe(true);
  });

  test("relative path with ../ is local", () => {
    expect(isLocalPath("../article.md")).toBe(true);
  });

  test(".md extension is local", () => {
    expect(isLocalPath("article.md")).toBe(true);
  });

  test(".txt extension is local", () => {
    expect(isLocalPath("article.txt")).toBe(true);
  });

  test(".MD uppercase extension is local", () => {
    expect(isLocalPath("article.MD")).toBe(true);
  });

  test(".TXT uppercase extension is local", () => {
    expect(isLocalPath("article.TXT")).toBe(true);
  });

  test("Google Doc URL is not local", () => {
    expect(isLocalPath("https://docs.google.com/document/d/ABC123/edit")).toBe(
      false
    );
  });

  test("raw Doc ID is not local", () => {
    expect(isLocalPath("1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgVE2upms")).toBe(
      false
    );
  });
});

describe("fetchGoogleDoc with local file", () => {
  const TMP = "/tmp/checkapp-test.md";

  test("reads local .md file and returns cleaned text", async () => {
    writeFileSync(TMP, "# Hello\r\nThis is a test article.\r\n\r\n\r\nEnd.");
    try {
      const text = await fetchGoogleDoc(TMP);
      expect(text).toContain("Hello");
      expect(text).toContain("This is a test article.");
      expect(text).toContain("End.");
      expect(text).not.toMatch(/\n{3,}/);
    } finally {
      unlinkSync(TMP);
    }
  });

  test("throws a clear error for a missing local file", async () => {
    await expect(fetchGoogleDoc("/tmp/does-not-exist-xyz.md")).rejects.toThrow(
      "File not found: /tmp/does-not-exist-xyz.md"
    );
  });

  test("reads local .txt file and returns cleaned text", async () => {
    const TMP_TXT = "/tmp/checkapp-test.txt";
    writeFileSync(TMP_TXT, "Plain text article.\nSecond line.");
    try {
      const text = await fetchGoogleDoc(TMP_TXT);
      expect(text).toContain("Plain text article.");
      expect(text).toContain("Second line.");
    } finally {
      unlinkSync(TMP_TXT);
    }
  });
});
