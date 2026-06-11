import Exa from "exa-js";
import type { Skill, SkillResult, Finding, ClaimType } from "./types.ts";
import type { SkillRunOutput } from "../audit/contribution.ts";
import type { Config } from "../config.ts";
import { getLlmClient, parseJsonResponse } from "./llm.ts";
import { resolveProvider } from "../providers/resolve.ts";
import { isE2E, assertMocksOnly } from "../e2e/mode.ts";
import { loadScenario } from "../e2e/fixtures.ts";
import { buildAuditCoverage } from "../audit/coverage.ts";
import { createAuditBudget, selectClaimsForAudit, shouldStopForBudget, type AuditBudgetStopReason } from "../audit/budget.ts";
import {
  analyzeDocument,
  confidenceRationale,
  createAuditRecordBase,
  factRewriteSuggestion,
  locateQuote,
  toAuditClaimType,
} from "../audit/document.ts";
import type { AuditClaim, AuditRecord, ClaimDecision, FactAssessment, ProviderAttempt } from "../audit/types.ts";

export function extractClaimsPrompt(articleText: string): string {
  return `Extract up to 20 specific, verifiable factual claims from across the entire article below.
Return ONLY a JSON array of strings, no other text. Each string is one claim.
Cover different sections of the article before adding multiple claims from the same section.
Focus on claims about statistics, dates, scientific facts, product specs, rules, or named entities — not opinions.

Article:
${articleText}

Example output:
["More than one billion people are vitamin D deficient worldwide.", "Vitamin D deficiency causes rickets in children."]

JSON array of claims:`;
}

export function formatCitation(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export function claimConfidence(sourceCount: number, supported: boolean | null): "high" | "medium" | "low" {
  if (supported === null) return "low";
  if (sourceCount >= 3) return "high";
  if (sourceCount >= 1) return "medium";
  return "low";
}

export class FactCheckSkill implements Skill {
  readonly id = "fact-check";
  readonly name = "Fact Check";

  async run(text: string, config: Config): Promise<SkillRunOutput> {
    const resolved = resolveProvider(config, "fact-check");
    if (!resolved) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no fact-check provider configured",
        findings: [{ severity: "info", text: "Configure a fact-check provider in Settings → Providers (e.g. Exa)" }],
        costUsd: 0,
      };
    }
    if (resolved.provider !== "exa-search" && resolved.provider !== "parallel-task" && resolved.provider !== "exa-deep-reasoning") {
      return skippedResult(this, `${resolved.provider} not implemented for fact-check yet`);
    }
    const apiKey = resolved.apiKey;
    if (!apiKey) return skippedResult(this, `${resolved.provider} API key missing`);

    const deepMode = resolved.provider === "exa-deep-reasoning" || resolved.provider === "parallel-task";

    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "info", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable fact-checking" }],
        costUsd: 0,
      };
    }

    // E2E mock: return scenario Exa results instead of constructing a real
    // Exa client. The scenario provides one results bundle reused per claim.
    const exaMock = isE2E()
      ? (_q: string) => ({
          results: loadScenario().providers.exa?.results ?? [],
        })
      : null;
    const exa = exaMock ? null : new Exa(apiKey);

    const documentAnalysis = analyzeDocument(text);

    // Step 1: extract claims. Empty/unparseable/non-array responses mean the
    // extraction provider failed — never "the article has no claims".
    const claimsText = await llm.call(extractClaimsPrompt(text), 4096);
    let claims: string[] | null = null;
    if (claimsText.trim()) {
      try {
        const parsed = parseJsonResponse<string[]>(claimsText);
        claims = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 20) : null;
      } catch {
        claims = null;
      }
    }
    if (claims === null) {
      return {
        skillId: this.id, name: this.name, score: 60, verdict: "warn",
        summary: "Claim extraction failed — claims could not be verified",
        findings: [{
          severity: "warn",
          status: "provider_error",
          text: "The claim-extraction provider returned an unusable response, so fact-checking could not run. Re-run the check or switch the LLM provider.",
        }],
        costUsd: 0.001,
        provider: resolved.provider,
      };
    }

    if (claims.length === 0) {
      return {
        skillId: this.id, name: this.name, score: 60, verdict: "warn",
        summary: "No specific verifiable claims detected",
        findings: [{
          severity: "warn",
          text: "No checkable statistics, dates, or research findings found — adding cited facts (studies, percentages, named data) increases credibility and SEO authority",
        }],
        costUsd: 0.001,
        provider: resolved.provider,
      };
    }

    // Step 2: search each claim with Exa
    const findings: Finding[] = [];
    let costUsd = 0.001;

    const search = exaMock
      ? async (q: string) => exaMock(q)
      : deepMode
      ? async (q: string) => {
          assertMocksOnly("exa:deep-reasoning");
          return exa!.search(q, {
            type: "deep-reasoning",
            numResults: 5,
            contents: {
              text: { maxCharacters: 4000 },
              highlights: { maxCharacters: 1000, numSentences: 3, query: q },
            },
          });
        }
      : async (q: string) => {
          assertMocksOnly("exa:search");
          return exa!.search(q, {
            type: "auto",
            numResults: 3,
            contents: {
              text: { maxCharacters: 4000 },
              highlights: { maxCharacters: 1000, numSentences: 3, query: q },
            },
          });
        };

    const budget = createAuditBudget(config, deepMode ? "premium" : "standard");
    const claimSelection = selectClaimsForAudit(claims, budget);
    const checkedClaims = claimSelection.checkedClaims;
    const runtimeSkippedClaims: Array<{ claim: string; skipReason: AuditBudgetStopReason }> = [];
    const claimResults: Array<{ claim: string; results: Awaited<ReturnType<typeof search>>["results"] }> = [];
    const budgetStartedAt = Date.now();
    for (const [index, claim] of checkedClaims.entries()) {
      const stopKey = shouldStopForBudget(budget, {
        costUsd,
        providerCalls: claimResults.length,
        wallClockMs: Date.now() - budgetStartedAt,
      });
      if (stopKey) {
        const skipReason = budgetStopReasonFromKey(stopKey);
        runtimeSkippedClaims.push(
          ...checkedClaims.slice(index).map((skippedClaim) => ({ claim: skippedClaim, skipReason })),
        );
        break;
      }
      const result = await search(claim);
      costUsd += deepMode ? 0.025 : 0.007;
      claimResults.push({ claim, results: result.results });
    }

    // Step 3: assess each claim
    const assessments: Array<{ claim: string; supported: boolean | null; note: string; claimType: ClaimType }> = [];
    for (const { claim, results: searchResults } of claimResults) {
      const evidence = searchResults
        .map((r, i) => {
          const highlights = (r.highlights ?? []).join(" ");
          const fullText = r.text ?? "";
          return [
            `[${i + 1}] URL: ${r.url}`,
            `Title: ${r.title ?? "N/A"}`,
            `Highlights: ${highlights || "N/A"}`,
            `Full text: ${fullText || "N/A"}`,
          ].join("\n");
        })
        .join("\n\n---\n\n");

      const assessPrompt = `Is this claim supported by the evidence below?
Claim: "${claim}"

Evidence:
${evidence}

Reply with JSON:
{ "supported": true|false|null, "note": "one sentence", "claimType": "scientific"|"medical"|"financial"|"general" }

- supported: true if evidence supports the claim, false if contradicts, null if inconclusive.
- claimType: classify the claim type. "scientific" for studies/research/statistics about physical world/human behavior. "medical" for health/disease/treatment claims. "financial" for monetary/market/business claims. "general" for everything else.`;

      const assessRaw = await llm.call(assessPrompt, 512);
      costUsd += 0.001;

      try {
        const json = parseJsonResponse<{ supported: boolean | null; note: string; claimType?: string }>(assessRaw);
        const validTypes = ["scientific", "medical", "financial", "general"] as const;
        const claimType = validTypes.includes(json.claimType as never) ? (json.claimType as ClaimType) : "general";
        assessments.push({ claim, supported: json.supported, note: json.note, claimType });
      } catch {
        assessments.push({ claim, supported: null, note: "Could not assess", claimType: "general" });
      }
    }

    const auditId = `fact-${createAuditRecordBase(this.id, text).auditId}`;
    const auditClaims: AuditClaim[] = [];
    const claimDecisions: ClaimDecision[] = [];
    const factAssessments: FactAssessment[] = [];
    const providerAttempts: ProviderAttempt[] = claimResults.map((claimResult, index) => ({
      id: `attempt-${index + 1}`,
      provider: resolved.provider,
      model: deepMode ? "deep-reasoning" : "auto",
      status: "success",
    }));

    for (const [index, { claim, supported, note, claimType }] of assessments.entries()) {
      const sources = claimResults.find(cr => cr.claim === claim)?.results ?? [];
      const sourceList = sources.slice(0, 3).map((r) => ({
        url: r.url,
        title: r.title ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        quote: (r.highlights ?? [])[0],
      }));
      const sourceCount = sourceList.length;
      const effectiveSupported = sourceCount === 0 && supported === true ? null : supported;
      const confidence = claimConfidence(sourceCount, effectiveSupported);
      const located = locateQuote(text, claim, documentAnalysis);
      const claimId = `claim-${index + 1}`;
      const assessmentId = `assessment-${index + 1}`;
      const status = effectiveSupported === false ? "unsupported" : effectiveSupported === null ? "unverified" : "supported";
      const rationale = confidenceRationale(sourceCount, confidence);
      const rewrite = status === "supported" ? undefined : factRewriteSuggestion(located.quote, located.language, effectiveSupported, note);
      const base = { sources: sourceList, confidence, claimType };
      auditClaims.push({
        id: claimId,
        quote: located.quote,
        normalizedClaim: claim,
        type: toAuditClaimType(claimType),
        language: located.language,
        direction: located.direction,
        location: located.location,
        searchQueries: [claim],
      });
      claimDecisions.push({ claimId, decision: "checked" });
      factAssessments.push({
        id: assessmentId,
        claimId,
        status,
        sources: sourceList.map((source) => ({
          url: source.url,
          title: source.title,
          quote: source.quote,
          accepted: true,
        })),
        explanation: note,
        confidence,
        confidenceRationale: rationale,
        searchQueries: [claim],
        provider: resolved.provider,
        model: deepMode ? "deep-reasoning" : "auto",
        attemptIds: [providerAttempts[index]?.id ?? `attempt-${index + 1}`],
        language: located.language,
        direction: located.direction,
        rewrite,
        rewriteLanguage: rewrite ? located.language : undefined,
        rewriteDir: rewrite ? located.direction : undefined,
      });
      const auditFields = {
        id: assessmentId,
        status,
        quote: located.quote,
        location: located.location,
        explanation: note,
        explanationLanguage: located.language,
        explanationDir: located.direction,
        confidenceRationale: rationale,
        searchQueries: [claim],
        provider: resolved.provider,
        model: deepMode ? "deep-reasoning" : "auto",
        auditRef: { auditId, claimId, assessmentId },
        rewrite,
      } satisfies Partial<Finding>;
      if (effectiveSupported === false) {
        findings.push({ severity: "error", text: `Unsupported (${confidence} confidence): "${claim}" — ${note}`, ...base, ...auditFields });
      } else if (effectiveSupported === null) {
        findings.push({
          severity: "warn",
          text: `Unverified (${confidence} confidence): "${claim}" — ${sourceCount === 0 ? "No evidence source URL was returned." : note}`,
          ...base,
          ...auditFields,
        });
      } else {
        const citations = sources.slice(0, 2).map(r => formatCitation(r.url)).join(", ");
        findings.push({
          severity: "info",
          text: `Verified (${confidence} confidence): "${claim}" — ${note}${citations ? `. Cite: ${citations}` : ""}`,
          ...base,
          ...auditFields,
        });
      }
    }

    const skippedClaims = [...runtimeSkippedClaims, ...claimSelection.skippedClaims];
    for (const [offset, skipped] of skippedClaims.entries()) {
      const claim = skipped.claim;
      const located = locateQuote(text, claim, documentAnalysis);
      const claimId = `claim-${assessments.length + offset + 1}`;
      auditClaims.push({
        id: claimId,
        quote: located.quote,
        normalizedClaim: claim,
        type: "general",
        language: located.language,
        direction: located.direction,
        location: located.location,
        searchQueries: [claim],
      });
      claimDecisions.push({ claimId, decision: "skipped", skipReason: skipped.skipReason });
    }

    const failCount = findings.filter((f) => f.severity === "error").length;
    const warnCount = findings.filter((f) => f.severity === "warn").length;
    const noCheckedClaims = assessments.length === 0 && claims.length > 0;
    const score = noCheckedClaims ? 60 : Math.round(100 - failCount * 25 - warnCount * 10);
    const verdict = noCheckedClaims ? "warn" : failCount > 0 ? "fail" : warnCount > 1 ? "warn" : "pass";
    const summary = `${assessments.length} claims checked — ${failCount} unsupported, ${warnCount} unverified (via ${llm.provider})`;

    const baseAudit = createAuditRecordBase(this.id, text);
    const audit: AuditRecord = {
      ...baseAudit,
      auditId,
      coverage: buildAuditCoverage({
        wordsScanned: documentAnalysis.wordsScanned,
        sectionsDetected: documentAnalysis.sectionsDetected,
        paragraphsScanned: documentAnalysis.paragraphsScanned,
        sentencesScanned: documentAnalysis.sentencesScanned,
        claimDecisions,
        providerAttempts,
        budgetStopReason: runtimeSkippedClaims[0]?.skipReason ?? claimSelection.budgetStopReason,
      }),
      claims: auditClaims,
      claimDecisions,
      factAssessments,
      providerAttempts,
    };
    return { skillId: this.id, name: this.name, score: Math.max(0, score), verdict, summary, findings, costUsd, provider: resolved.provider, audit };
  }
}

function budgetStopReasonFromKey(key: ReturnType<typeof shouldStopForBudget>): AuditBudgetStopReason {
  if (key === "maxUsd") return "cost_budget";
  if (key === "maxInputTokens") return "input_token_budget";
  if (key === "maxOutputTokens") return "output_token_budget";
  if (key === "maxProviderCalls") return "provider_call_budget";
  if (key === "maxWallClockMs") return "wall_clock_budget";
  if (key === "maxProviderRetries") return "provider_retry_budget";
  if (key === "maxProviderFailures") return "provider_failure_budget";
  return "provider_call_budget";
}

function skippedResult(skill: FactCheckSkill, reason: string): SkillResult {
  return {
    skillId: skill.id,
    name: skill.name,
    verdict: "skipped",
    score: 0,
    summary: `Skipped: ${reason}.`,
    findings: [],
    costUsd: 0,
  };
}
