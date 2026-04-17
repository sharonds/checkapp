import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { getCsrfToken } from "./csrf";
import { writeTokenFile } from "@/testing";

describe("getCsrfToken", () => {
  let testTokenPath: string;

  beforeEach(() => {
    testTokenPath = `/tmp/checkapp-test-csrf-${Date.now()}`;
    mkdirSync(join(testTokenPath, ".."), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testTokenPath)) {
      try {
        unlinkSync(testTokenPath);
      } catch {
        // ignore
      }
    }
    delete process.env.CHECKAPP_CSRF_PATH;
  });

  test("csrfTokenForTests() returns stable test token", () => {
    const t1 = require("@/testing").csrfTokenForTests();
    const t2 = require("@/testing").csrfTokenForTests();
    expect(t1).toBe(t2);
    expect(t1.startsWith("test-csrf-")).toBe(true);
  });

  test("writeTokenFile sets CHECKAPP_CSRF_PATH and writes file", () => {
    writeTokenFile("my-token", testTokenPath);
    expect(process.env.CHECKAPP_CSRF_PATH).toBe(testTokenPath);
    expect(existsSync(testTokenPath)).toBe(true);
  });

  test("getCsrfToken reads from CHECKAPP_CSRF_PATH when set", () => {
    writeTokenFile("test-token-123", testTokenPath);
    // Force re-import to pick up env var
    const token = getCsrfToken();
    expect(token).toBe("test-token-123");
  });

  test("treats empty/whitespace csrf token as invalid and regenerates", () => {
    writeTokenFile("   ", testTokenPath);
    const t = getCsrfToken();
    expect(t).not.toBe("");
    expect(t.trim().length).toBeGreaterThan(16);
  });

  test("regenerates on empty string", () => {
    writeTokenFile("", testTokenPath);
    const t = getCsrfToken();
    expect(t.length).toBeGreaterThan(16);
  });
});
