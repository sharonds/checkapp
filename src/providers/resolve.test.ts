import { describe, test, expect } from "bun:test";
import { resolveProvider } from "./resolve.ts";
import type { Config } from "../config.ts";

const base: Config = {
  copyscapeUser: "", copyscapeKey: "",
  skills: {
    plagiarism: true, aiDetection: true, seo: true,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

describe("resolveProvider", () => {
  test("reads providers[skillId] first", () => {
    const r = resolveProvider(
      { ...base, providers: { "fact-check": { provider: "exa-deep-reasoning", apiKey: "k-new" } } } as Config,
      "fact-check"
    );
    expect(r?.provider).toBe("exa-deep-reasoning");
    expect(r?.apiKey).toBe("k-new");
  });

  test("falls back to legacy flat exaApiKey when providers[fact-check] missing", () => {
    const r = resolveProvider({ ...base, exaApiKey: "k-legacy" }, "fact-check");
    expect(r?.provider).toBe("exa-search");
    expect(r?.apiKey).toBe("k-legacy");
  });

  test("falls back to legacy copyscapeKey for plagiarism", () => {
    const r = resolveProvider({ ...base, copyscapeKey: "cs-legacy" }, "plagiarism");
    expect(r?.provider).toBe("copyscape");
    expect(r?.apiKey).toBe("cs-legacy");
  });

  test("returns null when nothing configured for fact-check", () => {
    expect(resolveProvider(base, "fact-check")).toBeNull();
  });

  test("returns null for skills with no legacy fallback when not in providers", () => {
    expect(resolveProvider(base, "grammar")).toBeNull();
    expect(resolveProvider(base, "academic")).toBeNull();
  });

  test("preserves undefined apiKey when explicit provider has no key", () => {
    const r = resolveProvider(
      { ...base, providers: { "fact-check": { provider: "exa-search" } } } as Config,
      "fact-check",
    );
    expect(r?.provider).toBe("exa-search");
    expect(r?.apiKey).toBeUndefined();
  });

  test("treats empty-string legacy copyscapeKey as missing (returns null)", () => {
    expect(resolveProvider({ ...base, copyscapeKey: "" }, "plagiarism")).toBeNull();
  });

  test("metadata is undefined when provider id is not in registry", () => {
    const r = resolveProvider(
      { ...base, providers: { "fact-check": { provider: "nonexistent" as never, apiKey: "k" } } } as Config,
      "fact-check",
    );
    expect(r?.provider).toBe("nonexistent");
    expect(r?.apiKey).toBe("k");
    expect(r?.metadata).toBeUndefined();
  });
});
