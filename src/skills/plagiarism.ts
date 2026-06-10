import { checkCopyscape } from "../copyscape.ts";
import type { CopyscapeMatch } from "../copyscape.ts";
import { checkPlagiarismGeminiGrounded, geminiGroundedPlagiarismCostUsd } from "../plagiarism-gemini.ts";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { buildAuditCoverage } from "../audit/coverage.ts";
import type { SkillRunOutput } from "../audit/contribution.ts";
import {
  analyzeDocument,
  confidenceRationale,
  createAuditRecordBase,
  locateQuote,
  plagiarismRewriteSuggestion,
} from "../audit/document.ts";
import type { AuditRecord, PlagiarismFinding } from "../audit/types.ts";
import { sanitizeAuditUrl } from "../audit/types.ts";

export class PlagiarismSkill implements Skill {
  readonly id = "plagiarism";
  readonly name = "Plagiarism Check";

  async run(text: string, config: Config): Promise<SkillRunOutput> {
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

    const documentAnalysis = analyzeDocument(text);
    const baseAudit = createAuditRecordBase(this.id, text);
    const auditId = baseAudit.auditId;
    const findings: Finding[] = result.matches.slice(0, 5).map((m, index) => {
      const articleQuote = extractArticleQuote(m.snippet);
      const located = locateQuote(text, articleQuote, documentAnalysis);
      const confidence = result.verdict === "rewrite" ? "high" : "medium";
      const plagiarismFindingId = `plagiarism-${index + 1}`;
      return {
      severity: result.verdict === "rewrite" ? "error" : "warn",
      text: `${m.wordsMatched} words matched at ${displayUrl(m.url)}`,
      quote: located.quote || articleQuote || undefined,
      sources: [{ url: m.url, title: m.title, quote: m.matchedSourceText }],
      rewrite: plagiarismRewriteSuggestion(located.quote, located.language),
      confidence,
      matchType: "exact",
      id: plagiarismFindingId,
      status: "plagiarism_match",
      location: located.location,
      confidenceRationale: confidenceRationale(1, confidence),
      provider: "copyscape",
      auditRef: { auditId, plagiarismFindingId },
    };
    });

    const score = Math.max(0, 100 - result.similarityPct * 2);

    const skillResult: SkillResult = {
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
    return { ...skillResult, audit: buildPlagiarismAudit(baseAudit, documentAnalysis, text, result.matches, "copyscape", auditId, result.verdict === "rewrite" ? "high" : "medium") };
  }

  async #runGeminiGrounded(text: string, config: Config, fallbackReason?: string): Promise<SkillRunOutput> {
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

    const documentAnalysis = analyzeDocument(text);
    const baseAudit = createAuditRecordBase(this.id, text);
    const auditId = baseAudit.auditId;
    const findings: Finding[] = result.matches.slice(0, 5).map((m, index) => {
      const confidence = extractConfidence(m.snippet) ?? result.confidence;
      const articleQuote = extractArticleQuote(m.snippet);
      const located = locateQuote(text, articleQuote, documentAnalysis);
      const plagiarismFindingId = `plagiarism-${index + 1}`;
      return {
      severity: result.verdict === "rewrite" ? "error" : "warn",
      text: `${m.wordsMatched} words matched at ${displayUrl(m.url)}`,
      quote: located.quote || articleQuote || undefined,
      sources: [{ url: m.url, title: m.title, quote: m.matchedSourceText }],
      rewrite: plagiarismRewriteSuggestion(located.quote, located.language),
      confidence,
      matchType: auditMatchType(m),
      groundingMode: m.groundingMode,
      id: plagiarismFindingId,
      status: "plagiarism_match",
      location: located.location,
      confidenceRationale: plagiarismConfidenceRationale(m.groundingMode, confidence),
      searchQueries: result.searchQueries,
      provider: "gemini-grounded-plagiarism",
      model: "gemini-3-pro-preview",
      auditRef: { auditId, plagiarismFindingId },
    };
    });

    const score = Math.max(0, 100 - result.similarityPct * 2);
    const evidenceText = result.groundingMode === "ungrounded"
      ? "reduced-confidence Gemini similarity"
      : result.groundingMode === "mixed"
        ? "mixed grounded/reduced-confidence Gemini similarity"
        : "grounded similarity";
    const fallbackText = fallbackReason ? " after Copyscape skipped; article content was sent to Google Gemini by explicit fallback configuration" : "";
    const queryText = result.searchQueries.length ? ` · ${result.searchQueries.length} search quer${result.searchQueries.length === 1 ? "y" : "ies"}` : "";

    const skillResult: SkillResult = {
      skillId: this.id,
      name: this.name,
      score,
      verdict: result.verdict === "publish" ? "pass" : result.verdict === "review" ? "warn" : "fail",
      summary: `${result.similarityPct}% ${evidenceText} — ${result.totalMatches} source${result.totalMatches !== 1 ? "s" : ""} matched${fallbackText}${queryText}`,
      findings,
      costUsd: result.costUsd || geminiGroundedPlagiarismCostUsd(),
      provider: "gemini-grounded-plagiarism",
    };
    return {
      ...skillResult,
      audit: buildPlagiarismAudit(
        baseAudit,
        documentAnalysis,
        text,
        result.matches,
        "gemini-grounded-plagiarism",
        auditId,
        result.confidence,
        result.searchQueries,
        "gemini-3-pro-preview",
      ),
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

function buildPlagiarismAudit(
  baseAudit: Omit<AuditRecord, "coverage">,
  documentAnalysis: ReturnType<typeof analyzeDocument>,
  text: string,
  matches: CopyscapeMatch[],
  provider: string,
  auditId: string,
  confidence: "high" | "medium" | "low",
  searchQueries: string[] = [],
  model?: string,
): AuditRecord {
  const plagiarismFindings: PlagiarismFinding[] = matches.map((match, index) => {
    const articleQuote = extractArticleQuote(match.snippet);
    const located = locateQuote(text, articleQuote, documentAnalysis);
    return {
      id: `plagiarism-${index + 1}`,
      quote: located.quote || articleQuote,
      source: {
        url: match.url,
        title: match.title,
        quote: match.matchedSourceText ?? match.snippet,
        accepted: true,
      },
      status: "plagiarism_match",
      confidence,
      confidenceRationale: confidenceRationale(1, confidence),
      passageIds: located.segmentId ? [located.segmentId] : undefined,
      matchType: provider === "gemini-grounded-plagiarism" ? auditMatchType(match) : "exact",
      groundingMode: match.groundingMode,
      matchedText: articleQuote,
      remediation: plagiarismRewriteSuggestion(located.quote, located.language),
      provider,
      model,
      language: located.language,
      direction: located.direction,
      location: located.location,
    };
  });
  return {
    ...baseAudit,
    auditId,
    coverage: buildAuditCoverage({
      wordsScanned: documentAnalysis.wordsScanned,
      sectionsDetected: documentAnalysis.sectionsDetected,
      paragraphsScanned: documentAnalysis.paragraphsScanned,
      sentencesScanned: documentAnalysis.sentencesScanned,
      claimDecisions: [],
      plagiarismPassages: documentAnalysis.segments.map((segment) => ({ id: segment.id, decision: "checked" })),
    }),
    plagiarismFindings,
    providerAttempts: [{
      id: "attempt-1",
      provider,
      model,
      status: "success",
    }],
  };
}

function auditMatchType(match: CopyscapeMatch): PlagiarismFinding["matchType"] {
  if (match.matchType === "exact") return "exact";
  if (match.matchType === "near_exact") return "near";
  if (match.matchType === "paraphrase") return "semantic";
  return "unknown";
}

function plagiarismConfidenceRationale(
  groundingMode: CopyscapeMatch["groundingMode"],
  confidence: "high" | "medium" | "low",
): string {
  if (groundingMode === "ungrounded") {
    return `Gemini reported a ${confidence}-confidence similarity match without Google grounding metadata; review manually.`;
  }
  if (groundingMode === "mixed") {
    return `Gemini reported ${confidence}-confidence similarity with mixed grounded and ungrounded evidence; review manually.`;
  }
  return confidenceRationale(1, confidence);
}

function extractArticleQuote(snippet: string | undefined): string {
  if (!snippet) return "";
  const articleLine = snippet.split(/\r?\n/).find((line) => line.trim().startsWith("Article:"));
  if (articleLine) return articleLine.replace(/^\s*Article:\s*/, "").trim();
  return snippet.trim();
}

function displayUrl(raw: string): string {
  const sanitized = sanitizeAuditUrl(raw);
  if (!sanitized) return "unsafe source URL";
  try {
    return new URL(sanitized).hostname.replace(/^www\./, "");
  } catch {
    return sanitized;
  }
}
