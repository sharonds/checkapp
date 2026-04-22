import { describe, expect, it, test } from "bun:test";
import { readConfig } from "./config.ts";

describe("readConfig", () => {
  it("DEFAULT_SKILLS lists grammar, academic, and selfPlagiarism (disabled by default)", () => {
    const cfg = readConfig();
    expect(cfg.skills).toHaveProperty("grammar", false);
    expect(cfg.skills).toHaveProperty("academic", false);
    expect(cfg.skills).toHaveProperty("selfPlagiarism", false);
  });

  test("loads OPENALEX_MAILTO from env", () => {
    const saved = process.env.OPENALEX_MAILTO;
    process.env.OPENALEX_MAILTO = "research@example.com";
    try {
      const config = readConfig();
      expect(config.openalexMailto).toBe("research@example.com");
    } finally {
      if (saved === undefined) delete process.env.OPENALEX_MAILTO;
      else process.env.OPENALEX_MAILTO = saved;
    }
  });

  test("openalexMailto is undefined when env unset", () => {
    const saved = process.env.OPENALEX_MAILTO;
    delete process.env.OPENALEX_MAILTO;
    try {
      const config = readConfig();
      expect(config.openalexMailto).toBeUndefined();
    } finally {
      if (saved !== undefined) process.env.OPENALEX_MAILTO = saved;
    }
  });
});
