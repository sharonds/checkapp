import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

export class AcademicSkill implements Skill {
  readonly id = "academic";
  readonly name = "Academic Citations";

  async run(_text: string, _config: Config): Promise<SkillResult> {
    return {
      skillId: this.id,
      name: this.name,
      score: 0,
      verdict: "warn",
      summary: "Academic skill stubbed — implementation lands in Phase 7 B4",
      findings: [{
        severity: "info",
        text: "This skill is not yet implemented. It will be replaced with the real academic citations check in a follow-up PR (Phase 7 B4).",
      }],
      costUsd: 0,
    };
  }
}
