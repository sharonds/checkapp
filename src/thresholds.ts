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
  if (!threshold) return currentVerdict as Verdict;
  if (score >= threshold.pass) return "pass";
  if (score >= threshold.warn) return "warn";
  return "fail";
}
