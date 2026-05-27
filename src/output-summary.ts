import type { SkillResult, Verdict } from "./skills/types.ts";

export interface OverallSummary {
  score: number | null;
  verdict: Verdict;
}

export function summarizeResults(results: SkillResult[]): OverallSummary {
  const scoringResults = results.filter((r) => r.verdict !== "skipped");
  if (scoringResults.length === 0) {
    return { score: null, verdict: "skipped" };
  }

  const score = Math.round(
    scoringResults.reduce((sum, result) => sum + result.score, 0) / scoringResults.length
  );
  const verdict = scoringResults.some((r) => r.verdict === "fail")
    ? "fail"
    : scoringResults.some((r) => r.verdict === "warn")
      ? "warn"
      : "pass";

  return { score, verdict };
}

export function formatScore(score: number | null): string {
  return score === null ? "N/A" : `${score}/100`;
}

export function formatSkillScore(result: SkillResult): string {
  return result.verdict === "skipped" ? "N/A" : `${result.score}/100`;
}

export function formatCiVerdict(verdict: Verdict): string {
  return verdict === "pass"
    ? "PASS"
    : verdict === "warn"
      ? "WARN"
      : verdict === "skipped"
        ? "SKIP"
        : "FAIL";
}

export function formatCiOverallStatus(summary: OverallSummary): string {
  return summary.verdict === "skipped"
    ? "SKIPPED"
    : summary.verdict === "fail"
      ? "FAILED"
      : "PASSED";
}

export function shouldCiExitNonZero(summary: OverallSummary): boolean {
  return summary.verdict === "fail";
}
