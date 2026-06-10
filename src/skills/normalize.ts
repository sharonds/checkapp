import type { Finding, SkillResult, Source, Citation } from "./types.ts";
import type { AuditDirection, AuditLanguage, AuditLocation, AuditRef, AuditStatus } from "../audit/types.ts";

function isSource(x: unknown): x is Source {
  return typeof x === "object" && x !== null && typeof (x as any).url === "string";
}

function isCitation(x: unknown): x is Citation {
  return typeof x === "object" && x !== null && typeof (x as any).title === "string";
}

function normalizeLocation(value: unknown): AuditLocation | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.sectionId !== "string" || typeof raw.paragraphIndex !== "number") return undefined;
  return {
    sectionId: raw.sectionId,
    sectionTitle: typeof raw.sectionTitle === "string" ? raw.sectionTitle : undefined,
    paragraphIndex: raw.paragraphIndex,
    sentenceIndex: typeof raw.sentenceIndex === "number" ? raw.sentenceIndex : undefined,
    startOffset: typeof raw.startOffset === "number" ? raw.startOffset : undefined,
    endOffset: typeof raw.endOffset === "number" ? raw.endOffset : undefined,
    matchQuality: raw.matchQuality === "exact" || raw.matchQuality === "fuzzy" || raw.matchQuality === "none" ? raw.matchQuality : undefined,
  };
}

function normalizeAuditRef(value: unknown): AuditRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.auditId !== "string") return undefined;
  return {
    auditId: raw.auditId,
    claimId: typeof raw.claimId === "string" ? raw.claimId : undefined,
    assessmentId: typeof raw.assessmentId === "string" ? raw.assessmentId : undefined,
    plagiarismFindingId: typeof raw.plagiarismFindingId === "string" ? raw.plagiarismFindingId : undefined,
  };
}

export function normalizeFinding(raw: unknown): Finding {
  if (!raw || typeof raw !== "object") return { severity: "info", text: "" };
  const f = raw as Partial<Finding> & Record<string, unknown>;
  const validSeverities = ["info", "warn", "error"] as const;
  const validClaimTypes = ["scientific", "medical", "financial", "general"] as const;
  const validConfidences = ["high", "medium", "low"] as const;
  const validAuditStatuses = ["supported", "unsupported", "partially_supported", "unverified", "provider_error", "plagiarism_match"] as const;
  const validLanguages = ["en", "he", "mixed", "other"] as const;
  const validDirections = ["ltr", "rtl", "auto"] as const;
  const validMatchTypes = ["exact", "near", "semantic", "translated", "unknown"] as const;
  const validGroundingModes = ["grounded", "mixed", "ungrounded"] as const;
  return {
    severity: validSeverities.includes(f.severity as never) ? (f.severity as Finding["severity"]) : "info",
    text: typeof f.text === "string" ? f.text : "",
    quote: typeof f.quote === "string" ? f.quote : undefined,
    sources: Array.isArray(f.sources) ? f.sources.filter(isSource) : undefined,
    rewrite: typeof f.rewrite === "string" ? f.rewrite : undefined,
    citations: Array.isArray(f.citations) ? f.citations.filter(isCitation) : undefined,
    claimType: validClaimTypes.includes(f.claimType as never) ? (f.claimType as Finding["claimType"]) : undefined,
    confidence: validConfidences.includes(f.confidence as never) ? (f.confidence as Finding["confidence"]) : undefined,
    id: typeof f.id === "string" ? f.id : undefined,
    status: validAuditStatuses.includes(f.status as never) ? (f.status as AuditStatus) : undefined,
    location: normalizeLocation(f.location),
    explanation: typeof f.explanation === "string" ? f.explanation : undefined,
    explanationLanguage: validLanguages.includes(f.explanationLanguage as never) ? (f.explanationLanguage as AuditLanguage) : undefined,
    explanationDir: validDirections.includes(f.explanationDir as never) ? (f.explanationDir as AuditDirection) : undefined,
    confidenceRationale: typeof f.confidenceRationale === "string" ? f.confidenceRationale : undefined,
    searchQueries: Array.isArray(f.searchQueries) ? f.searchQueries.filter((q): q is string => typeof q === "string") : undefined,
    provider: typeof f.provider === "string" ? f.provider : undefined,
    model: typeof f.model === "string" ? f.model : undefined,
    auditRef: normalizeAuditRef(f.auditRef),
    matchType: validMatchTypes.includes(f.matchType as never) ? (f.matchType as Finding["matchType"]) : undefined,
    groundingMode: validGroundingModes.includes(f.groundingMode as never) ? (f.groundingMode as Finding["groundingMode"]) : undefined,
  };
}

export function normalizeSkillResult(raw: unknown): SkillResult {
  if (!raw || typeof raw !== "object") {
    return { skillId: "", name: "", score: 0, verdict: "warn", summary: "", findings: [], costUsd: 0 };
  }
  const r = raw as Partial<SkillResult> & Record<string, unknown>;
  const validVerdicts = ["pass", "warn", "fail", "skipped"] as const;
  return {
    skillId: typeof r.skillId === "string" ? r.skillId : (typeof r.skill_id === "string" ? r.skill_id : ""),
    name: typeof r.name === "string" ? r.name : "",
    score: typeof r.score === "number" ? r.score : 0,
    verdict: validVerdicts.includes(r.verdict as never) ? (r.verdict as SkillResult["verdict"]) : "warn",
    summary: typeof r.summary === "string" ? r.summary : "",
    findings: Array.isArray(r.findings) ? r.findings.map(normalizeFinding) : [],
    costUsd: typeof r.costUsd === "number" ? r.costUsd : (typeof r.cost_usd === "number" ? r.cost_usd : 0),
    costBreakdown: (r.costBreakdown && typeof r.costBreakdown === "object" && !Array.isArray(r.costBreakdown))
      ? (r.costBreakdown as Record<string, number>)
      : undefined,
    provider: typeof r.provider === "string" ? r.provider : undefined,
    error: typeof r.error === "string" ? r.error : undefined,
  };
}
