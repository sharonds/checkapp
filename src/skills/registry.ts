import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

export class SkillRegistry {
  constructor(private readonly skills: Skill[]) {}

  async runAll(text: string, config: Config): Promise<SkillResult[]> {
    const results = await Promise.all(
      this.skills.map((skill) =>
        skill.run(text, config).catch((err): SkillResult => ({
          skillId: skill.id,
          name: skill.name,
          score: 0,
          verdict: "fail",
          summary: "Skill failed — see error",
          findings: [],
          costUsd: 0,
          error: err instanceof Error ? err.message : String(err),
        }))
      )
    );
    return results;
  }
}
