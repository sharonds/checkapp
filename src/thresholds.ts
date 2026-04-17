import type { Verdict } from "./skills/types.ts";

export interface Threshold {
  pass: number;  // score >= this → pass
  warn: number;  // score >= this → warn
}

export function applyThreshold(
  score: number,
  currentVerdict: string,
  threshold: Threshold | undefined
): Verdict {
  // Pass through skipped without threshold check
  if (currentVerdict === "skipped") return "skipped";
  if (!threshold) return currentVerdict as Verdict;
  if (score >= threshold.pass) return "pass";
  if (score >= threshold.warn) return "warn";
  return "fail";
}
