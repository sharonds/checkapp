import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

export class GrammarSkill implements Skill {
  readonly id = "grammar";
  readonly name = "Grammar & Style";

  async run(_text: string, _config: Config): Promise<SkillResult> {
    return {
      skillId: this.id,
      name: this.name,
      score: 0,
      verdict: "warn",
      summary: "Grammar skill stubbed — implementation lands in Phase 7 B3",
      findings: [{
        severity: "info",
        text: "This skill is not yet implemented. It will be replaced with a LanguageTool-backed grammar check in a follow-up PR (Phase 7 B3).",
      }],
      costUsd: 0,
    };
  }
}
