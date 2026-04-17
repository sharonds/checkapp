import { describe, expect, it, beforeEach } from "bun:test";
import { resolveDeepFactCheckEnv, summarizeFixRun } from "./index.tsx";
import type { Finding } from "./skills/types.ts";

describe("resolveDeepFactCheckEnv", () => {
  it("accepts --deep-fact-check with EXA_API_KEY env var even without config file", () => {
    const result = resolveDeepFactCheckEnv({ configExists: () => false, env: { EXA_API_KEY: "exa-test" } });
    expect(result.allowed).toBe(true);
    expect(result.apiKey).toBe("exa-test");
  });

  it("rejects --deep-fact-check when no env key and no config", () => {
    const result = resolveDeepFactCheckEnv({ configExists: () => false, env: {} });
    expect(result.allowed).toBe(false);
  });
});

describe("summarizeFixRun", () => {
  it("does not say 'clean' when unfixable warn/error findings remain", () => {
    const summary = summarizeFixRun({
      fixable: [],
      remaining: [{ severity: "warn", text: "Purpose unclear" } as Finding],
    });
    expect(summary).not.toMatch(/clean/i);
    expect(summary).toMatch(/1 warning/i);
  });
});
