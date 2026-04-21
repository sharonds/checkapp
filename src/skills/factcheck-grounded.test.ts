import { describe, expect, test } from "bun:test";
import type { Config } from "../config.ts";
import { jsonResponse, mockFetch, urlRouter } from "../testing/mock-fetch.ts";
import { FactCheckGroundedSkill } from "./factcheck-grounded.ts";

describe("FactCheckGroundedSkill", () => {
  const baseConfig: Config = {
    copyscapeUser: "",
    copyscapeKey: "",
    geminiApiKey: "gemini-key",
    minimaxApiKey: "minimax-key",
    skills: {
      plagiarism: false,
      aiDetection: false,
      seo: false,
      factCheck: true,
      tone: false,
      legal: false,
      summary: false,
      brief: false,
      purpose: false,
    },
    providers: {
      "fact-check": { provider: "gemini-grounded" },
    },
  };

  test("skips when provider is not gemini-grounded or Gemini key is missing", async () => {
    const skill = new FactCheckGroundedSkill();

    const mismatch = await skill.run("claim", {
      ...baseConfig,
      providers: { "fact-check": { provider: "exa-search", apiKey: "exa-key" } },
    });
    expect(mismatch.verdict).toBe("skipped");
    expect(mismatch.summary).toMatch(/exa-search.*not implemented/i);

    const missingKey = await skill.run("claim", {
      ...baseConfig,
      geminiApiKey: undefined,
      providers: { "fact-check": { provider: "gemini-grounded" } },
    });
    expect(missingKey.verdict).toBe("skipped");
    expect(missingKey.summary).toMatch(/API key missing/i);
  });

  test("parses grounded response text and groundingMetadata into findings", async () => {
    let minimaxCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => {
        minimaxCalls++;
        return jsonResponse({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "MiniMax-M2.7",
          content: [{
            type: "text",
            text: JSON.stringify([
              "The Netherlands banned indoor smoking in workplaces and hospitality venues in 2008.",
            ]),
          }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        });
      },
      "generativelanguage.googleapis.com": async () => jsonResponse({
        candidates: [{
          content: {
            parts: [
              { thought: true, text: "private chain of thought" },
              { text: "Grounded assessment:\n```json\n{\"supported\":true,\"note\":\"Current government and public health sources confirm the timeline.\"}\n```" },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ["netherlands indoor smoking ban 2008"],
            groundingChunks: [
              { web: { uri: "https://www.government.nl/topics/smoking", title: "Government.nl Smoking Policy" } },
              { web: { uri: "https://www.who.int/europe/news-room/fact-sheets/item/tobacco", title: "WHO Europe Tobacco" } },
            ],
            groundingSupports: [
              { groundingChunkIndices: [0], segment: { text: "The smoking ban came into force in 2008." } },
              { groundingChunkIndices: [1], segment: { text: "Smoke-free hospitality laws were expanded in 2008." } },
            ],
          },
        }],
      }),
    }));

    const result = await new FactCheckGroundedSkill().run("Smoking laws changed in 2008.", baseConfig);

    expect(minimaxCalls).toBe(1);
    expect(result.provider).toBe("gemini-grounded");
    expect(result.verdict).toBe("pass");
    expect(result.summary).toContain("1 claims checked");
    expect(result.findings).toHaveLength(1);

    const finding = result.findings[0];
    expect(finding.severity).toBe("info");
    expect(finding.text).toContain("Verified");
    expect(finding.text).toContain("Search: netherlands indoor smoking ban 2008");
    expect(finding.confidence).toBe("medium");
    expect(finding.sources?.map((source) => source.url)).toEqual([
      "https://www.government.nl/topics/smoking",
      "https://www.who.int/europe/news-room/fact-sheets/item/tobacco",
    ]);
    expect(finding.sources?.[0]?.quote).toContain("2008");
    expect(finding.sources?.[0]?.title).toContain("Government.nl");
    expect(result.costUsd).toBeGreaterThan(0.01);
  });
});
