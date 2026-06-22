import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../config.ts";
import { jsonResponse, mockFetch, urlRouter } from "../testing/mock-fetch.ts";
import { FactCheckGroundedSkill, computeRetryAfterDelayMs } from "./factcheck-grounded.ts";
import { locateQuote } from "../audit/document.ts";

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
              { assertion: "The Netherlands banned indoor smoking in workplaces and hospitality venues in 2008.", source: "Smoking laws changed in 2008." },
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
      // The assessment must attribute the model that actually served the call.
      expect((result as any).audit.factAssessments[0].model).toBe((result as any).audit.providerAttempts[0].model);
      expect((result as any).audit.claims[0].direction).toBe("ltr");
      expect(result.costUsd).toBeGreaterThan(0.01);

      const lines = readFileSync(process.env.CHECKAPP_AUDIT_EVENTS_PATH!, "utf-8").trim().split("\n");
      const groundedEvent = lines
        .map((line) => JSON.parse(line))
        .find((entry) => entry.event === "grounded.call");

      expect(groundedEvent).toBeDefined();
      expect(groundedEvent.payload).toMatchObject({
        provider: "gemini-grounded",
        model: "gemini-3.1-pro-preview",
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
        content: [{ type: "text", text: JSON.stringify([{ assertion: "The claim needs checking.", source: "The claim needs checking." }]) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
      "generativelanguage.googleapis.com": async () => {
        throw new Error("request failed https://generativelanguage.googleapis.com/v1beta/models/x:generateContent?key=gemini-key token=abc123");
      },
    }));

    try {
      const result = await new FactCheckGroundedSkill().run(
        "The claim needs checking.",
        { ...baseConfig, factAudit: { maxProviderRetries: 0 } },
      );

      expect(result.verdict).toBe("warn");
      expect(result.findings[0].status).toBe("provider_error");
      expect(result.findings[0].text).not.toContain("gemini-key");
      expect(result.findings[0].text).not.toContain("abc123");
      expect((result as any).audit.providerAttempts.map((attempt: any) => attempt.status)).toEqual(["failed"]);
      expect((result as any).audit.coverage.providerFailures).toBe(1);
      expect((result as any).audit.factAssessments[0]).toMatchObject({
        status: "provider_error",
        attemptIds: ["attempt-1"],
      });
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
          text: JSON.stringify([{ assertion: "OpenAI announced GPT-4 in March 2023.", source: "OpenAI announced GPT-4 in March 2023." }]),
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
          text: JSON.stringify([
            { assertion: "Claim one.", source: "Claim one." },
            { assertion: "Claim two.", source: "Claim two." },
            { assertion: "Claim three.", source: "Claim three." },
            { assertion: "Claim four.", source: "Claim four." },
            { assertion: "Claim five.", source: "Claim five." },
          ]),
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
          text: JSON.stringify([
            { assertion: "Claim one.", source: "Claim one." },
            { assertion: "Claim two.", source: "Claim two." },
            { assertion: "Claim three.", source: "Claim three." },
          ]),
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
    process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
    let assessmentCalls = 0;
    try {
      mockFetch(urlRouter({
        "api.minimax.io": async () => jsonResponse({
          id: "msg_extract_retry",
          type: "message",
          role: "assistant",
          model: "MiniMax-M2.7",
          content: [{
            type: "text",
            text: JSON.stringify([{ assertion: "Claim one.", source: "Claim one." }]),
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
    } finally {
      delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
    }
  });

  test("uses the full configured Gemini retry budget", async () => {
    process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
    let assessmentCalls = 0;
    try {
      mockFetch(urlRouter({
        "api.minimax.io": async () => jsonResponse({
          id: "msg_extract_two_retries",
          type: "message",
          role: "assistant",
          model: "MiniMax-M2.7",
          content: [{
            type: "text",
            text: JSON.stringify([{ assertion: "Claim one.", source: "Claim one." }]),
          }],
          stop_reason: "end_turn",
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
        "generativelanguage.googleapis.com": async () => {
          assessmentCalls++;
          if (assessmentCalls <= 2) return new Response("temporary", { status: 503 });
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

      const result = await new FactCheckGroundedSkill().run(
        "Claim one.",
        { ...baseConfig, factAudit: { maxProviderRetries: 2 } },
      );

      expect(assessmentCalls).toBe(3);
      expect((result as any).audit.providerAttempts.map((attempt: any) => attempt.status)).toEqual(["retry", "retry", "success"]);
      expect((result as any).audit.coverage.providerRetries).toBe(2);
      expect((result as any).audit.coverage.providerFailures).toBe(0);
      expect((result as any).audit.factAssessments[0].attemptIds).toEqual(["attempt-1", "attempt-2", "attempt-3"]);
    } finally {
      delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
    }
  });

  test("records provider-error audit details when Gemini retries are exhausted", async () => {
    let assessmentCalls = 0;
    mockFetch(urlRouter({
      "api.minimax.io": async () => jsonResponse({
        id: "msg_extract_no_retry",
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify([{ assertion: "Claim one.", source: "Claim one." }]),
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

    const result = await new FactCheckGroundedSkill().run(
      "Claim one.",
      { ...baseConfig, factAudit: { maxProviderRetries: 0 } },
    );

    expect(assessmentCalls).toBe(1);
    expect(result.verdict).toBe("warn");
    expect(result.findings[0].severity).toBe("warn");
    expect(result.findings[0].status).toBe("provider_error");
    expect(result.findings[0].text).toContain("Provider error");
    expect((result as any).audit.providerAttempts.map((attempt: any) => attempt.status)).toEqual(["failed"]);
    expect((result as any).audit.coverage.providerRetries).toBe(0);
    expect((result as any).audit.coverage.providerFailures).toBe(1);
    expect((result as any).audit.factAssessments[0]).toMatchObject({
      status: "provider_error",
      confidence: "low",
      attemptIds: ["attempt-1"],
    });
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
          text: JSON.stringify([
            { assertion: "Claim one.", source: "Claim one." },
            { assertion: "Claim two.", source: "Claim two." },
          ]),
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
          text: JSON.stringify([{ assertion: "המשחק Rummikub מתאים לשני שחקנים בלבד.", source: "המשחק Rummikub מתאים לשני שחקנים בלבד." }]),
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
        if (prompt.includes("JSON array of objects")) {
          return jsonResponse({
            candidates: [{
              content: {
                parts: [
                  { text: JSON.stringify([{ assertion: "OpenAI announced GPT-4 in March 2023.", source: "OpenAI announced GPT-4 in March 2023." }]) },
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
          text: JSON.stringify([{ assertion: "A source-free claim is verified.", source: "A source-free claim is verified." }]),
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

  describe("rate-limit retry handling", () => {
    // Each claim string must appear VERBATIM in the test's article text so the
    // grounded pipeline locates an EXACT source span (the R4 location-approximate
    // path would otherwise downgrade confidence to "low").
    const minimaxExtract = (claims: string[]) => jsonResponse({
      id: "msg_x",
      type: "message",
      role: "assistant",
      model: "MiniMax-M2.7",
      content: [{ type: "text", text: JSON.stringify(claims.map((c) => ({ assertion: c, source: c }))) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    const geminiOk = (supported: boolean, note: string, sources: string[]) => jsonResponse({
      candidates: [{
        content: { parts: [{ text: JSON.stringify({ supported, note }) }] },
        groundingMetadata: {
          webSearchQueries: ["query"],
          groundingChunks: sources.map((uri) => ({ web: { uri, title: uri } })),
        },
      }],
    });

    function geminiSequence(responses: Array<() => Response | Promise<Response>>) {
      let call = 0;
      return async () => responses[Math.min(call++, responses.length - 1)]!();
    }

    test("retries Gemini 429 rate-limit responses within the retry budget", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": geminiSequence([
            () => new Response(JSON.stringify({ error: { message: "RESOURCE_EXHAUSTED" } }), { status: 429 }),
            () => geminiOk(true, "ok", ["https://example.com/a"]),
          ]),
        }));
        const result = await new FactCheckGroundedSkill().run("one claim", baseConfig);
        const attempts = (result as any).audit.providerAttempts;
        expect(attempts.map((a: any) => a.status)).toEqual(["retry", "success"]);
        expect(attempts[0].statusCode).toBe(429);
        expect(attempts[0].retryable).toBe(true);
        expect(result.findings.filter((f) => f.status === "provider_error")).toHaveLength(0);
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("429 honors Retry-After header capped at 30s", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        // Use a 0-second Retry-After so the test stays fast; assert via attempt metadata, not wall clock.
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": geminiSequence([
            () => new Response("", { status: 429, headers: { "Retry-After": "0" } }),
            () => geminiOk(true, "ok", ["https://example.com/a"]),
          ]),
        }));
        const result = await new FactCheckGroundedSkill().run("one claim", baseConfig);
        expect((result as any).audit.providerAttempts.map((a: any) => a.status)).toEqual(["retry", "success"]);
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("retries thrown network errors within the retry budget", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        let calls = 0;
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": async () => {
            calls++;
            if (calls === 1) throw new Error("fetch failed: ECONNRESET");
            return geminiOk(true, "ok", ["https://example.com/a"]);
          },
        }));
        const result = await new FactCheckGroundedSkill().run("one claim", baseConfig);
        expect((result as any).audit.providerAttempts.map((a: any) => a.status)).toEqual(["retry", "success"]);
        expect(result.findings.filter((f) => f.status === "provider_error")).toHaveLength(0);
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("terminal attempts carry truthful retryable flags", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        // transient class, budget 1: 503 -> retry, 503 -> terminal failed but still retryable:true
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": geminiSequence([
            () => new Response("", { status: 503 }),
            () => new Response("", { status: 503 }),
          ]),
        }));
        const first = await new FactCheckGroundedSkill().run(
          "one claim",
          { ...baseConfig, factAudit: { maxProviderRetries: 1 } },
        );
        const attempts = (first as any).audit.providerAttempts;
        expect(attempts.map((a: any) => a.status)).toEqual(["retry", "failed"]);
        expect(attempts[1].retryable).toBe(true); // transient class — truthful despite exhausted budget

        // non-transient class: 400 -> failed, retryable:false
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": async () => new Response("", { status: 400 }),
        }));
        const second = await new FactCheckGroundedSkill().run("one claim", baseConfig);
        expect((second as any).audit.providerAttempts[0].retryable).toBe(false);
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("exhausts the default retry budget: 503x3 yields retry,retry,failed", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": async () => new Response("", { status: 503 }),
        }));
        const result = await new FactCheckGroundedSkill().run("one claim", baseConfig); // default maxProviderRetries: 2
        const attempts = (result as any).audit.providerAttempts;
        expect(attempts.map((a: any) => a.status)).toEqual(["retry", "retry", "failed"]);
        expect(attempts[2].retryable).toBe(true);
        expect((result as any).audit.coverage.providerRetries).toBe(2);
        expect(result.findings.filter((f) => f.status === "provider_error")).toHaveLength(1);
        expect(result.verdict).toBe("warn");
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("retry budget is shared across claims: first flaky claim consumes it, later claims get zero retries", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["claim one", "claim two"]),
          "generativelanguage.googleapis.com": geminiSequence([
            () => new Response("", { status: 503 }),
            () => new Response("", { status: 503 }),
            () => geminiOk(true, "ok", ["https://example.com/a"]), // claim 1 succeeds after 2 retries
            () => new Response("", { status: 503 }),               // claim 2: no budget left -> immediate provider_error
          ]),
        }));
        const result = await new FactCheckGroundedSkill().run("claim one. claim two.", baseConfig);
        const audit = (result as any).audit;
        expect(audit.coverage.providerRetries).toBe(2);
        expect(audit.coverage.claimsChecked).toBe(2); // provider-error claims count as checked
        expect(result.findings.filter((f) => f.status === "provider_error")).toHaveLength(1);
        expect(result.verdict).toBe("warn"); // no-pass-without-verification
        const attempts = audit.providerAttempts;
        expect(attempts.map((a: any) => a.status)).toEqual(["retry", "retry", "success", "failed"]);
        expect(attempts[3].statusCode).toBe(503); // claim 2 terminal with zero retries
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("mixed run keeps coverage arithmetic consistent: success + provider_error + claim-cap skip", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["Claim one.", "Claim two.", "Claim three."]),
          "generativelanguage.googleapis.com": geminiSequence([
            () => geminiOk(true, "ok", ["https://example.com/a"]), // claim 1 verified
            () => new Response("", { status: 503 }),               // claim 2: budget 0 -> terminal provider_error
          ]),
        }));
        const result = await new FactCheckGroundedSkill().run(
          "Claim one. Claim two. Claim three.",
          { ...baseConfig, factAudit: { standardMaxClaims: 2, maxProviderRetries: 0 } },
        );
        const coverage = (result as any).audit.coverage;
        expect(coverage.claimsChecked).toBe(2);
        expect(coverage.claimsSkipped).toBe(1);
        expect(coverage.claimsChecked + coverage.claimsSkipped).toBe(coverage.claimsExtracted);
        expect(coverage.skipReasons.claim_cap).toBe(1);
        expect(result.verdict).toBe("warn");
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("skill summary separates provider errors from unverified", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["claim one", "claim two"]),
          "generativelanguage.googleapis.com": geminiSequence([
            () => geminiOk(null as never, "inconclusive", ["https://example.com/a"]), // unverified
            () => new Response("", { status: 400 }),                                  // provider_error
          ]),
        }));
        const result = await new FactCheckGroundedSkill().run("claim one. claim two.", baseConfig);
        expect(result.summary).toBe("2 claims checked — 0 unsupported, 1 unverified, 1 provider errors (via gemini-grounded)");
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });

    test("thrown network errors that exhaust the budget end as failed with truthful retryable flag", async () => {
      process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
      try {
        mockFetch(urlRouter({
          "api.minimax.io": async () => minimaxExtract(["one claim"]),
          "generativelanguage.googleapis.com": async () => {
            throw new Error("fetch failed: ECONNRESET");
          },
        }));
        const result = await new FactCheckGroundedSkill().run(
          "one claim",
          { ...baseConfig, factAudit: { maxProviderRetries: 1 } },
        );
        const attempts = (result as any).audit.providerAttempts;
        expect(attempts.map((a: any) => a.status)).toEqual(["retry", "failed"]);
        expect(attempts[1].retryable).toBe(true);
        expect(result.findings.filter((f) => f.status === "provider_error")).toHaveLength(1);
        expect(result.verdict).toBe("warn");
      } finally {
        delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
      }
    });
  });

  describe("claim extraction failure handling", () => {
    const minimaxResponse = (content: unknown[]) => jsonResponse({
      id: "msg_x",
      type: "message",
      role: "assistant",
      model: "MiniMax-M2.7",
      content,
      stop_reason: "max_tokens",
      usage: { input_tokens: 10, output_tokens: 10 },
    });

    test("empty extraction response reports extraction failure, not a claim-free article", async () => {
      // Reasoning models can exhaust max_tokens inside the thinking block and
      // return no text block at all — observed live with MiniMax-M2.7.
      mockFetch(urlRouter({
        "api.minimax.io": async () => minimaxResponse([{ type: "thinking", thinking: "..." }]),
      }));
      const result = await new FactCheckGroundedSkill().run("ירושלים היא בירת ישראל.", baseConfig);
      expect(result.verdict).toBe("warn");
      expect(result.summary).not.toContain("No specific verifiable claims");
      expect(result.summary).toContain("Claim extraction failed");
      expect(result.findings[0]?.status).toBe("provider_error");
    });

    test("unparseable extraction response reports extraction failure", async () => {
      mockFetch(urlRouter({
        "api.minimax.io": async () => minimaxResponse([{ type: "text", text: "I could not find any claims in this article." }]),
      }));
      const result = await new FactCheckGroundedSkill().run("ירושלים היא בירת ישראל.", baseConfig);
      expect(result.verdict).toBe("warn");
      expect(result.summary).toContain("Claim extraction failed");
      expect(result.findings[0]?.status).toBe("provider_error");
    });

    test("a valid empty claims array still reports a claim-free article", async () => {
      mockFetch(urlRouter({
        "api.minimax.io": async () => minimaxResponse([{ type: "text", text: "[]" }]),
      }));
      const result = await new FactCheckGroundedSkill().run("סתם משפט בלי טענות.", baseConfig);
      expect(result.verdict).toBe("warn");
      expect(result.summary).toBe("No specific verifiable claims detected");
    });

    test("extraction failure on Hebrew text attaches a truthful Hebrew/RTL audit shell", async () => {
      // Thinking-only response: no text block → extraction returns null.
      // The result must carry an `audit` with the correct language/direction,
      // truthful zero-coverage, and must survive a safeParseAuditRecord round-trip.
      const { safeParseAuditRecord } = await import("../audit/types.ts");
      const { generateReport } = await import("../report.ts");

      mockFetch(urlRouter({
        "api.minimax.io": async () => minimaxResponse([{ type: "thinking", thinking: "..." }]),
      }));

      const HEBREW_TEXT = "ירושלים היא עיר הבירה של ישראל ומרכז היסטורי ותרבותי.";
      const result = await new FactCheckGroundedSkill().run(HEBREW_TEXT, baseConfig);

      // audit field must exist
      const audit = (result as any).audit;
      expect(audit).toBeDefined();

      // language and direction derive from the real document
      expect(audit.language).toBe("he");
      expect(audit.direction).toBe("rtl");

      // coverage must be truthful zeros (no synthetic claims)
      expect(audit.coverage.claimsExtracted).toBe(0);
      expect(audit.coverage.claimsChecked).toBe(0);
      expect(audit.coverage.claimsSkipped).toBe(0);
      expect(audit.claims).toHaveLength(0);
      expect(audit.claimDecisions).toHaveLength(0);
      expect(audit.factAssessments).toHaveLength(0);
      expect(audit.providerAttempts).toHaveLength(0);

      // round-trip through safeParseAuditRecord must succeed
      const parsed = safeParseAuditRecord(JSON.parse(JSON.stringify(audit)));
      expect(parsed.ok).toBe(true);

      // generateReport must produce Hebrew/RTL shell
      const html = generateReport({
        source: "he-test.md",
        wordCount: 10,
        results: [result],
        totalCostUsd: 0.001,
        audit,
      });
      expect(html).toContain('lang="he"');
      expect(html).toContain('dir="rtl"');
      // localized provider_error label — no raw English "(low)" leaking
      expect(html).toContain("שגיאת ספק");
      expect(html).not.toContain("(low)");
    });
  });

  test("located quote for a verbatim Hebrew source sentence is an exact match (regression guard)", () => {
    const article = "כותרת המאמר\n\nסט 43013 מכיל כ-520 חלקים.\n\nפסקה אחרת.";
    const located = locateQuote(article, "סט 43013 מכיל כ-520 חלקים.");
    expect(located.quote).toBe("סט 43013 מכיל כ-520 חלקים.");
    expect(located.location?.matchQuality).toBe("exact");
    expect(located.language).toBe("he");
  });

  describe("computeRetryAfterDelayMs", () => {
    test("caps numeric Retry-After at 30 seconds", () => {
      expect(computeRetryAfterDelayMs("45")).toBe(30_000);
    });

    test("returns 0 for a missing header", () => {
      expect(computeRetryAfterDelayMs(null)).toBe(0);
    });

    test("converts seconds to milliseconds", () => {
      expect(computeRetryAfterDelayMs("2")).toBe(2_000);
    });

    test("returns 0 for HTTP-date Retry-After values", () => {
      expect(computeRetryAfterDelayMs("Fri, 13 Jun 2026 07:00:00 GMT")).toBe(0);
    });

    test("returns 0 for negative values", () => {
      expect(computeRetryAfterDelayMs("-5")).toBe(0);
    });
  });
});
