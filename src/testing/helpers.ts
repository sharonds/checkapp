import type { SkillResult } from "../skills/types.ts";

export function overallScore(results: SkillResult[]): number {
  const scored = results.filter(r => r.verdict !== "skipped");
  if (scored.length === 0) return 0;
  return Math.round(scored.reduce((s, r) => s + r.score, 0) / scored.length);
}
