export type AuditLanguage = "en" | "he" | "mixed" | "other";
export type AuditDirection = "ltr" | "rtl" | "auto";
export type AuditStatus =
  | "supported"
  | "unsupported"
  | "partially_supported"
  | "unverified"
  | "provider_error"
  | "plagiarism_match";
export type AuditClaimType =
  | "product-spec"
  | "date"
  | "statistic"
  | "scientific"
  | "medical"
  | "financial"
  | "legal"
  | "general";

export interface AuditLocation {
  sectionId: string;
  sectionTitle?: string;
  paragraphIndex: number;
  sentenceIndex?: number;
  startOffset?: number;
  endOffset?: number;
  matchQuality?: "exact" | "fuzzy" | "none";
}

export interface AuditRef {
  auditId: string;
  claimId?: string;
  assessmentId?: string;
  plagiarismFindingId?: string;
}

export interface AuditFindingExtension {
  id: string;
  status: AuditStatus;
  location?: AuditLocation;
  explanation?: string;
  explanationLanguage?: AuditLanguage;
  explanationDir?: AuditDirection;
  confidenceRationale?: string;
  searchQueries?: string[];
  provider?: string;
  model?: string;
  auditRef?: AuditRef;
}

export interface AuditCoverage {
  wordsScanned: number;
  sectionsDetected: number;
  paragraphsScanned: number;
  sentencesScanned: number;
  claimsExtracted: number;
  claimsChecked: number;
  claimsSkipped: number;
  skipReasons: Record<string, number>;
  plagiarismPassagesChecked: number;
  plagiarismPassagesSkipped: number;
  providerFailures: number;
  providerRetries: number;
  budgetStopReason?: string;
}

export interface AuditSegment {
  id: string;
  sectionId?: string;
  text: string;
  language?: AuditLanguage;
  direction?: AuditDirection;
  sectionTitle?: string;
  paragraphIndex: number;
  sentenceIndex?: number;
  startOffset?: number;
  endOffset?: number;
}

export interface AuditClaim {
  id: string;
  quote: string;
  normalizedClaim: string;
  type: AuditClaimType;
  language?: AuditLanguage;
  direction?: AuditDirection;
  location?: AuditLocation;
  searchQueries?: string[];
}

export interface ClaimDecision {
  claimId: string;
  decision: "checked" | "skipped";
  skipReason?: string;
  duplicateOfClaimId?: string;
}

export interface AuditSource {
  url: string;
  title?: string;
  quote?: string;
  accepted?: boolean;
}

export interface FactAssessment {
  id: string;
  claimId: string;
  status: Exclude<AuditStatus, "plagiarism_match">;
  sources: AuditSource[];
  explanation?: string;
  confidence?: "high" | "medium" | "low";
  confidenceRationale?: string;
  searchQueries?: string[];
  provider?: string;
  model?: string;
  attemptIds?: string[];
  language?: AuditLanguage;
  direction?: AuditDirection;
  rewrite?: string;
  rewriteLanguage?: AuditLanguage;
  rewriteDir?: AuditDirection;
}

export interface PlagiarismFinding {
  id: string;
  quote: string;
  source: AuditSource;
  status: "plagiarism_match";
  confidence?: "high" | "medium" | "low";
  confidenceRationale?: string;
  passageIds?: string[];
  matchType?: "exact" | "near" | "semantic" | "translated" | "unknown";
  groundingMode?: "grounded" | "mixed" | "ungrounded";
  matchedText?: string;
  remediation?: string;
  provider?: string;
  model?: string;
  language?: AuditLanguage;
  direction?: AuditDirection;
  location?: AuditLocation;
}

export interface ProviderAttempt {
  id: string;
  provider: string;
  model?: string;
  status: "success" | "retry" | "failed" | "skipped";
  retryable?: boolean;
  statusCode?: number;
  errorMessage?: string;
}

export interface AuditRecord {
  version: 1;
  auditId: string;
  language: AuditLanguage;
  direction: AuditDirection;
  coverage: AuditCoverage;
  segments: AuditSegment[];
  claims: AuditClaim[];
  claimDecisions: ClaimDecision[];
  factAssessments: FactAssessment[];
  plagiarismFindings: PlagiarismFinding[];
  providerAttempts: ProviderAttempt[];
  createdAt: string;
}

const LANGUAGES = new Set(["en", "he", "mixed", "other"]);
const DIRECTIONS = new Set(["ltr", "rtl", "auto"]);
const AUDIT_STATUSES = new Set(["supported", "unsupported", "partially_supported", "unverified", "provider_error", "plagiarism_match"]);
const FACT_STATUSES = new Set(["supported", "unsupported", "partially_supported", "unverified", "provider_error"]);
const CLAIM_TYPES = new Set(["product-spec", "date", "statistic", "scientific", "medical", "financial", "legal", "general"]);
const DECISIONS = new Set(["checked", "skipped"]);
const CONFIDENCES = new Set(["high", "medium", "low"]);
const PROVIDER_STATUSES = new Set(["success", "retry", "failed", "skipped"]);
const MATCH_TYPES = new Set(["exact", "near", "semantic", "translated", "unknown"]);
const GROUNDING_MODES = new Set(["grounded", "mixed", "ungrounded"]);
const LOCATION_MATCH_QUALITIES = new Set(["exact", "fuzzy", "none"]);

export type AuditParseResult =
  | { ok: true; value: AuditRecord }
  | { ok: false; error: string };

type AuditMigrationResult =
  | { migrated: true; value: Record<string, unknown> }
  | { migrated: false; error: string };

function migrateAuditRecord(raw: Record<string, unknown>): AuditMigrationResult {
  if (raw.version !== 1) return { migrated: false, error: "Unsupported AuditRecord version" };
  return { migrated: true, value: raw };
}

export function safeParseAuditRecord(raw: unknown): AuditParseResult {
  if (!isRecord(raw)) return { ok: false, error: "AuditRecord must be an object" };
  const migrated = migrateAuditRecord(raw);
  if (!migrated.migrated) return { ok: false, error: migrated.error };
  const record = migrated.value;
  if (typeof record.auditId !== "string" || record.auditId.length === 0) return { ok: false, error: "auditId is required" };
  if (!LANGUAGES.has(record.language as string)) return { ok: false, error: "invalid language" };
  if (!DIRECTIONS.has(record.direction as string)) return { ok: false, error: "invalid direction" };
  if (!isCoverage(record.coverage)) return { ok: false, error: "invalid coverage" };
  const segments = parseArray(record.segments, normalizeSegment);
  if (!segments.ok) return { ok: false, error: `segments: ${segments.error}` };
  const claims = parseArray(record.claims, normalizeClaim);
  if (!claims.ok) return { ok: false, error: `claims: ${claims.error}` };
  const claimDecisions = parseArray(record.claimDecisions, normalizeClaimDecision);
  if (!claimDecisions.ok) return { ok: false, error: `claimDecisions: ${claimDecisions.error}` };
  const factAssessments = parseArray(record.factAssessments, normalizeFactAssessment);
  if (!factAssessments.ok) return { ok: false, error: `factAssessments: ${factAssessments.error}` };
  const plagiarismFindings = parseArray(record.plagiarismFindings, normalizePlagiarismFinding);
  if (!plagiarismFindings.ok) return { ok: false, error: `plagiarismFindings: ${plagiarismFindings.error}` };
  const providerAttempts = parseArray(record.providerAttempts, normalizeProviderAttempt);
  if (!providerAttempts.ok) return { ok: false, error: `providerAttempts: ${providerAttempts.error}` };
  if (typeof record.createdAt !== "string") return { ok: false, error: "createdAt is required" };
  return {
    ok: true,
    value: {
      version: 1,
      auditId: record.auditId,
      language: record.language as AuditLanguage,
      direction: record.direction as AuditDirection,
      coverage: record.coverage,
      segments: segments.value,
      claims: claims.value,
      claimDecisions: claimDecisions.value,
      factAssessments: factAssessments.value,
      plagiarismFindings: plagiarismFindings.value,
      providerAttempts: providerAttempts.value,
      createdAt: record.createdAt,
    },
  };
}

export function isAuditRecord(raw: unknown): raw is AuditRecord {
  return safeParseAuditRecord(raw).ok;
}

export function parseAuditRecord(raw: unknown): AuditRecord {
  const parsed = safeParseAuditRecord(raw);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}

export function parseStoredAuditRecord(rawJson: string | null | undefined): AuditRecord | undefined {
  if (!rawJson) return undefined;
  try {
    const parsed = safeParseAuditRecord(JSON.parse(rawJson));
    return parsed.ok ? parsed.value : undefined;
  } catch {
    return undefined;
  }
}

export function serializeAuditRecord(audit: AuditRecord | null | undefined): string | null {
  if (!audit) return null;
  const parsed = safeParseAuditRecord(audit);
  return parsed.ok ? JSON.stringify(parsed.value) : null;
}

export function sanitizeAuditUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    parsed.username = "";
    parsed.password = "";
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveQueryParam(key)) parsed.searchParams.set(key, "[redacted]");
    }
    if (parsed.hash) {
      const fragment = parsed.hash.slice(1);
      const fragmentParams = new URLSearchParams(fragment);
      let redacted = false;
      for (const key of Array.from(fragmentParams.keys())) {
        if (isSensitiveQueryParam(key)) {
          fragmentParams.set(key, "[redacted]");
          redacted = true;
        }
      }
      if (redacted) parsed.hash = fragmentParams.toString();
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function isSensitiveQueryParam(key: string): boolean {
  return /(?:^|[_-])(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|key)(?:$|[_-])/i.test(key);
}

export function sanitizeProviderError(message: unknown): string {
  if (typeof message !== "string") return "";
  return message
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|key|token|secret)=([^&\s]+)/gi, "$1=[redacted]")
    .replace(/\b(?:sk|sk-live|sk-test|AIza|xai|or)-[A-Za-z0-9._-]{6,}\b/g, "[redacted]")
    .slice(0, 500);
}

function isCoverage(raw: unknown): raw is AuditCoverage {
  if (!isRecord(raw)) return false;
  const numeric = [
    "wordsScanned",
    "sectionsDetected",
    "paragraphsScanned",
    "sentencesScanned",
    "claimsExtracted",
    "claimsChecked",
    "claimsSkipped",
    "plagiarismPassagesChecked",
    "plagiarismPassagesSkipped",
    "providerFailures",
    "providerRetries",
  ];
  return numeric.every((key) => typeof raw[key] === "number" && Number.isFinite(raw[key]))
    && isRecord(raw.skipReasons);
}

function normalizeSegment(raw: unknown): AuditSegment | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.text !== "string" || typeof raw.paragraphIndex !== "number") return null;
  return {
    id: raw.id,
    sectionId: optionalString(raw.sectionId),
    text: raw.text,
    language: optionalEnum(raw.language, LANGUAGES) as AuditLanguage | undefined,
    direction: optionalEnum(raw.direction, DIRECTIONS) as AuditDirection | undefined,
    sectionTitle: optionalString(raw.sectionTitle),
    paragraphIndex: raw.paragraphIndex,
    sentenceIndex: optionalNumber(raw.sentenceIndex),
    startOffset: optionalNumber(raw.startOffset),
    endOffset: optionalNumber(raw.endOffset),
  };
}

function normalizeClaim(raw: unknown): AuditClaim | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.quote !== "string" || typeof raw.normalizedClaim !== "string") return null;
  if (!CLAIM_TYPES.has(raw.type as string)) return null;
  return {
    id: raw.id,
    quote: raw.quote,
    normalizedClaim: raw.normalizedClaim,
    type: raw.type as AuditClaimType,
    language: optionalEnum(raw.language, LANGUAGES) as AuditLanguage | undefined,
    direction: optionalEnum(raw.direction, DIRECTIONS) as AuditDirection | undefined,
    location: normalizeLocation(raw.location),
    searchQueries: optionalStringArray(raw.searchQueries),
  };
}

function normalizeClaimDecision(raw: unknown): ClaimDecision | null {
  if (!isRecord(raw) || typeof raw.claimId !== "string" || !DECISIONS.has(raw.decision as string)) return null;
  const skipReason = raw.decision === "skipped"
    ? typeof raw.skipReason === "string" ? raw.skipReason : "unknown"
    : optionalString(raw.skipReason);
  return {
    claimId: raw.claimId,
    decision: raw.decision as ClaimDecision["decision"],
    skipReason,
    duplicateOfClaimId: optionalString(raw.duplicateOfClaimId),
  };
}

function normalizeFactAssessment(raw: unknown): FactAssessment | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.claimId !== "string" || !FACT_STATUSES.has(raw.status as string) || !Array.isArray(raw.sources)) return null;
  const sources = raw.sources.map(normalizeSource).filter((source): source is AuditSource => !!source);
  const status = raw.status === "supported" && sources.every((source) => source.accepted === false) ? "unverified" : raw.status;
  return {
    id: raw.id,
    claimId: raw.claimId,
    status: status as FactAssessment["status"],
    sources,
    explanation: optionalString(raw.explanation),
    confidence: optionalEnum(raw.confidence, CONFIDENCES) as FactAssessment["confidence"],
    confidenceRationale: optionalString(raw.confidenceRationale),
    searchQueries: optionalStringArray(raw.searchQueries),
    provider: optionalString(raw.provider),
    model: optionalString(raw.model),
    attemptIds: optionalStringArray(raw.attemptIds),
    language: optionalEnum(raw.language, LANGUAGES) as AuditLanguage | undefined,
    direction: optionalEnum(raw.direction, DIRECTIONS) as AuditDirection | undefined,
    rewrite: optionalString(raw.rewrite),
    rewriteLanguage: optionalEnum(raw.rewriteLanguage, LANGUAGES) as AuditLanguage | undefined,
    rewriteDir: optionalEnum(raw.rewriteDir, DIRECTIONS) as AuditDirection | undefined,
  };
}

function normalizePlagiarismFinding(raw: unknown): PlagiarismFinding | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.quote !== "string" || raw.status !== "plagiarism_match") return null;
  const source = normalizeSource(raw.source);
  if (!source) return null;
  return {
    id: raw.id,
    quote: raw.quote,
    source,
    status: "plagiarism_match",
    confidence: optionalEnum(raw.confidence, CONFIDENCES) as PlagiarismFinding["confidence"],
    confidenceRationale: optionalString(raw.confidenceRationale),
    passageIds: optionalStringArray(raw.passageIds),
    matchType: optionalEnum(raw.matchType, MATCH_TYPES) as PlagiarismFinding["matchType"],
    groundingMode: optionalEnum(raw.groundingMode, GROUNDING_MODES) as PlagiarismFinding["groundingMode"],
    matchedText: optionalString(raw.matchedText),
    remediation: optionalString(raw.remediation),
    provider: optionalString(raw.provider),
    model: optionalString(raw.model),
    language: optionalEnum(raw.language, LANGUAGES) as AuditLanguage | undefined,
    direction: optionalEnum(raw.direction, DIRECTIONS) as AuditDirection | undefined,
    location: normalizeLocation(raw.location),
  };
}

function normalizeProviderAttempt(raw: unknown): ProviderAttempt | null {
  if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.provider !== "string" || !PROVIDER_STATUSES.has(raw.status as string)) return null;
  return {
    id: raw.id,
    provider: raw.provider,
    model: optionalString(raw.model),
    status: raw.status as ProviderAttempt["status"],
    retryable: typeof raw.retryable === "boolean" ? raw.retryable : undefined,
    statusCode: optionalNumber(raw.statusCode),
    errorMessage: raw.errorMessage === undefined ? undefined : sanitizeProviderError(raw.errorMessage),
  };
}

function normalizeSource(raw: unknown): AuditSource | null {
  if (!isRecord(raw) || typeof raw.url !== "string") return null;
  const url = sanitizeAuditUrl(raw.url);
  if (!url) return null;
  return {
    url,
    title: optionalString(raw.title),
    quote: optionalString(raw.quote),
    accepted: typeof raw.accepted === "boolean" ? raw.accepted : true,
  };
}

function normalizeLocation(raw: unknown): AuditLocation | undefined {
  if (!isRecord(raw) || typeof raw.sectionId !== "string" || typeof raw.paragraphIndex !== "number") return undefined;
  return {
    sectionId: raw.sectionId,
    sectionTitle: optionalString(raw.sectionTitle),
    paragraphIndex: raw.paragraphIndex,
    sentenceIndex: optionalNumber(raw.sentenceIndex),
    startOffset: optionalNumber(raw.startOffset),
    endOffset: optionalNumber(raw.endOffset),
    matchQuality: optionalEnum(raw.matchQuality, LOCATION_MATCH_QUALITIES) as AuditLocation["matchQuality"],
  };
}

function parseArray<T>(raw: unknown, normalize: (item: unknown) => T | null): { ok: true; value: T[] } | { ok: false; error: string } {
  if (!Array.isArray(raw)) return { ok: false, error: "must be an array" };
  const value: T[] = [];
  for (let i = 0; i < raw.length; i++) {
    const normalized = normalize(raw[i]);
    if (!normalized) return { ok: false, error: `invalid item at index ${i}` };
    value.push(normalized);
  }
  return { ok: true, value };
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : undefined;
}

function optionalEnum(value: unknown, allowed: Set<string>): string | undefined {
  return typeof value === "string" && allowed.has(value) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
