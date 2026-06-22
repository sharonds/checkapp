import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { PlagiarismSkill } from "./plagiarism.ts";
import type { Config } from "../config.ts";
import { serializeAuditRecord } from "../audit/types.ts";
import type { AuditRecord } from "../audit/types.ts";

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

  test("drops only the unsafe-URL plagiarism finding, preserving the rest of the audit", async () => {
    // Copyscape can emit a <result> with an empty <url> (the parser defaults it to "").
    // Pre-fix, that unsafe URL poisoned normalizeSource -> the WHOLE plagiarismFindings
    // array was rejected and the ENTIRE audit (language/direction/segments) was dropped.
    // The producer now drops ONLY that finding, so a sibling valid-URL finding and the
    // surrounding audit survive and round-trip.
    globalThis.fetch = async () => ({
      ok: true,
      text: async () =>
        "<count>2</count><querywords>40</querywords>" +
        "<allwordsmatched>20</allwordsmatched><allpercentmatched>50</allpercentmatched>" +
        "<result><url></url><title>No URL Source</title><wordsmatched>10</wordsmatched>" +
        "<htmlsnippet>This sentence has no source url at all.</htmlsnippet></result>" +
        "<result><url>https://example.com/good</url><title>Good Source</title><wordsmatched>10</wordsmatched>" +
        "<htmlsnippet>This sentence has a valid source url here.</htmlsnippet></result>",
    } as Response);

    const result = await new PlagiarismSkill().run(
      "This sentence has no source url at all. This sentence has a valid source url here.",
      config,
    );

    const audit = (result as { audit?: AuditRecord }).audit as AuditRecord;
    // Only the unsafe-URL finding is dropped; the valid one survives.
    expect(audit.plagiarismFindings).toHaveLength(1);
    expect(audit.plagiarismFindings[0].source.url).toBe("https://example.com/good");
    // The audit itself is NOT dropped: top-level fields and segments stay intact.
    expect(audit.language).toBeDefined();
    expect(audit.direction).toBeDefined();
    expect(audit.segments.length).toBeGreaterThan(0);
    // And it now round-trips through the validator instead of being rejected wholesale.
    expect(serializeAuditRecord(audit).ok).toBe(true);
  });

  test("routes to explicit Gemini grounded plagiarism provider", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 22,
            verdict: "review",
            confidence: "medium",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "Copied sentence from source.",
              matchedSourceText: "Copied sentence from source.",
              similarityPct: 90,
              matchType: "exact",
              confidence: "high",
              explanation: "Exact copied sentence.",
            }],
          }) }] },
          groundingMetadata: {
            webSearchQueries: ["Copied sentence from source"],
            groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
          },
        }],
      }),
    } as Response);

    const result = await new PlagiarismSkill().run("Copied sentence from source plus enough original surrounding editorial context to keep overlap in moderate review range today.", {
      ...config,
      geminiApiKey: "gemini-key",
      providers: { plagiarism: { provider: "gemini-grounded-plagiarism" } },
    });

    expect(result.provider).toBe("gemini-grounded-plagiarism");
    expect(result.verdict).toBe("warn");
    expect(result.summary).toContain("22% grounded similarity");
    expect(result.findings[0].sources?.[0].url).toBe("https://example.com/source");
    expect(result.findings[0].sources?.[0].quote).toBe("Copied sentence from source.");
    expect(result.findings[0].confidence).toBe("high");
    expect((result as any).audit.plagiarismFindings[0].source.quote).toBe("Copied sentence from source.");
    expect((result as any).audit.plagiarismFindings[0].matchedText).toBe("Copied sentence from source.");
  });

  test("persists Gemini match type and grounding mode as structured audit fields", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 55,
            verdict: "review",
            confidence: "high",
            matches: [
              {
                sourceUrl: "https://example.com/near",
                sourceTitle: "Near Exact",
                matchedArticleText: "Near exact copied sentence.",
                matchedSourceText: "Near exact copied sentence.",
                similarityPct: 90,
                matchType: "near_exact",
                confidence: "high",
                explanation: "Near exact copied sentence.",
              },
              {
                sourceUrl: "https://not-grounded.example/paraphrase",
                sourceTitle: "Paraphrase",
                matchedArticleText: "Paraphrased article sentence.",
                matchedSourceText: "Similar source sentence.",
                similarityPct: 50,
                matchType: "paraphrase",
                confidence: "high",
                explanation: "Paraphrased from a source.",
              },
              {
                sourceUrl: "https://example.com/uncertain",
                sourceTitle: "Uncertain",
                matchedArticleText: "Uncertain match sentence.",
                similarityPct: 40,
                matchType: "uncertain",
                confidence: "medium",
                explanation: "Uncertain match.",
              },
            ],
          }) }] },
          groundingMetadata: {
            webSearchQueries: ["mixed plagiarism checks"],
            groundingChunks: [
              { web: { uri: "https://example.com/near", title: "Near Exact" } },
              { web: { uri: "https://example.com/uncertain", title: "Uncertain" } },
            ],
          },
        }],
      }),
    } as Response);

    const result = await new PlagiarismSkill().run(
      "Near exact copied sentence. Paraphrased article sentence. Uncertain match sentence.",
      {
        ...config,
        geminiApiKey: "gemini-key",
        providers: { plagiarism: { provider: "gemini-grounded-plagiarism" } },
      }
    );

    const findings = (result as any).audit.plagiarismFindings;
    expect(findings.map((finding: any) => finding.matchType)).toEqual(["near", "semantic", "unknown"]);
    expect(findings.map((finding: any) => finding.groundingMode)).toEqual(["grounded", "ungrounded", "grounded"]);
    expect(findings.map((finding: any) => finding.confidence)).toEqual(result.findings.map((finding: any) => finding.confidence));
    expect(findings[1].confidenceRationale).toContain("review manually");
    expect(result.findings.map((finding: any) => finding.matchType)).toEqual(["near", "semantic", "unknown"]);
    expect(result.findings.map((finding: any) => finding.groundingMode)).toEqual(["grounded", "ungrounded", "grounded"]);
  });

  test("uses explicit Gemini fallback when Copyscape credits are insufficient", async () => {
    let calls = 0;
    globalThis.fetch = async (url: string | URL) => {
      calls++;
      if (hostnameIs(url, "copyscape.com")) {
        return {
          ok: true,
          text: async () => "<error>Insufficient credits.</error>",
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({
          candidates: [{
            content: { parts: [{ text: JSON.stringify({
              overallSimilarityPct: 0,
              verdict: "publish",
              confidence: "low",
              matches: [],
            }) }] },
            groundingMetadata: { webSearchQueries: [], groundingChunks: [] },
          }],
        }),
      } as Response;
    };

    const result = await new PlagiarismSkill().run("Original article text.", {
      ...config,
      geminiApiKey: "gemini-key",
      providers: { plagiarism: { provider: "copyscape", extra: { fallbackProvider: "gemini-grounded-plagiarism" } } },
    });

    expect(calls).toBe(2);
    expect(result.provider).toBe("gemini-grounded-plagiarism");
    expect(result.verdict).toBe("pass");
    expect(result.summary).toContain("after Copyscape skipped");
    expect(result.summary).toContain("article content was sent to Google Gemini");
  });

  test("mentions Gemini fallback configuration when Copyscape skips without fallback", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      text: async () => "<error>Insufficient credits.</error>",
    } as Response);

    const result = await new PlagiarismSkill().run("Article text", config);

    expect(result.verdict).toBe("skipped");
    expect(result.summary).toContain("fallbackProvider");
    expect(result.summary).toContain("gemini-grounded-plagiarism");
  });

  test("labels ungrounded Gemini evidence as reduced confidence, not grounded", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 80,
            verdict: "rewrite",
            confidence: "high",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "Copied sentence from source.",
              matchedSourceText: "Copied sentence from source.",
              similarityPct: 90,
              matchType: "exact",
              confidence: "high",
              explanation: "Exact copied sentence.",
            }],
          }) }] },
          groundingMetadata: { groundingChunks: [] },
        }],
      }),
    } as Response);

    const result = await new PlagiarismSkill().run("Copied sentence from source.", {
      ...config,
      geminiApiKey: "gemini-key",
      providers: { plagiarism: { provider: "gemini-grounded-plagiarism" } },
    });

    expect(result.verdict).toBe("fail");
    expect(result.summary).toContain("reduced-confidence Gemini similarity");
    expect(result.summary).not.toContain("grounded similarity");
    expect(result.findings[0].quote).toBe("Copied sentence from source.");
    expect(result.findings[0].location?.paragraphIndex).toBe(0);
    expect(result.findings[0].rewrite).toContain("Rewrite this passage");
    expect((result as any).audit.plagiarismFindings[0].quote).toBe("Copied sentence from source.");
    expect((result as any).audit.plagiarismFindings[0].remediation).toContain("Rewrite this passage");
  });

  test("audit attribution reports the model actually used, including config overrides", async () => {
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: { parts: [{ text: JSON.stringify({
            overallSimilarityPct: 30,
            verdict: "review",
            confidence: "medium",
            matches: [{
              sourceUrl: "https://example.com/source",
              sourceTitle: "Source",
              matchedArticleText: "Sentence from source.",
              matchedSourceText: "Sentence from source.",
              similarityPct: 80,
              matchType: "exact",
              confidence: "medium",
              explanation: "Exact match.",
            }],
          }) }] },
          groundingMetadata: {
            webSearchQueries: ["Sentence from source"],
            groundingChunks: [{ web: { uri: "https://example.com/source", title: "Source" } }],
          },
        }],
      }),
    } as Response);

    const result = await new PlagiarismSkill().run(
      "Sentence from source plus additional editorial context to pad the article.",
      {
        ...config,
        geminiApiKey: "gemini-key",
        providers: {
          plagiarism: {
            provider: "gemini-grounded-plagiarism",
            extra: { model: "gemini-custom-x" },
          },
        },
      },
    );

    expect(result.findings[0].model).toBe("gemini-custom-x");
    expect((result as any).audit.providerAttempts[0].model).toBe("gemini-custom-x");
  });
});

function hostnameIs(input: string | URL, expectedHostname: string): boolean {
  try {
    const url = input instanceof URL ? input : new URL(String(input));
    return url.hostname === expectedHostname || url.hostname === `www.${expectedHostname}`;
  } catch {
    return false;
  }
}
