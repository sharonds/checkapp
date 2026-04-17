import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

export class SelfPlagiarismSkill implements Skill {
  readonly id = "self-plagiarism";
  readonly name = "Self-Plagiarism";

  async run(_text: string, _config: Config): Promise<SkillResult> {
    return {
      skillId: this.id,
      name: this.name,
      score: 0,
      verdict: "warn",
      summary: "Self-plagiarism skill stubbed — implementation lands in Phase 7 B5",
      findings: [{
        severity: "info",
        text: "This skill is not yet implemented. It will be replaced with the real self-plagiarism check in a follow-up PR (Phase 7 B5).",
      }],
      costUsd: 0,
    };
  }
}
