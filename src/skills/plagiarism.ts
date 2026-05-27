import { checkCopyscape } from "../copyscape.ts";
import { checkPlagiarismGeminiGrounded, geminiGroundedPlagiarismCostUsd } from "../plagiarism-gemini.ts";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";

export class PlagiarismSkill implements Skill {
  readonly id = "plagiarism";
  readonly name = "Plagiarism Check";

  async run(text: string, config: Config): Promise<SkillResult> {
    const provider = config.providers?.plagiarism?.provider;
    if (provider === "gemini-grounded-plagiarism") {
      return this.#runGeminiGrounded(text, config);
    }

    const result = await checkCopyscape(text, config);

    if (result.verdict === "skipped") {
      if (config.providers?.plagiarism?.extra?.fallbackProvider === "gemini-grounded-plagiarism") {
        console.error("Plagiarism Check: Copyscape skipped; sending article content to Google Gemini because providers.plagiarism.extra.fallbackProvider is gemini-grounded-plagiarism.");
        return this.#runGeminiGrounded(text, config, result.error);
      }

      const fallbackHint = " Configure providers.plagiarism.extra.fallbackProvider = \"gemini-grounded-plagiarism\" to use Gemini Grounded when Copyscape skips.";
      return {
        skillId: this.id,
        name: this.name,
        score: 0,
        verdict: "skipped",
        summary: `${result.error ?? "Plagiarism check skipped."}${fallbackHint}`,
        findings: [],
        costUsd: 0,
        provider: "copyscape",
      };
    }

    const findings: Finding[] = result.matches.slice(0, 5).map((m) => ({
      severity: result.verdict === "rewrite" ? "error" : "warn",
      text: `${m.wordsMatched} words matched at ${m.url}`,
      quote: m.snippet || undefined,
    }));

    const score = Math.max(0, 100 - result.similarityPct * 2);

    return {
      skillId: this.id,
      name: this.name,
      score,
      verdict: result.verdict === "publish" ? "pass" : result.verdict === "review" ? "warn" : "fail",
      summary: `${result.similarityPct}% similarity — ${result.totalMatches} source${result.totalMatches !== 1 ? "s" : ""} matched`,
      findings,
      costUsd: result.totalWords > 0 ? 0.03 + Math.max(0, Math.ceil((result.totalWords - 200) / 100)) * 0.01 : 0.03,
      provider: "copyscape",
      error: result.error,
    };
  }

  async #runGeminiGrounded(text: string, config: Config, fallbackReason?: string): Promise<SkillResult> {
    const result = await checkPlagiarismGeminiGrounded(text, config);

    if (result.verdict === "skipped") {
      return {
        skillId: this.id,
        name: this.name,
        score: 0,
        verdict: "skipped",
        summary: result.error ?? "Gemini grounded plagiarism skipped.",
        findings: [],
        costUsd: 0,
        provider: "gemini-grounded-plagiarism",
      };
    }

    const findings: Finding[] = result.matches.slice(0, 5).map((m) => ({
      severity: result.verdict === "rewrite" ? "error" : "warn",
      text: `${m.wordsMatched} words matched at ${m.url}`,
      quote: m.snippet || undefined,
      sources: [{ url: m.url, title: m.title }],
      confidence: extractConfidence(m.snippet),
    }));

    const score = Math.max(0, 100 - result.similarityPct * 2);
    const evidenceText = result.groundingMode === "ungrounded"
      ? "reduced-confidence Gemini similarity"
      : result.groundingMode === "mixed"
        ? "mixed grounded/reduced-confidence Gemini similarity"
        : "grounded similarity";
    const fallbackText = fallbackReason ? " after Copyscape skipped; article content was sent to Google Gemini by explicit fallback configuration" : "";
    const queryText = result.searchQueries.length ? ` · ${result.searchQueries.length} search quer${result.searchQueries.length === 1 ? "y" : "ies"}` : "";

    return {
      skillId: this.id,
      name: this.name,
      score,
      verdict: result.verdict === "publish" ? "pass" : result.verdict === "review" ? "warn" : "fail",
      summary: `${result.similarityPct}% ${evidenceText} — ${result.totalMatches} source${result.totalMatches !== 1 ? "s" : ""} matched${fallbackText}${queryText}`,
      findings,
      costUsd: result.costUsd || geminiGroundedPlagiarismCostUsd(),
      provider: "gemini-grounded-plagiarism",
    };
  }
}

function extractConfidence(snippet: string | undefined): Finding["confidence"] {
  if (!snippet) return undefined;
  if (snippet.includes("[high confidence")) return "high";
  if (snippet.includes("[medium confidence")) return "medium";
  if (snippet.includes("[low confidence")) return "low";
  return undefined;
}
