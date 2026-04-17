import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

export class GrammarSkill implements Skill {
  readonly id = "grammar";
  readonly name = "Grammar & Style";

  async run(_text: string, _config: Config): Promise<SkillResult> {
    return {
      skillId: this.id,
      name: this.name,
      score: 100,
      verdict: "pass",
      summary: "Not yet implemented — Phase 7 B3",
      findings: [],
      costUsd: 0,
    };
  }
}
