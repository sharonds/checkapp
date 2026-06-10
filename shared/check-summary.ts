import { sanitizeSourceLabel } from "./report-url.ts";

type SummaryVerdict = "pass" | "warn" | "fail" | "skipped";

interface StoredResultLike {
  score?: unknown;
  verdict?: unknown;
}

export interface PublicCheckSummaryInput {
  id?: number;
  source?: string;
  wordCount?: number;
  totalCost?: number;
  totalCostUsd?: number;
  createdAt?: string;
  resultsJson?: string | null;
  results?: StoredResultLike[];
}

export interface PublicCheckSummary {
  id: number | undefined;
  source: string;
  wordCount: number;
  totalCost: number;
  createdAt: string | undefined;
  score: number;
  verdict: SummaryVerdict;
  resultCount: number;
}

export function publicCheckSummary(record: PublicCheckSummaryInput): PublicCheckSummary {
  const results = Array.isArray(record.results)
    ? record.results
    : parseResults(record.resultsJson);
  const scored = results.filter((result) => result.verdict !== "skipped");
  const scores = scored
    .map((result) => result.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));
  const score = scores.length > 0
    ? Math.round(scores.reduce((sum, value) => sum + value, 0) / scores.length)
    : 0;
  const allSkipped = results.length > 0 && scored.length === 0;
  const verdict: SummaryVerdict = allSkipped
    ? "skipped"
    : results.some((result) => result.verdict === "fail")
      ? "fail"
      : results.some((result) => result.verdict === "warn")
        ? "warn"
        : score >= 75
          ? "pass"
          : score >= 50
            ? "warn"
            : "fail";

  return {
    id: record.id,
    source: sanitizeSourceLabel(record.source ?? ""),
    wordCount: record.wordCount ?? 0,
    totalCost: record.totalCost ?? record.totalCostUsd ?? 0,
    createdAt: record.createdAt,
    score,
    verdict,
    resultCount: results.length,
  };
}

function parseResults(raw: string | null | undefined): StoredResultLike[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
