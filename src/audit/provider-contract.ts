import type { AuditSource, FactAssessment, ProviderAttempt } from "./types.ts";
import { sanitizeAuditUrl, sanitizeProviderError } from "./types.ts";

export interface ProviderErrorLike {
  statusCode?: number;
  code?: string;
  message?: string;
}

const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export function classifyProviderError(error: ProviderErrorLike): { retryable: boolean; statusCode?: number; errorClass: string } {
  const statusCode = error.statusCode;
  if (typeof statusCode === "number") {
    return {
      statusCode,
      retryable: RETRYABLE_STATUS_CODES.has(statusCode),
      errorClass: RETRYABLE_STATUS_CODES.has(statusCode) ? "retryable_http" : "fatal_http",
    };
  }
  if (error.code === "timeout") return { retryable: true, errorClass: "timeout" };
  return { retryable: false, errorClass: "unknown" };
}

export function normalizeProviderAttempt(raw: ProviderAttempt): ProviderAttempt {
  const classification = classifyProviderError({ statusCode: raw.statusCode, message: raw.errorMessage });
  return {
    id: raw.id,
    provider: raw.provider,
    model: raw.model,
    status: raw.status,
    statusCode: raw.statusCode,
    retryable: raw.retryable ?? classification.retryable,
    errorMessage: raw.errorMessage ? sanitizeProviderError(raw.errorMessage) : undefined,
  };
}

export function normalizeEvidenceAssessment(raw: FactAssessment): FactAssessment {
  const sources = raw.sources
    .map(normalizeSource)
    .filter((source): source is AuditSource => !!source);
  const hasAcceptedSource = sources.some((source) => source.accepted !== false);
  return {
    ...raw,
    status: raw.status === "supported" && !hasAcceptedSource ? "unverified" : raw.status,
    sources,
  };
}

function normalizeSource(source: AuditSource): AuditSource | null {
  const url = sanitizeAuditUrl(source.url);
  if (!url) return null;
  return {
    url,
    title: source.title,
    quote: source.quote,
    accepted: source.accepted ?? true,
  };
}
