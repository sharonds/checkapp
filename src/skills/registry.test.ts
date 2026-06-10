import { test, expect, describe } from "bun:test";
import { SkillRegistry } from "./registry.ts";
import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

function mockSkill(id: string, verdict: "pass" | "warn" | "fail"): Skill {
  return {
    id,
    name: id,
    async run(): Promise<SkillResult> {
      return { skillId: id, name: id, score: 80, verdict, summary: "ok", findings: [], costUsd: 0 };
    },
  };
}

const baseConfig: Config = {
  copyscapeUser: "u",
  copyscapeKey: "k",
  skills: { plagiarism: true, aiDetection: true, seo: true, factCheck: false, tone: false, legal: false, summary: false, brief: false },
};

describe("SkillRegistry", () => {
  test("runs all registered skills in parallel and returns results", async () => {
    const registry = new SkillRegistry([mockSkill("a", "pass"), mockSkill("b", "warn")]);
    const results = await registry.runAll("some text", baseConfig);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.skillId).sort()).toEqual(["a", "b"]);
  });

  test("catches individual skill failures and marks them with error", async () => {
    const broken: Skill = {
      id: "broken",
      name: "Broken",
      async run() { throw new Error("API down"); },
    };
    const registry = new SkillRegistry([broken]);
    const results = await registry.runAll("text", baseConfig);
    expect(results[0].error).toContain("API down");
    expect(results[0].verdict).toBe("fail");
  });

  test("redacts provider secrets from caught skill errors", async () => {
    const broken: Skill = {
      id: "broken",
      name: "Broken",
      async run() { throw new Error("Bearer sk-live-secret-123 failed with api_key=abc123"); },
    };
    const registry = new SkillRegistry([broken]);
    const results = await registry.runAll("text", baseConfig);
    expect(results[0].error).not.toContain("sk-live-secret-123");
    expect(results[0].error).not.toContain("abc123");
    expect(results[0].error).toContain("[redacted]");
  });

  test("sanitizes finding source URLs before returning registry results", async () => {
    const noisy: Skill = {
      id: "noisy",
      name: "Noisy",
      async run(): Promise<SkillResult> {
        return {
          skillId: "noisy",
          name: "Noisy",
          score: 0,
          verdict: "fail",
          summary: "bad source",
          findings: [{
            severity: "error",
            text: "bad",
            sources: [
              { url: "javascript:alert(1)" },
              { url: "https://user:secret@example.com/path?api_key=abc&utm_source=x" },
            ],
          }],
          costUsd: 0,
        };
      },
    };
    const registry = new SkillRegistry([noisy]);
    const results = await registry.runAll("text", baseConfig);
    expect(results[0].findings[0].sources).toEqual([
      { url: "https://example.com/path?api_key=%5Bredacted%5D&utm_source=x" },
    ]);
  });

  test("totalCost sums all skill costs", async () => {
    const expensive: Skill = {
      id: "x",
      name: "x",
      async run(): Promise<SkillResult> {
        return { skillId: "x", name: "x", score: 100, verdict: "pass", summary: "", findings: [], costUsd: 0.09 };
      },
    };
    const registry = new SkillRegistry([expensive, mockSkill("cheap", "pass")]);
    const results = await registry.runAll("text", baseConfig);
    const total = results.reduce((s, r) => s + r.costUsd, 0);
    expect(total).toBeCloseTo(0.09);
  });
});
