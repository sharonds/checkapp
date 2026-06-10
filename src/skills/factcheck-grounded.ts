import type { Config } from "../config.ts";
import type { SkillRunOutput } from "../audit/contribution.ts";
import { createGeminiCapability } from "../providers/gemini-capability.ts";
import { getProvider } from "../providers/registry.ts";
import { resolveProvider } from "../providers/resolve.ts";
import { emitGroundedCallEvent } from "../telemetry/audit-events.ts";
import { getLlmClient, parseJsonResponse, LLM_MODEL } from "./llm.ts";
import { claimConfidence, formatCitation, extractClaimsPrompt } from "./factcheck.ts";
import type { ClaimType, Finding, Skill, SkillResult, Source } from "./types.ts";
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
} from "../audit/document.ts";
import { sanitizeProviderError, type AuditClaim, type AuditRecord, type ClaimDecision, type FactAssessment, type ProviderAttempt } from "../audit/types.ts";
import { RETRYABLE_STATUS_CODES } from "../audit/provider-contract.ts";

interface GeminiGroundedChunk {
  web?: {
    uri?: string;
    title?: string;
  };
}

interface GeminiGroundingSupport {
  groundingChunkIndices?: number[];
  segment?: {
    text?: string;
  };
}

interface GeminiGroundingMetadata {
  groundingChunks?: GeminiGroundedChunk[];
  groundingSupports?: GeminiGroundingSupport[];
  webSearchQueries?: string[];
}

interface GeminiGroundedResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
      }>;
    };
    groundingMetadata?: GeminiGroundingMetadata;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

interface GroundedAssessment {
  supported: boolean | null;
  note: string;
}

interface GroundedClaimResult {
  claim: string;
  assessment: GroundedAssessment;
  sources: Source[];
  webSearchQueries: string[];
  attempts: ProviderAttemptDraft[];
  providerError?: boolean;
}

type ProviderAttemptDraft = Omit<ProviderAttempt, "id">;

const GEMINI_GROUNDED_MODEL = LLM_MODEL.gemini;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export class FactCheckGroundedSkill implements Skill {
  readonly id = "fact-check-grounded";
  readonly name = "Fact Check (Grounded)";

  async run(text: string, config: Config): Promise<SkillRunOutput> {
    const standardTierSelected = config.factCheckTierFlag === true && config.factCheckTier === "standard";
    const resolved = resolveProvider(config, "fact-check");
    if (standardTierSelected && resolved?.provider !== "gemini-grounded") {
      if (!config.geminiApiKey) {
        return skippedResult(this, "gemini-grounded API key missing");
      }
      return this.#runGrounded(text, config, {
        provider: "gemini-grounded",
        apiKey: config.geminiApiKey,
        metadata: getProvider("fact-check", "gemini-grounded"),
      });
    }

    if (!resolved) {
      if (!config.geminiApiKey) {
        return skippedResult(this, "gemini-grounded API key missing");
      }
      return this.#runGrounded(text, config, {
        provider: "gemini-grounded",
        apiKey: config.geminiApiKey,
        metadata: getProvider("fact-check", "gemini-grounded"),
      });
    }
    if (resolved.provider !== "gemini-grounded") {
      if (config.providers?.["fact-check"]?.provider) {
        return skippedResult(this, `${resolved.provider} not implemented for grounded fact-check`);
      }
      if (!config.geminiApiKey) {
        return skippedResult(this, "gemini-grounded API key missing");
      }
      return this.#runGrounded(text, config, {
        provider: "gemini-grounded",
        apiKey: config.geminiApiKey,
        metadata: getProvider("fact-check", "gemini-grounded"),
      });
    }
    if (!resolved.apiKey) {
      return skippedResult(this, "gemini-grounded API key missing");
    }

    return this.#runGrounded(text, config, resolved);
  }

  async #runGrounded(
    text: string,
    config: Config,
    resolved: NonNullable<ReturnType<typeof resolveProvider>>,
  ): Promise<SkillRunOutput> {
    const apiKey = resolved.apiKey;
    if (!apiKey) {
      return skippedResult(this, "gemini-grounded API key missing");
    }

    const llm = getLlmClient({ ...config, geminiApiKey: config.geminiApiKey ?? apiKey });
    if (!llm) {
      return skippedResult(this, "no LLM key configured for claim extraction");
    }

    const documentAnalysis = analyzeDocument(text);
    const claims = await extractClaims(text, llm.call);
    if (claims.length === 0) {
      return {
        skillId: this.id,
        name: this.name,
        score: 60,
        verdict: "warn",
        summary: "No specific verifiable claims detected",
        findings: [{
          severity: "warn",
          text: "No checkable statistics, dates, or research findings found — adding cited facts (studies, percentages, named data) increases credibility and SEO authority",
        }],
        costUsd: 0.001,
        provider: resolved.provider,
      };
    }

    const findings: Finding[] = [];
    const perClaimCost = resolved.metadata?.costPerCheckUsd ?? 0.04;
    let costUsd = 0.001;

    const budget = createAuditBudget(config, "standard");
    const claimSelection = selectClaimsForAudit(claims, budget);
    const groundedResults: GroundedClaimResult[] = [];
    const runtimeSkippedClaims: Array<{ claim: string; skipReason: AuditBudgetStopReason }> = [];
    const checkedClaims = claimSelection.checkedClaims;
    const budgetStartedAt = Date.now();
    let providerRetries = 0;
    let providerFailures = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    for (const [index, claim] of checkedClaims.entries()) {
      const stopKey = shouldStopForBudget(budget, {
        costUsd,
        providerCalls: groundedResults.length,
        wallClockMs: Date.now() - budgetStartedAt,
        providerRetries,
        providerFailures,
        inputTokens,
        outputTokens,
      });
      if (stopKey) {
        const skipReason = budgetStopReasonFromKey(stopKey);
        runtimeSkippedClaims.push(
          ...checkedClaims.slice(index).map((skippedClaim) => ({ claim: skippedClaim, skipReason })),
        );
        break;
      }
      const grounded = await assessClaimGrounded(
        claim,
        apiKey,
        perClaimCost,
        remainingProviderRetries(budget.maxProviderRetries, providerRetries),
      );
      costUsd += perClaimCost;
      groundedResults.push({ claim, ...grounded });
      providerRetries += grounded.attempts.filter((attempt) => attempt.status === "retry").length;
      providerFailures += grounded.attempts.filter((attempt) => attempt.status === "failed").length;
      inputTokens += sumAttemptTokens(grounded.attempts, "inputTokens");
      outputTokens += sumAttemptTokens(grounded.attempts, "outputTokens");
    }

    const baseAudit = createAuditRecordBase(this.id, text);
    const auditId = baseAudit.auditId;
    const auditClaims: AuditClaim[] = [];
    const claimDecisions: ClaimDecision[] = [];
    const factAssessments: FactAssessment[] = [];
    const attemptIdsByResult = new Map<number, string[]>();
    const providerAttempts: ProviderAttempt[] = [];
    for (const [resultIndex, result] of groundedResults.entries()) {
      const ids: string[] = [];
      for (const attempt of result.attempts) {
        const id = `attempt-${providerAttempts.length + 1}`;
        ids.push(id);
        providerAttempts.push({ id, ...attempt });
      }
      attemptIdsByResult.set(resultIndex, ids);
    }

    for (const [index, { claim, assessment, sources, webSearchQueries, providerError }] of groundedResults.entries()) {
      const supported = providerError ? null : sources.length === 0 && assessment.supported === true ? null : assessment.supported;
      const confidence = providerError ? "low" : claimConfidence(sources.length, supported);
      const queryHint = webSearchQueries.length > 0 ? ` Search: ${webSearchQueries.slice(0, 2).join(" | ")}` : "";
      const base = { sources, confidence, claimType: "general" as ClaimType };
      const located = locateQuote(text, claim, documentAnalysis);
      const claimId = `claim-${index + 1}`;
      const assessmentId = `assessment-${index + 1}`;
      const status = providerError ? "provider_error" : supported === false ? "unsupported" : supported === null ? "unverified" : "supported";
      const rationale = providerError ? "Provider attempt failed; review manually." : confidenceRationale(sources.length, confidence);
      const rewrite = status === "supported" || status === "provider_error" ? undefined : factRewriteSuggestion(located.quote, located.language, supported, assessment.note);
      auditClaims.push({
        id: claimId,
        quote: located.quote,
        normalizedClaim: claim,
        type: "general",
        language: located.language,
        direction: located.direction,
        location: located.location,
        searchQueries: webSearchQueries.length ? webSearchQueries : [claim],
      });
      claimDecisions.push({ claimId, decision: "checked" });
      factAssessments.push({
        id: assessmentId,
        claimId,
        status,
        sources: sources.map((source) => ({
          url: source.url,
          title: source.title,
          quote: source.quote,
          accepted: true,
        })),
        explanation: assessment.note,
        confidence,
        confidenceRationale: rationale,
        searchQueries: webSearchQueries.length ? webSearchQueries : [claim],
        provider: resolved.provider,
        model: GEMINI_GROUNDED_MODEL,
        attemptIds: attemptIdsByResult.get(index) ?? [],
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
        explanation: assessment.note,
        explanationLanguage: located.language,
        explanationDir: located.direction,
        confidenceRationale: rationale,
        searchQueries: webSearchQueries.length ? webSearchQueries : [claim],
        provider: resolved.provider,
        model: GEMINI_GROUNDED_MODEL,
        auditRef: { auditId, claimId, assessmentId },
        rewrite,
      } satisfies Partial<Finding>;
      if (providerError) {
        findings.push({
          severity: "warn",
          text: `Provider error (${confidence} confidence): "${claim}" — ${assessment.note}${queryHint}`,
          ...base,
          ...auditFields,
        });
      } else if (supported === false) {
        findings.push({
          severity: "error",
          text: `Unsupported (${confidence} confidence): "${claim}" — ${assessment.note}${queryHint}`,
          ...base,
          ...auditFields,
        });
      } else if (supported === null) {
        findings.push({
          severity: "warn",
          text: `Unverified (${confidence} confidence): "${claim}" — ${sources.length === 0 ? "No grounded source URL was returned." : assessment.note}${queryHint}`,
          ...base,
          ...auditFields,
        });
      } else {
        const citations = sources.slice(0, 2).map((source) => formatCitation(source.url)).join(", ");
        findings.push({
          severity: "info",
          text: `Verified (${confidence} confidence): "${claim}" — ${assessment.note}${citations ? `. Cite: ${citations}` : ""}${queryHint}`,
          ...base,
          ...auditFields,
        });
      }
    }

    const skippedClaims = [...runtimeSkippedClaims, ...claimSelection.skippedClaims];
    for (const [offset, skipped] of skippedClaims.entries()) {
      const claim = skipped.claim;
      const located = locateQuote(text, claim, documentAnalysis);
      const claimId = `claim-${groundedResults.length + offset + 1}`;
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

    const failCount = findings.filter((finding) => finding.severity === "error").length;
    const warnCount = findings.filter((finding) => finding.severity === "warn").length;
    const providerErrorCount = findings.filter((finding) => finding.status === "provider_error").length;
    const noCheckedClaims = groundedResults.length === 0 && claims.length > 0;
    const score = noCheckedClaims ? 60 : Math.round(100 - failCount * 25 - warnCount * 10);
    const verdict = noCheckedClaims ? "warn" : failCount > 0 ? "fail" : providerErrorCount > 0 ? "warn" : warnCount > 1 ? "warn" : "pass";
    const summary = `${groundedResults.length} claims checked — ${failCount} unsupported, ${warnCount} unverified (via gemini-grounded)`;

    const result: SkillResult = {
      skillId: this.id,
      name: this.name,
      score: Math.max(0, score),
      verdict,
      summary,
      findings,
      costUsd,
      provider: resolved.provider,
    };
    const audit: AuditRecord = {
      ...baseAudit,
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
    return { ...result, audit };
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

async function extractClaims(
  text: string,
  call: (prompt: string, maxTokens?: number) => Promise<string>,
): Promise<string[]> {
  const claimsText = await call(extractClaimsPrompt(text), 1024);

  try {
    const parsed = parseJsonResponse<string[]>(claimsText);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 20) : [];
  } catch {
    return [];
  }
}

// Module-level cursor for deterministic E2E claim-by-claim replay. Reset when
// the active scenario changes so multiple tests in a row don't bleed state.
let _e2eGroundedCursor = 0;
let _e2eGroundedScenarioName: string | null = null;

async function assessClaimGrounded(
  claim: string,
  apiKey: string,
  perClaimCost: number,
  retriesLeft = 1,
): Promise<Omit<GroundedClaimResult, "claim">> {
  if (isE2E()) {
    const s = loadScenario();
    if (s.name !== _e2eGroundedScenarioName) {
      _e2eGroundedScenarioName = s.name;
      _e2eGroundedCursor = 0;
    }
    const mockClaims = s.providers.geminiGrounded?.claims ?? [];
    if (mockClaims.length === 0) {
      return {
        assessment: { supported: null, note: "No grounded claims in scenario" },
        sources: [],
        webSearchQueries: [],
        attempts: [{
          provider: "gemini-grounded",
          model: GEMINI_GROUNDED_MODEL,
          status: "skipped",
        }],
      };
    }
    const mock = mockClaims[_e2eGroundedCursor % mockClaims.length]!;
    _e2eGroundedCursor += 1;
    return {
      assessment: { supported: mock.supported, note: mock.note },
      sources: mock.sources.map((uri) => ({ url: uri, title: formatCitation(uri) })),
      webSearchQueries: [mock.claim],
      attempts: [{
        provider: "gemini-grounded",
        model: GEMINI_GROUNDED_MODEL,
        status: "success",
      }],
    };
  }

  assertMocksOnly("gemini-grounded");
  const { response, attempts, errorMessage } = await fetchGroundedAssessment(
    claim,
    apiKey,
    createGeminiCapability({ apiKey }).getModel("grounded"),
    retriesLeft,
    perClaimCost,
  );
  if (errorMessage || !response) {
    return {
      assessment: { supported: null, note: errorMessage ?? "Gemini grounded provider did not return a usable response." },
      sources: [],
      webSearchQueries: [claim],
      attempts,
      providerError: true,
    };
  }
  const candidate = response.candidates?.[0];
  const text = (candidate?.content?.parts ?? [])
    .filter((part) => part.thought !== true)
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();

  const assessment = parseGroundedAssessment(text);
  const groundingMetadata = candidate?.groundingMetadata;
  return {
    assessment,
    sources: extractGroundingSources(groundingMetadata),
    webSearchQueries: groundingMetadata?.webSearchQueries ?? [],
    attempts,
  };
}

interface GeminiGroundedFetchResult {
  response?: GeminiGroundedResponse;
  attempts: ProviderAttemptDraft[];
  errorMessage?: string;
}

async function fetchGroundedAssessment(
  claim: string,
  apiKey: string,
  model: string,
  retriesLeft: number,
  perClaimCost: number,
  attempts: ProviderAttemptDraft[] = [],
): Promise<GeminiGroundedFetchResult> {
  const startedAt = Date.now();
  const emitAttempt = (payload: Record<string, unknown>) =>
    emitGroundedCallEvent({
      provider: "gemini-grounded",
      model,
      claimPreview: claim.slice(0, 160),
      retriesLeft,
      costUsd: perClaimCost,
      ...payload,
    });

  let response: Response;
  try {
    response = await fetch(
      `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: buildGroundedPrompt(claim),
            }],
          }],
          tools: [{ google_search: {} }],
          generationConfig: {
            maxOutputTokens: 8192,
            temperature: 0.1,
            thinkingConfig: { thinkingLevel: "high" },
          },
        }),
      },
    );
  } catch (error) {
    const errorMessage = sanitizeProviderError(error instanceof Error ? error.message : String(error));
    emitAttempt({
      httpStatus: null,
      latencyMs: Date.now() - startedAt,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      error: errorMessage,
    });
    if (retriesLeft > 0) {
      attempts.push({
        provider: "gemini-grounded",
        model,
        status: "retry",
        retryable: true,
        errorMessage,
      });
      await sleep(groundedRetryDelayMs());
      return fetchGroundedAssessment(claim, apiKey, model, retriesLeft - 1, perClaimCost, attempts);
    }
    attempts.push({
      provider: "gemini-grounded",
      model,
      status: "failed",
      retryable: true,
      errorMessage,
    });
    return {
      attempts,
      errorMessage: errorMessage || "Gemini grounded provider request failed.",
    };
  }

  const latencyMs = Date.now() - startedAt;

  if (RETRYABLE_STATUS_CODES.has(response.status) && retriesLeft > 0) {
    attempts.push({
      provider: "gemini-grounded",
      model,
      status: "retry",
      retryable: true,
      statusCode: response.status,
    });
    emitAttempt({
      httpStatus: response.status,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    await sleep(Math.max(computeRetryAfterDelayMs(response.headers.get("retry-after")), groundedRetryDelayMs()));
    return fetchGroundedAssessment(claim, apiKey, model, retriesLeft - 1, perClaimCost, attempts);
  }

  if (!response.ok) {
    const errorMessage = `Gemini grounded error: HTTP ${response.status}`;
    attempts.push({
      provider: "gemini-grounded",
      model,
      status: "failed",
      retryable: RETRYABLE_STATUS_CODES.has(response.status),
      statusCode: response.status,
      errorMessage,
    });
    emitAttempt({
      httpStatus: response.status,
      latencyMs,
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
    });
    return { attempts, errorMessage };
  }

  const data = (await response.json()) as GeminiGroundedResponse;
  attempts.push({
    provider: "gemini-grounded",
    model,
    status: "success",
    statusCode: response.status,
    inputTokens: data.usageMetadata?.promptTokenCount,
    outputTokens: data.usageMetadata?.candidatesTokenCount,
    totalTokens: data.usageMetadata?.totalTokenCount,
  });
  emitAttempt({
    httpStatus: response.status,
    latencyMs,
    inputTokens: data.usageMetadata?.promptTokenCount ?? null,
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? null,
    totalTokens: data.usageMetadata?.totalTokenCount ?? null,
  });
  return { response: data, attempts };
}

function sumAttemptTokens(attempts: ProviderAttemptDraft[], key: "inputTokens" | "outputTokens"): number {
  return attempts.reduce((sum, attempt) => sum + (attempt[key] ?? 0), 0);
}

function remainingProviderRetries(maxProviderRetries: number, providerRetriesUsed: number): number {
  return Math.max(0, Math.floor(maxProviderRetries) - providerRetriesUsed);
}

export function computeRetryAfterDelayMs(retryAfterHeader: string | null): number {
  const retryAfterSeconds = Number(retryAfterHeader);
  return Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
    ? Math.min(retryAfterSeconds * 1000, 30_000)
    : 0;
}

function groundedRetryDelayMs(): number {
  const configured = Number(process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 3_000;
}

function buildGroundedPrompt(claim: string): string {
  return [
    "Use Google Search grounding to assess whether this claim is supported by current, credible sources.",
    `Claim: "${claim}"`,
    'Return a short explanation and include a JSON object exactly in this shape somewhere in the response: {"supported":true|false|null,"note":"string"}',
    "Set supported=true when the claim is well-supported, false when evidence contradicts it, and null when evidence is insufficient or mixed.",
    "Keep note to one sentence.",
  ].join("\n\n");
}

function parseGroundedAssessment(raw: string): GroundedAssessment {
  const parsed = extractJsonObject(raw);
  if (parsed && typeof parsed === "object") {
    const supportedValue = (parsed as Record<string, unknown>).supported;
    const noteValue = (parsed as Record<string, unknown>).note;
    return {
      supported: supportedValue === true ? true : supportedValue === false ? false : null,
      note: typeof noteValue === "string" && noteValue.trim() ? noteValue.trim() : fallbackNote(raw),
    };
  }

  return { supported: null, note: fallbackNote(raw) };
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  const candidates: string[] = [trimmed];

  const fencedMatches = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/gi) ?? [];
  for (const match of fencedMatches) {
    const inner = match.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (inner) candidates.push(inner);
  }

  const objectStrings = findBalancedObjects(trimmed);
  candidates.push(...objectStrings);

  for (const candidate of candidates) {
    try {
      const parsed = parseJsonResponse<Record<string, unknown>>(candidate);
      if ("supported" in parsed || "note" in parsed) return parsed;
    } catch {
      // Continue searching for an embedded JSON object.
    }
  }

  return null;
}

function findBalancedObjects(raw: string): string[] {
  const matches: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (char === "}") {
      if (depth === 0) continue;
      depth--;
      if (depth === 0 && start >= 0) {
        matches.push(raw.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return matches;
}

function fallbackNote(raw: string): string {
  const cleaned = raw
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || "Could not assess";
}

function extractGroundingSources(metadata?: GeminiGroundingMetadata): Source[] {
  if (!metadata?.groundingChunks?.length) return [];

  const quoteByIndex = new Map<number, string>();
  for (const support of metadata.groundingSupports ?? []) {
    const quote = support.segment?.text?.trim();
    if (!quote) continue;
    for (const index of support.groundingChunkIndices ?? []) {
      if (!quoteByIndex.has(index)) quoteByIndex.set(index, quote);
    }
  }

  const sources: Source[] = [];
  metadata.groundingChunks.forEach((chunk, index) => {
    const url = chunk.web?.uri;
    if (!url || !isHttpUrl(url)) return;
    sources.push({
      url,
      title: chunk.web?.title,
      quote: quoteByIndex.get(index),
    });
  });

  return dedupeSources(sources).slice(0, 5);
}

function dedupeSources(sources: Source[]): Source[] {
  const byUrl = new Map<string, Source>();
  for (const source of sources) {
    const existing = byUrl.get(source.url);
    if (!existing) {
      byUrl.set(source.url, source);
      continue;
    }
    byUrl.set(source.url, {
      ...existing,
      title: existing.title ?? source.title,
      quote: existing.quote ?? source.quote,
    });
  }
  return [...byUrl.values()];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function skippedResult(skill: FactCheckGroundedSkill, reason: string): SkillResult {
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
