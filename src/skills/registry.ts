import type { Skill, SkillResult, EnricherSkill } from "./types.ts";
import { isEnricher } from "./types.ts";
import type { Config } from "../config.ts";
import { enrichFindings } from "./enrich.ts";
import {
  mergeAuditContributionsWithRefs,
  normalizeSkillRunOutput,
  remapResultAuditRefs,
  sanitizeSkillResult,
  type NormalizedSkillRunOutput,
  type RegistryRunOutput,
} from "../audit/contribution.ts";
import { sanitizeProviderError } from "../audit/types.ts";

export class SkillRegistry {
  constructor(private readonly skills: Skill[]) {}

  async runAll(text: string, config: Config): Promise<SkillResult[]> {
    return (await this.runAllWithAudit(text, config)).results;
  }

  async runAllWithAudit(text: string, config: Config): Promise<RegistryRunOutput> {
    const primary = this.skills.filter((s) => !isEnricher(s));
    const enrichers = this.skills.filter((s): s is EnricherSkill => isEnricher(s));

    const primaryOutputs = await Promise.all(
      primary.map((skill) => this.runOne(skill, text, config)),
    );
    const primaryResults = primaryOutputs.map((output) => sanitizeSkillResult(output.result));

    const enricherOutputs = await Promise.all(
      enrichers.map((e) => this.runOneEnricher(e, text, config, primaryResults)),
    );
    const enricherResults = enricherOutputs.map((output) => sanitizeSkillResult(output.result));
    const mergedAudit = mergeAuditContributionsWithRefs([
      ...primaryOutputs.map((output) => output.audit),
      ...enricherOutputs.map((output) => output.audit),
    ]);
    const results = remapResultAuditRefs(
      enrichFindings([...primaryResults, ...enricherResults]),
      mergedAudit.refMap,
      mergedAudit.audit?.auditId,
    );

    return {
      results,
      audit: mergedAudit.audit,
    };
  }

  private async runOne(skill: Skill, text: string, config: Config): Promise<NormalizedSkillRunOutput> {
    try {
      return normalizeSkillRunOutput(await skill.run(text, config));
    } catch (err) {
      const result: SkillResult = {
        skillId: skill.id,
        name: skill.name,
        score: 0,
        verdict: "fail",
        summary: "Skill failed — see error",
        findings: [],
        costUsd: 0,
        error: sanitizeProviderError(err instanceof Error ? err.message : String(err)),
      };
      return { result };
    }
  }

  private async runOneEnricher(
    enricher: EnricherSkill,
    text: string,
    config: Config,
    priorResults: SkillResult[],
  ): Promise<NormalizedSkillRunOutput> {
    try {
      return normalizeSkillRunOutput(await enricher.enrich(text, config, priorResults));
    } catch (err) {
      const result: SkillResult = {
        skillId: enricher.id,
        name: enricher.name,
        score: 0,
        verdict: "fail",
        summary: "Skill failed — see error",
        findings: [],
        costUsd: 0,
        error: sanitizeProviderError(err instanceof Error ? err.message : String(err)),
      };
      return { result };
    }
  }
}
