/**
 * Server-side wrapper for CheckApp core pipeline.
 * Reimplements the pure check logic without Bun-specific modules.
 * Works in Next.js (Node.js) environment by:
 * - Importing skill classes directly (they don't depend on bun:sqlite)
 * - Importing pure utilities (thresholds, registry)
 * - Using dashboard's DB for context loading
 * - Avoiding imports from src/db.ts which has bun:sqlite
 */

// Import skill classes directly from src/skills (they're Bun-agnostic)
import { PlagiarismSkill } from "../../../src/skills/plagiarism";
import { AiDetectionSkill } from "../../../src/skills/aidetection";
import { SeoSkill } from "../../../src/skills/seo";
import { FactCheckSkill } from "../../../src/skills/factcheck";
import { ToneSkill } from "../../../src/skills/tone";
import { LegalSkill } from "../../../src/skills/legal";
import { SummarySkill } from "../../../src/skills/summary";
import { BriefSkill } from "../../../src/skills/brief";
import { PurposeSkill } from "../../../src/skills/purpose";
import { GrammarSkill } from "../../../src/skills/grammar";
import { AcademicSkill } from "../../../src/skills/academic";
import { SelfPlagiarismSkill } from "../../../src/skills/selfplagiarism";

// Import pure utilities (no Bun dependencies)
import { SkillRegistry } from "../../../src/skills/registry";
import { applyThreshold } from "../../../src/thresholds";

// Import types and dashboard DB
import type { Config } from "../../../src/config";
import type { Skill, SkillResult } from "../../../src/skills/types";
import { getContexts } from "./db";

export interface CoreResult {
  results: SkillResult[];
  totalCostUsd: number;
}

/**
 * Build skills based on config (reimplementation of CLI's buildSkills).
 */
function buildSkills(config: Config): Skill[] {
  const skills: Skill[] = [];
  if (config.skills.plagiarism) skills.push(new PlagiarismSkill());
  if (config.skills.aiDetection) skills.push(new AiDetectionSkill());
  if (config.skills.seo) skills.push(new SeoSkill());
  if (config.skills.factCheck) skills.push(new FactCheckSkill());
  if (config.skills.tone) skills.push(new ToneSkill());
  if (config.skills.legal) skills.push(new LegalSkill());
  if (config.skills.summary) skills.push(new SummarySkill());
  if (config.skills.brief) skills.push(new BriefSkill());
  if (config.skills.purpose) skills.push(new PurposeSkill());
  if (config.skills.grammar) skills.push(new GrammarSkill());
  if (config.skills.academic) skills.push(new AcademicSkill());
  if (config.skills.selfPlagiarism) skills.push(new SelfPlagiarismSkill());
  return skills;
}

/**
 * Pure check pipeline: text + config → skill results.
 * Reimplementation of CLI's runCheckCore for Node.js environment.
 */
export async function runCheckCore(text: string, config: Config): Promise<CoreResult> {
  const skills = buildSkills(config);
  const registry = new SkillRegistry(skills);
  const raw = await registry.runAll(text, config);
  const results = raw.map((r) => ({
    ...r,
    verdict: applyThreshold(r.score, r.verdict, config.thresholds?.[r.skillId]),
  }));
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  return { results, totalCostUsd };
}

/**
 * Load DB contexts and return config with contexts attached.
 * Reimplementation of CLI's loadContextsIntoConfig using dashboard DB.
 */
export function loadContextsIntoConfig(config: Config): Config {
  try {
    const contexts = getContexts();
    const contextRecord: Record<string, string> = {};
    for (const ctx of contexts) {
      contextRecord[ctx.type] = ctx.content;
    }
    return { ...config, contexts: contextRecord };
  } catch (err) {
    console.error("Failed to load contexts from dashboard DB:", err);
    return config;
  }
}
