import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { PlagiarismSkill } from "./plagiarism.ts";
import type { Config } from "../config.ts";

const config: Config = {
  copyscapeUser: "user",
  copyscapeKey: "key",
  skills: {
    plagiarism: true, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

test("PlagiarismSkill has correct id and name", () => {
  const skill = new PlagiarismSkill();
  expect(skill.id).toBe("plagiarism");
  expect(skill.name).toBe("Plagiarism Check");
});

describe("PlagiarismSkill Copyscape results", () => {
  let originalFetch: typeof globalThis.fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test("marks insufficient Copyscape credits as skipped, not pass", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>Insufficient credits.</error>",
    } as Response);

    const result = await new PlagiarismSkill().run("Article text", config);

    expect(result.verdict).toBe("skipped");
    expect(result.score).toBe(0);
    expect(result.costUsd).toBe(0);
    expect(result.provider).toBe("copyscape");
    expect(result.summary).toMatch(/credits insufficient/i);
    expect(result.error).toBeUndefined();
  });

  test("records Copyscape as the provider on successful plagiarism checks", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<count>0</count><querywords>250</querywords>",
    } as Response);

    const result = await new PlagiarismSkill().run("Article text", config);

    expect(result.verdict).toBe("pass");
    expect(result.score).toBe(100);
    expect(result.provider).toBe("copyscape");
    expect(result.summary).toBe("0% similarity — 0 sources matched");
  });
});
