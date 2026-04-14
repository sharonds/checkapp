import { checkAiDetector } from "../aidetector.ts";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";

export class AiDetectionSkill implements Skill {
  readonly id = "ai-detection";
  readonly name = "AI Detection";

  async run(text: string, config: Config): Promise<SkillResult> {
    const result = await checkAiDetector(text, config);

    const findings: Finding[] = result.topSegments.map((seg) => ({
      severity: seg.aiScore >= 0.85 ? "error" : "warn",
      text: `${Math.round(seg.aiScore * 100)}% AI probability`,
      quote: seg.text,
    }));

    const score = Math.max(0, 100 - result.aiPct);

    return {
      skillId: this.id,
      name: this.name,
      score,
      verdict: result.verdict === "human" ? "pass" : result.verdict === "mixed" ? "warn" : "fail",
      summary: `${result.aiPct}% AI probability — ${result.verdict}`,
      findings,
      costUsd: 0.03,
      error: result.error,
    };
  }
}
