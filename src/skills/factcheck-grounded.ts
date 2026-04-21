import type { Config } from "../config.ts";
import { resolveProvider } from "../providers/resolve.ts";
import { getLlmClient, parseJsonResponse, LLM_MODEL } from "./llm.ts";
import { claimConfidence, formatCitation, extractClaimsPrompt } from "./factcheck.ts";
import type { ClaimType, Finding, Skill, SkillResult, Source } from "./types.ts";

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
}

const GEMINI_GROUNDED_MODEL = LLM_MODEL.gemini;
const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export class FactCheckGroundedSkill implements Skill {
  readonly id = "fact-check-grounded";
  readonly name = "Fact Check (Grounded)";

  async run(text: string, config: Config): Promise<SkillResult> {
    const resolved = resolveProvider(config, "fact-check");
    if (!resolved) {
      return skippedResult(this, "no fact-check provider configured");
    }
    if (resolved.provider !== "gemini-grounded") {
      return skippedResult(this, `${resolved.provider} not implemented for grounded fact-check`);
    }
    if (!resolved.apiKey) {
      return skippedResult(this, "gemini-grounded API key missing");
    }

    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id,
        name: this.name,
        score: 50,
        verdict: "warn",
        summary: "Skipped — no LLM key configured for claim extraction",
        findings: [{ severity: "info", text: "Add an LLM API key to extract fact-checkable claims before grounded verification runs" }],
        costUsd: 0,
        provider: resolved.provider,
      };
    }

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
    const perClaimCost = resolved.metadata?.costPerCheckUsd ?? 0.01;
    let costUsd = 0.001;

    const groundedResults: GroundedClaimResult[] = [];
    for (const claim of claims.slice(0, 4)) {
      const grounded = await assessClaimGrounded(claim, resolved.apiKey);
      costUsd += perClaimCost;
      groundedResults.push({ claim, ...grounded });
    }

    for (const { claim, assessment, sources, webSearchQueries } of groundedResults) {
      const confidence = claimConfidence(sources.length, assessment.supported);
      const queryHint = webSearchQueries.length > 0 ? ` Search: ${webSearchQueries.slice(0, 2).join(" | ")}` : "";
      const base = { sources, confidence, claimType: "general" as ClaimType };
      if (assessment.supported === false) {
        findings.push({
          severity: "error",
          text: `Unsupported (${confidence} confidence): "${claim}" — ${assessment.note}${queryHint}`,
          ...base,
        });
      } else if (assessment.supported === null) {
        findings.push({
          severity: "warn",
          text: `Unverified (${confidence} confidence): "${claim}" — ${assessment.note}${queryHint}`,
          ...base,
        });
      } else {
        const citations = sources.slice(0, 2).map((source) => formatCitation(source.url)).join(", ");
        findings.push({
          severity: "info",
          text: `Verified (${confidence} confidence): "${claim}" — ${assessment.note}${citations ? `. Cite: ${citations}` : ""}${queryHint}`,
          ...base,
        });
      }
    }

    const failCount = findings.filter((finding) => finding.severity === "error").length;
    const warnCount = findings.filter((finding) => finding.severity === "warn").length;
    const score = Math.round(100 - failCount * 25 - warnCount * 10);
    const verdict = failCount > 0 ? "fail" : warnCount > 1 ? "warn" : "pass";
    const summary = `${groundedResults.length} claims checked — ${failCount} unsupported, ${warnCount} unverified (via gemini-grounded)`;

    return {
      skillId: this.id,
      name: this.name,
      score: Math.max(0, score),
      verdict,
      summary,
      findings,
      costUsd,
      provider: resolved.provider,
    };
  }
}

async function extractClaims(
  text: string,
  call: (prompt: string, maxTokens?: number) => Promise<string>,
): Promise<string[]> {
  const claimsText = await call(extractClaimsPrompt(text), 1024);

  try {
    const parsed = parseJsonResponse<string[]>(claimsText);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string").slice(0, 4) : [];
  } catch {
    return [];
  }
}

async function assessClaimGrounded(claim: string, apiKey: string): Promise<Omit<GroundedClaimResult, "claim">> {
  const response = await fetchGroundedAssessment(claim, apiKey, 1);
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
  };
}

async function fetchGroundedAssessment(
  claim: string,
  apiKey: string,
  retriesLeft: number,
): Promise<GeminiGroundedResponse> {
  const response = await fetch(
    `${GEMINI_BASE_URL}/${GEMINI_GROUNDED_MODEL}:generateContent?key=${apiKey}`,
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

  if ((response.status === 500 || response.status === 503) && retriesLeft > 0) {
    await sleep(150);
    return fetchGroundedAssessment(claim, apiKey, retriesLeft - 1);
  }

  if (!response.ok) {
    throw new Error(`Gemini grounded error: HTTP ${response.status}`);
  }

  return (await response.json()) as GeminiGroundedResponse;
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
    if (!url) return;
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
