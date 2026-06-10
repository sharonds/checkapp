import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const tempDir = mkdtempSync(join(tmpdir(), "checkapp-grounded-events-"));
    process.env.CHECKAPP_AUDIT_EVENTS_PATH = join(tempDir, "audit-events.jsonl");
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
              { web: { uri: "javascript:alert(1)", title: "Unsafe" } },
            ],
            groundingSupports: [
              { groundingChunkIndices: [0], segment: { text: "The smoking ban came into force in 2008." } },
              { groundingChunkIndices: [1], segment: { text: "Smoke-free hospitality laws were expanded in 2008." } },
              { groundingChunkIndices: [2], segment: { text: "Unsafe URL must be ignored." } },
            ],
          },
        }],
        usageMetadata: {
          promptTokenCount: 111,
          candidatesTokenCount: 22,
          totalTokenCount: 133,
        },
      }),
    }));

    try {
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
      expect(finding.quote).toBe("Smoking laws changed in 2008.");
      expect(finding.location?.paragraphIndex).toBe(0);
      expect(finding.auditRef?.claimId).toBe("claim-1");
      expect(finding.searchQueries).toContain("netherlands indoor smoking ban 2008");
      expect((result as any).audit.factAssessments[0].provider).toBe("gemini-grounded");
      expect((result as any).audit.claims[0].direction).toBe("ltr");
      expect(result.costUsd).toBeGreaterThan(0.01);

      const lines = readFileSync(process.env.CHECKAPP_AUDIT_EVENTS_PATH!, "utf-8").trim().split("\n");
      const groundedEvent = lines
        .map((line) => JSON.parse(line))
        .find((entry) => entry.event === "grounded.call");

      expect(groundedEvent).toBeDefined();
      expect(groundedEvent.payload).toMatchObject({
        provider: "gemini-grounded",
        model: "gemini-3-pro-preview",
        httpStatus: 200,
        costUsd: 0.04,
        inputTokens: 111,
        outputTokens: 22,
        totalTokens: 133,
      });
      expect(typeof groundedEvent.payload.latencyMs).toBe("number");
    } finally {
      delete process.env.CHECKAPP_AUDIT_EVENTS_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("redacts grounded provider network errors before writing audit telemetry", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "checkapp-grounded-error-events-"));
    process.env.CHECKAPP_AUDIT_EVENTS_PATH = join(tempDir, "audit-events.jsonl");
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_grounded_error",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{ type: "text", text: JSON.stringify(["The claim needs checking."]) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        throw new Error("request failed https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=gemini-key token=abc123");
      },
    }));

    try {
      await expect(new FactCheckGroundedSkill().run("The claim needs checking.", baseConfig)).rejects.toThrow("request failed");
      const body = readFileSync(process.env.CHECKAPP_AUDIT_EVENTS_PATH!, "utf-8");
      expect(body).not.toContain("gemini-key");
      expect(body).not.toContain("abc123");
      expect(body).toContain("[redacted]");
    } finally {
      delete process.env.CHECKAPP_AUDIT_EVENTS_PATH;
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("standard tier uses Gemini grounded even when saved fact-check provider is Exa", async () => {
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_grounded",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["OpenAI announced GPT-4 in March 2023."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => jsonResponse({
        candidates: [{
          content: {
            parts: [
              { text: "{\"supported\":true,\"note\":\"Grounded sources support the claim.\"}" },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ["OpenAI GPT-4 March 2023"],
            groundingChunks: [
              { web: { uri: "https://openai.com/index/gpt-4-research/", title: "GPT-4 research" } },
            ],
          },
        }],
      }),
    }));

    const result = await new FactCheckGroundedSkill().run("OpenAI announced GPT-4 in March 2023.", {
      ...baseConfig,
      factCheckTierFlag: true,
      factCheckTier: "standard",
      providers: { "fact-check": { provider: "exa-search", apiKey: "exa-key" } },
    });

    expect(result.provider).toBe("gemini-grounded");
    expect(result.verdict).toBe("pass");
    expect(result.summary).toContain("via gemini-grounded");
  });

  test("uses factAudit.standardMaxClaims and records claim-cap skips", async () => {
    let assessmentCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_many",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["Claim one.", "Claim two.", "Claim three.", "Claim four.", "Claim five."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        assessmentCalls++;
        return jsonResponse({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ supported: true, note: "Grounded sources support the claim." }) }] },
            groundingMetadata: {
              webSearchQueries: [`claim ${assessmentCalls}`],
              groundingChunks: [{ web: { uri: `https://example.com/${assessmentCalls}`, title: `Source ${assessmentCalls}` } }],
            },
          }],
        });
      },
    }));

    const result = await new FactCheckGroundedSkill().run(
      "Claim one. Claim two. Claim three. Claim four. Claim five.",
      { ...baseConfig, factAudit: { standardMaxClaims: 2 } },
    );

    expect(assessmentCalls).toBe(2);
    expect((result as any).audit.coverage.claimsExtracted).toBe(5);
    expect((result as any).audit.coverage.claimsChecked).toBe(2);
    expect((result as any).audit.coverage.claimsSkipped).toBe(3);
    expect((result as any).audit.coverage.skipReasons.claim_cap).toBe(3);
    expect((result as any).audit.coverage.budgetStopReason).toBe("claim_cap");
  });

  test("stops grounded fact-check execution when the configured cost budget is reached", async () => {
    let assessmentCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_cost_budget",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["Claim one.", "Claim two.", "Claim three."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        assessmentCalls++;
        return jsonResponse({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ supported: true, note: "Grounded sources support the claim." }) }] },
            groundingMetadata: {
              webSearchQueries: [`budget claim ${assessmentCalls}`],
              groundingChunks: [{ web: { uri: `https://example.com/budget-${assessmentCalls}`, title: `Source ${assessmentCalls}` } }],
            },
          }],
        });
      },
    }));

    const result = await new FactCheckGroundedSkill().run(
      "Claim one. Claim two. Claim three.",
      { ...baseConfig, factAudit: { standardMaxClaims: 3, maxUsd: 0.04 } },
    );

    expect(assessmentCalls).toBe(1);
    expect((result as any).audit.coverage.claimsChecked).toBe(1);
    expect((result as any).audit.coverage.claimsSkipped).toBe(2);
    expect((result as any).audit.coverage.skipReasons.cost_budget).toBe(2);
    expect((result as any).audit.coverage.budgetStopReason).toBe("cost_budget");
  });

  test("records Gemini retries in structured audit coverage", async () => {
    let assessmentCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_retry",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["Claim one."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        assessmentCalls++;
        if (assessmentCalls === 1) return new Response("temporary", { status: 503 });
        return jsonResponse({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ supported: true, note: "Grounded sources support the claim." }) }] },
            groundingMetadata: {
              webSearchQueries: ["claim one"],
              groundingChunks: [{ web: { uri: "https://example.com/claim", title: "Source" } }],
            },
          }],
        });
      },
    }));

    const result = await new FactCheckGroundedSkill().run("Claim one.", baseConfig);

    expect(assessmentCalls).toBe(2);
    expect((result as any).audit.providerAttempts.map((attempt: any) => attempt.status)).toEqual(["retry", "success"]);
    expect((result as any).audit.coverage.providerRetries).toBe(1);
    expect((result as any).audit.coverage.providerFailures).toBe(0);
    expect((result as any).audit.factAssessments[0].attemptIds).toEqual(["attempt-1", "attempt-2"]);
  });

  test("does not retry Gemini 503 responses when maxProviderRetries is zero", async () => {
    let assessmentCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_no_retry",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["Claim one."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        assessmentCalls++;
        if (assessmentCalls === 1) return new Response("temporary", { status: 503 });
        return jsonResponse({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ supported: true, note: "Grounded sources support the claim." }) }] },
            groundingMetadata: {
              webSearchQueries: ["claim one"],
              groundingChunks: [{ web: { uri: "https://example.com/claim", title: "Source" } }],
            },
          }],
        });
      },
    }));

    await expect(new FactCheckGroundedSkill().run(
      "Claim one.",
      { ...baseConfig, factAudit: { maxProviderRetries: 0 } },
    )).rejects.toThrow("Gemini grounded error: HTTP 503");

    expect(assessmentCalls).toBe(1);
  });

  test("warns instead of passing when a budget skips every grounded claim", async () => {
    let assessmentCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_zero_budget",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["Claim one.", "Claim two."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        assessmentCalls++;
        return jsonResponse({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({ supported: true, note: "Grounded sources support the claim." }) }] },
            groundingMetadata: {
              webSearchQueries: [`claim ${assessmentCalls}`],
              groundingChunks: [{ web: { uri: `https://example.com/${assessmentCalls}`, title: `Source ${assessmentCalls}` } }],
            },
          }],
        });
      },
    }));

    const result = await new FactCheckGroundedSkill().run(
      "Claim one. Claim two.",
      { ...baseConfig, factAudit: { standardMaxClaims: 2, maxUsd: 0 } },
    );

    expect(assessmentCalls).toBe(0);
    expect(result.verdict).toBe("warn");
    expect(result.score).toBeLessThan(100);
    expect(result.summary).toContain("0 claims checked");
    expect((result as any).audit.coverage.claimsChecked).toBe(0);
    expect((result as any).audit.coverage.claimsSkipped).toBe(2);
  });

  test("uses Hebrew rewrite text for mixed Hebrew-English claims", async () => {
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_he",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["המשחק Rummikub מתאים לשני שחקנים בלבד."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => jsonResponse({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({ supported: false, note: "המקור הרשמי מציין יותר שחקנים." }) }] },
          groundingMetadata: {
            webSearchQueries: ["Rummikub מספר שחקנים"],
            groundingChunks: [{ web: { uri: "https://example.com/rummikub", title: "Rummikub" } }],
          },
        }],
      }),
    }));

    const result = await new FactCheckGroundedSkill().run("המשחק Rummikub מתאים לשני שחקנים בלבד.", baseConfig);

    expect(result.findings[0].rewrite).toContain("יש לנסח מחדש");
    expect((result as any).audit.factAssessments[0].rewrite).toContain("יש לנסח מחדש");
    expect((result as any).audit.claims[0].language).toBe("he");
  });

  test("uses provider-scoped Gemini key for both grounding and claim extraction", async () => {
    let sawGeminiRequest = false;
    mockFetch(urlRouter({
      "generativelanguage.googleapis.com": async (req) => {
        sawGeminiRequest = true;
        expect(req.url).toContain("provider-gemini-key");
        const body = await req.json() as any;
        const prompt = body.contents?.[0]?.parts?.[0]?.text ?? "";
        if (prompt.includes("Extract up to 20")) {
          return jsonResponse({
            candidates: [{
              content: {
                parts: [
                  { text: JSON.stringify(["OpenAI announced GPT-4 in March 2023."]) },
                ],
              },
            }],
          });
        }
        return jsonResponse({
          candidates: [{
            content: {
              parts: [
                { text: JSON.stringify({ supported: true, note: "Grounded sources support the claim." }) },
              ],
            },
            groundingMetadata: {
              webSearchQueries: ["OpenAI GPT-4 March 2023"],
              groundingChunks: [
                { web: { uri: "https://openai.com/index/gpt-4-research/", title: "GPT-4 research" } },
              ],
            },
          }],
        });
      },
    }));

    const result = await new FactCheckGroundedSkill().run("OpenAI announced GPT-4 in March 2023.", {
      ...baseConfig,
      geminiApiKey: undefined,
      minimaxApiKey: undefined,
      providers: { "fact-check": { provider: "gemini-grounded", apiKey: "provider-gemini-key" } },
    });

    expect(sawGeminiRequest).toBe(true);
    expect(result.provider).toBe("gemini-grounded");
    expect(result.verdict).toBe("pass");
  });

  test("downgrades supported=true to unverified when no grounded source URL is returned", async () => {
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_grounded",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(["A source-free claim is verified."]),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => jsonResponse({
        candidates: [{
          content: {
            parts: [
              { text: "{\"supported\":true,\"note\":\"The model says yes but provides no source.\"}" },
            ],
          },
          groundingMetadata: {
            webSearchQueries: ["source-free claim"],
            groundingChunks: [],
          },
        }],
      }),
    }));

    const result = await new FactCheckGroundedSkill().run("A source-free claim is verified.", baseConfig);

    expect(result.verdict).toBe("pass");
    expect(result.findings[0].severity).toBe("warn");
    expect(result.findings[0].text).toContain("No grounded source URL was returned");
    expect(result.findings[0].rewrite).toContain("The model says yes but provides no source.");
    expect((result as any).audit.factAssessments[0].rewrite).toContain("The model says yes but provides no source.");
  });
});
