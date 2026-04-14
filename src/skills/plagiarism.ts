import { checkCopyscape } from "../copyscape.ts";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";

export class PlagiarismSkill implements Skill {
  readonly id = "plagiarism";
  readonly name = "Plagiarism Check";

  async run(text: string, config: Config): Promise<SkillResult> {
    const result = await checkCopyscape(text, config);

    const findings: Finding[] = result.matches.slice(0, 5).map((m) => ({
      severity: result.verdict === "rewrite" ? "error" : "warn",
      text: `${m.wordsMatched} words matched at ${m.url}`,
      quote: m.snippet || undefined,
    }));

    const score = Math.max(0, 100 - result.similarityPct * 2);

    return {
      skillId: this.id,
      name: this.name,
      score,
      verdict: result.verdict === "publish" ? "pass" : result.verdict === "review" ? "warn" : "fail",
      summary: `${result.similarityPct}% similarity — ${result.totalMatches} source${result.totalMatches !== 1 ? "s" : ""} matched`,
      findings,
      costUsd: result.totalWords > 0 ? 0.03 + Math.max(0, Math.ceil((result.totalWords - 200) / 100)) * 0.01 : 0.03,
      error: result.error,
    };
  }
}
