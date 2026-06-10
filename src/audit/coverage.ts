import type { AuditCoverage, ClaimDecision, ProviderAttempt } from "./types.ts";

export interface PlagiarismPassageDecision {
  id: string;
  decision: "checked" | "skipped";
  skipReason?: string;
}

export interface BuildAuditCoverageInput {
  wordsScanned: number;
  sectionsDetected: number;
  paragraphsScanned: number;
  sentencesScanned: number;
  claimDecisions: ClaimDecision[];
  plagiarismPassages?: PlagiarismPassageDecision[];
  providerAttempts?: ProviderAttempt[];
  budgetStopReason?: string;
}

export function buildAuditCoverage(input: BuildAuditCoverageInput): AuditCoverage {
  const checkedClaims = input.claimDecisions.filter((decision) => decision.decision === "checked");
  const skippedClaims = input.claimDecisions.filter((decision) => decision.decision === "skipped");
  const plagiarism = input.plagiarismPassages ?? [];
  const attempts = input.providerAttempts ?? [];
  return {
    wordsScanned: input.wordsScanned,
    sectionsDetected: input.sectionsDetected,
    paragraphsScanned: input.paragraphsScanned,
    sentencesScanned: input.sentencesScanned,
    claimsExtracted: input.claimDecisions.length,
    claimsChecked: checkedClaims.length,
    claimsSkipped: skippedClaims.length,
    skipReasons: mergeReasonCounts(countSkipReasons(skippedClaims), countSkipReasons(plagiarism)),
    plagiarismPassagesChecked: plagiarism.filter((passage) => passage.decision === "checked").length,
    plagiarismPassagesSkipped: plagiarism.filter((passage) => passage.decision === "skipped").length,
    providerFailures: attempts.filter((attempt) => attempt.status === "failed").length,
    providerRetries: attempts.filter((attempt) => attempt.status === "retry").length,
    budgetStopReason: input.budgetStopReason,
  };
}

function countSkipReasons(items: Array<{ decision: "checked" | "skipped"; skipReason?: string }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    if (item.decision === "skipped" && item.skipReason) counts[item.skipReason] = (counts[item.skipReason] ?? 0) + 1;
  }
  return counts;
}

function mergeReasonCounts(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const merged = { ...a };
  for (const [key, value] of Object.entries(b)) merged[key] = (merged[key] ?? 0) + value;
  return merged;
}
