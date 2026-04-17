// MIRROR OF: ~/checkapp/src/skills/normalize.ts (+ types.ts Finding/SkillResult shapes)
// If you edit here, edit there too. Drift guard in B8 will CI-fail on divergence.

export type Verdict = "pass" | "warn" | "fail" | "skipped";
export type Severity = "info" | "warn" | "error";
export type ClaimType = "scientific" | "medical" | "financial" | "general";

function isSource(x: unknown): x is Source {
  return typeof x === "object" && x !== null && typeof (x as any).url === "string";
}

function isCitation(x: unknown): x is Citation {
  return typeof x === "object" && x !== null && typeof (x as any).title === "string";
}

export interface Source {
  url: string;
  title?: string;
  publishedDate?: string;
  quote?: string;
  relevanceScore?: number;
}

export interface Citation {
  title: string;
  authors?: string[];
  year?: number;
  doi?: string;
  url?: string;
  abstractSnippet?: string;
  relevanceScore?: number;
}

export interface Finding {
  severity: Severity;
  text: string;
  quote?: string;
  sources?: Source[];
  rewrite?: string;
  citations?: Citation[];
  claimType?: ClaimType;
  confidence?: "high" | "medium" | "low";
}

export interface SkillResult {
  skillId: string;
  name: string;
  score: number;
  verdict: Verdict;
  summary: string;
  findings: Finding[];
  costUsd: number;
  costBreakdown?: Record<string, number>;
  provider?: string;
  error?: string;
}

export function normalizeFinding(raw: unknown): Finding {
  if (!raw || typeof raw !== "object") return { severity: "info", text: "" };
  const f = raw as Partial<Finding> & Record<string, unknown>;
  const validSeverities = ["info", "warn", "error"] as const;
  const validClaimTypes = ["scientific", "medical", "financial", "general"] as const;
  const validConfidences = ["high", "medium", "low"] as const;
  return {
    severity: validSeverities.includes(f.severity as never) ? (f.severity as Finding["severity"]) : "info",
    text: typeof f.text === "string" ? f.text : "",
    quote: typeof f.quote === "string" ? f.quote : undefined,
    sources: Array.isArray(f.sources) ? f.sources.filter(isSource) : undefined,
    rewrite: typeof f.rewrite === "string" ? f.rewrite : undefined,
    citations: Array.isArray(f.citations) ? f.citations.filter(isCitation) : undefined,
    claimType: validClaimTypes.includes(f.claimType as never) ? (f.claimType as Finding["claimType"]) : undefined,
    confidence: validConfidences.includes(f.confidence as never) ? (f.confidence as Finding["confidence"]) : undefined,
  };
}

export function normalizeSkillResult(raw: unknown): SkillResult {
  if (!raw || typeof raw !== "object") {
    return { skillId: "", name: "", score: 0, verdict: "warn", summary: "", findings: [], costUsd: 0 };
  }
  const r = raw as Partial<SkillResult> & Record<string, unknown>;
  const validVerdicts = ["pass", "warn", "fail"] as const;
  return {
    skillId: typeof r.skillId === "string" ? r.skillId : (typeof r.skill_id === "string" ? (r.skill_id as string) : ""),
    name: typeof r.name === "string" ? r.name : "",
    score: typeof r.score === "number" ? r.score : 0,
    verdict: validVerdicts.includes(r.verdict as never) ? (r.verdict as SkillResult["verdict"]) : "warn",
    summary: typeof r.summary === "string" ? r.summary : "",
    findings: Array.isArray(r.findings) ? r.findings.map(normalizeFinding) : [],
    costUsd: typeof r.costUsd === "number" ? r.costUsd : (typeof r.cost_usd === "number" ? (r.cost_usd as number) : 0),
    costBreakdown: r.costBreakdown && typeof r.costBreakdown === "object" && !Array.isArray(r.costBreakdown) ? (r.costBreakdown as Record<string, number>) : undefined,
    provider: typeof r.provider === "string" ? r.provider : undefined,
    error: typeof r.error === "string" ? r.error : undefined,
  };
}
