import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCheckCore } from "../src/checker-core.ts";
import { generateMarkdownReport } from "../src/export.ts";
import { generateReport } from "../src/report.ts";
import type { Config } from "../src/config.ts";
import type { SkillResult } from "../src/skills/types.ts";

type ScenarioKind = "fact-check" | "plagiarism";
type ScenarioLanguage = "en" | "he" | "mixed";

interface GroundedClaim {
  claim: string;
  supported: boolean | null;
  note: string;
  sources: string[];
}

interface PlagiarismMatch {
  sourceUrl: string;
  sourceTitle: string;
  matchedArticleText: string;
  matchedSourceText?: string;
  similarityPct: number;
  matchType: "exact" | "near_exact" | "paraphrase" | "uncertain";
  confidence: "high" | "medium" | "low";
  explanation: string;
}

interface PlagiarismResponse {
  overallSimilarityPct: number;
  verdict: "publish" | "review" | "rewrite";
  confidence: "high" | "medium" | "low";
  matches: PlagiarismMatch[];
}

interface Scenario {
  id: string;
  kind: ScenarioKind;
  language: ScenarioLanguage;
  article: string;
  claims?: GroundedClaim[];
  plagiarismResponse?: PlagiarismResponse;
  confidenceNote?: string;
  expect: {
    provider: string;
    verdict: "pass" | "warn" | "fail" | "skipped";
    minSources: number;
    reportContains: string[];
  };
}

interface ScenarioSummary {
  id: string;
  kind: ScenarioKind;
  language: ScenarioLanguage;
  provider: string | undefined;
  verdict: string;
  score: number;
  sourceCount: number;
  confidence: string;
  htmlReport: string;
  markdownReport: string;
  confidenceNote?: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const fixtureRoot = join(repoRoot, "tests", "fixtures", "gemini-grounded");
const scenariosPath = join(fixtureRoot, "scenarios.json");
const outputRoot = process.env.CHECKAPP_GEMINI_VALIDATION_OUT ?? join(tmpdir(), "checkapp-gemini-validation");

const scenarios = JSON.parse(readFileSync(scenariosPath, "utf8")) as Scenario[];
mkdirSync(outputRoot, { recursive: true });

const originalFetch = globalThis.fetch;
try {
  const summaries: ScenarioSummary[] = [];
  for (const scenario of scenarios) {
    const summary = await runScenario(scenario);
    summaries.push(summary);
    console.log([
      `✓ ${summary.id}`,
      summary.language,
      summary.kind,
      summary.provider ?? "unknown-provider",
      summary.verdict,
      `${summary.score}/100`,
      `${summary.sourceCount} source(s)`,
      summary.confidence,
    ].join(" | "));
  }

  const summaryPath = join(outputRoot, "summary.json");
  writeFileSync(summaryPath, JSON.stringify(summaries, null, 2));
  console.log(`\nScenario summary: ${summaryPath}`);
} finally {
  globalThis.fetch = originalFetch;
}

async function runScenario(scenario: Scenario): Promise<ScenarioSummary> {
  const article = readFileSync(join(fixtureRoot, scenario.article), "utf8").trim();
  const config = scenario.kind === "fact-check"
    ? factCheckConfig()
    : plagiarismConfig();

  if (scenario.kind === "fact-check") {
    prepareFactCheckFetch(scenario);
  } else {
    preparePlagiarismFetch(scenario);
  }

  try {
    const { results, totalCostUsd } = await runCheckCore(article, config);
    const result = results[0];
    if (!result) throw new Error(`${scenario.id}: no skill result produced`);

    const record = {
      source: scenario.article,
      wordCount: article.split(/\s+/).filter(Boolean).length,
      results,
      totalCostUsd,
      createdAt: "2026-05-27 00:00",
    };
    const html = generateReport(record);
    const markdown = generateMarkdownReport(record);
    const htmlReport = join(outputRoot, `${scenario.id}.html`);
    const markdownReport = join(outputRoot, `${scenario.id}.md`);
    writeFileSync(htmlReport, html);
    writeFileSync(markdownReport, markdown);

    const sourceCount = countSources(result);
    const confidence = summarizeConfidence(result);
    assertScenario(scenario, result, sourceCount, `${html}\n${markdown}`);

    return {
      id: scenario.id,
      kind: scenario.kind,
      language: scenario.language,
      provider: result.provider,
      verdict: result.verdict,
      score: result.score,
      sourceCount,
      confidence,
      htmlReport,
      markdownReport,
      confidenceNote: scenario.confidenceNote,
    };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function factCheckConfig(): Config {
  return {
    copyscapeUser: "",
    copyscapeKey: "",
    geminiApiKey: "test-gemini-key",
    minimaxApiKey: "test-minimax-key",
    factCheckTierFlag: true,
    factCheckTier: "standard",
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
      grammar: false,
      academic: false,
      selfPlagiarism: false,
    },
    providers: {
      "fact-check": { provider: "gemini-grounded" },
    },
  };
}

function plagiarismConfig(): Config {
  return {
    copyscapeUser: "",
    copyscapeKey: "",
    geminiApiKey: "test-gemini-key",
    skills: {
      plagiarism: true,
      aiDetection: false,
      seo: false,
      factCheck: false,
      tone: false,
      legal: false,
      summary: false,
      brief: false,
      purpose: false,
      grammar: false,
      academic: false,
      selfPlagiarism: false,
    },
    providers: {
      plagiarism: { provider: "gemini-grounded-plagiarism" },
    },
  };
}

function prepareFactCheckFetch(scenario: Scenario): void {
  const claims = scenario.claims ?? [];
  let groundedCursor = 0;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("api.minimax.io")) {
      return new Response(JSON.stringify({
        id: `msg_${scenario.id}`,
        type: "message",
        role: "assistant",
        model: "MiniMax-M2.7",
        content: [{
          type: "text",
          text: JSON.stringify(claims.map((claim) => claim.claim)),
        }],
        stop_reason: "end_turn",
        usage: { input_tokens: 10, output_tokens: 10 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (url.includes("generativelanguage.googleapis.com")) {
      const claim = claims[Math.min(groundedCursor, Math.max(0, claims.length - 1))];
      groundedCursor++;
      if (!claim) {
        return new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { thought: true, text: "private reasoning omitted" },
              { text: JSON.stringify({ supported: claim.supported, note: claim.note }) },
            ],
          },
          groundingMetadata: {
            webSearchQueries: [claim.claim],
            groundingChunks: claim.sources.map((source) => ({
              web: { uri: source, title: source.includes("openai.com") ? "OpenAI GPT-4 research" : "Grounded source" },
            })),
            groundingSupports: claim.sources.map((_, index) => ({
              groundingChunkIndices: [index],
              segment: { text: claim.claim },
            })),
          },
        }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 30,
          totalTokenCount: 130,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Unexpected validation request", { status: 500 });
  };
}

function preparePlagiarismFetch(scenario: Scenario): void {
  const response = scenario.plagiarismResponse;
  if (!response) throw new Error(`${scenario.id}: plagiarismResponse missing`);
  globalThis.fetch = async () => {
    const groundingChunks = response.matches.map((match) => ({
      web: { uri: match.sourceUrl, title: match.sourceTitle },
    }));
    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text: JSON.stringify(response) }] },
        groundingMetadata: {
          webSearchQueries: [`${scenario.id} grounded plagiarism validation`],
          groundingChunks,
        },
      }],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function assertScenario(scenario: Scenario, result: SkillResult, sourceCount: number, reportText: string): void {
  const prefix = `${scenario.id}:`;
  if (result.provider !== scenario.expect.provider) {
    throw new Error(`${prefix} expected provider ${scenario.expect.provider}, got ${result.provider ?? "undefined"}`);
  }
  if (result.verdict !== scenario.expect.verdict) {
    throw new Error(`${prefix} expected verdict ${scenario.expect.verdict}, got ${result.verdict}`);
  }
  if (sourceCount < scenario.expect.minSources) {
    throw new Error(`${prefix} expected at least ${scenario.expect.minSources} source(s), got ${sourceCount}`);
  }
  for (const expected of scenario.expect.reportContains) {
    if (!reportText.includes(expected)) {
      throw new Error(`${prefix} report missing expected text: ${expected}`);
    }
  }
  if (/SECRET|test-gemini-key|test-minimax-key/.test(reportText)) {
    throw new Error(`${prefix} report leaked a test API key or secret marker`);
  }
  if (/href="(?:javascript|data):/i.test(reportText) || /\]\((?:javascript|data):/i.test(reportText)) {
    throw new Error(`${prefix} report contains an unsafe source URL`);
  }
}

function countSources(result: SkillResult): number {
  const urls = new Set<string>();
  for (const finding of result.findings) {
    for (const source of finding.sources ?? []) {
      urls.add(source.url);
    }
  }
  return urls.size;
}

function summarizeConfidence(result: SkillResult): string {
  const confidences = result.findings
    .map((finding) => finding.confidence)
    .filter((confidence): confidence is NonNullable<typeof confidence> => Boolean(confidence));
  if (confidences.length > 0) return [...new Set(confidences)].join(",");
  if (result.provider === "gemini-grounded-plagiarism" && result.verdict === "pass") return "low/absence-not-proven";
  if (result.provider === "gemini-grounded" && result.verdict === "pass") return "grounded";
  return "not-explicit";
}
