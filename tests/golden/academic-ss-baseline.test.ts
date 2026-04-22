import { describe, test, expect } from "bun:test";
import { AcademicSkill } from "../../src/skills/academic.ts";
import { mockFetch, urlRouter, jsonResponse } from "../../src/testing/mock-fetch.ts";
import type { Config } from "../../src/config.ts";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";

const config: Config = {
  copyscapeUser: "", copyscapeKey: "",
  providers: { academic: { provider: "semantic-scholar", apiKey: "ss-key" } },
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
    academic: true,
  },
};

const fixturePath = join(import.meta.dir, "academic-ss-baseline.json");
const sampleText = "Vitamin D reduces the risk of acute respiratory infections. A 2017 meta-analysis in BMJ confirmed this.";

describe("academic skill — SS path regression", () => {
  test("output shape matches captured baseline when using SS", async () => {
    mockFetch(urlRouter({
      "api.semanticscholar.org": async () => jsonResponse({
        data: [{
          paperId: "S-fixed",
          title: "Vitamin D supplementation",
          year: 2017,
          authors: [{ name: "Martineau AR" }],
          externalIds: { DOI: "10.1136/bmj.i6583" },
          url: "https://www.bmj.com/content/356/bmj.i6583",
        }],
      }),
    }));

    const skill = new AcademicSkill();
    const result = await skill.enrich(sampleText, config, []);

    const canonical = JSON.stringify({
      skillId: result.skillId,
      name: result.name,
      verdict: result.verdict,
      findings: result.findings.map((f) => ({
        text: f.text,
        claimType: f.claimType,
        citations: f.citations ?? [],
      })),
    }, null, 2);

    if (!existsSync(fixturePath)) {
      if (process.env.UPDATE_GOLDEN === "1") {
        writeFileSync(fixturePath, canonical);
        console.log(`Wrote initial baseline → ${fixturePath}. Re-run to compare.`);
        return;
      }
      throw new Error(
        `Missing golden fixture: ${fixturePath}. ` +
        `Run with UPDATE_GOLDEN=1 to generate, then commit the file.`
      );
    }
    const baseline = readFileSync(fixturePath, "utf8");
    expect(canonical).toBe(baseline);
  });
});
