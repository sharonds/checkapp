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
import { FactCheckGroundedSkill } from "../../../src/skills/factcheck-grounded";
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
import type { AuditRecord } from "../../../src/audit/types";
import { getContexts } from "./db";

export interface CoreResult {
  results: SkillResult[];
  totalCostUsd: number;
  audit?: AuditRecord;
}

export interface FactCheckSelection {
  flagOn: boolean;
  requestedTier: Config["factCheckTier"];
  effectiveTier: "basic" | "standard" | "premium";
  selectedImplementation: "basic" | "grounded";
  selectedSkillId: "fact-check" | "fact-check-grounded";
}

export interface RunCheckHooks {
  onFactCheckTierSelected?: (selection: FactCheckSelection) => void;
}

const DEFAULT_SKILLS: NonNullable<Config["skills"]> = {
  plagiarism: true,
  aiDetection: true,
  seo: true,
  factCheck: false,
  tone: false,
  legal: false,
  summary: false,
  brief: false,
  purpose: false,
  grammar: false,
  academic: false,
  selfPlagiarism: false,
};

/**
 * Mirrors src/checker.ts so the dashboard follows the same tier gating and
 * sync fallback behavior as the CLI.
 */
export function selectFactCheckSkill(
  config: Config,
  hooks?: RunCheckHooks,
): { skill: Skill; selection: FactCheckSelection } {
  const flagOn = config.factCheckTierFlag === true;
  const explicitGeminiGrounded = config.providers?.["fact-check"]?.provider === "gemini-grounded";
  const effectiveTier = explicitGeminiGrounded ? "standard" : flagOn ? (config.factCheckTier ?? "basic") : "basic";
  const selection: FactCheckSelection = {
    flagOn,
    requestedTier: config.factCheckTier,
    effectiveTier,
    selectedImplementation: effectiveTier === "standard" ? "grounded" : "basic",
    selectedSkillId: effectiveTier === "standard" ? "fact-check-grounded" : "fact-check",
  };

  hooks?.onFactCheckTierSelected?.(selection);

  const skill = selection.selectedImplementation === "grounded"
    ? new FactCheckGroundedSkill()
    : new FactCheckSkill();

  return { skill, selection };
}

function buildSkills(config: Config, hooks?: RunCheckHooks): Skill[] {
  const skillsConfig = { ...DEFAULT_SKILLS, ...(config.skills ?? {}) };
  const skills: Skill[] = [];
  if (skillsConfig.plagiarism) skills.push(new PlagiarismSkill());
  if (skillsConfig.aiDetection) skills.push(new AiDetectionSkill());
  if (skillsConfig.seo) skills.push(new SeoSkill());
  if (skillsConfig.factCheck) skills.push(selectFactCheckSkill({ ...config, skills: skillsConfig }, hooks).skill);
  if (skillsConfig.tone) skills.push(new ToneSkill());
  if (skillsConfig.legal) skills.push(new LegalSkill());
  if (skillsConfig.summary) skills.push(new SummarySkill());
  if (skillsConfig.brief) skills.push(new BriefSkill());
  if (skillsConfig.purpose) skills.push(new PurposeSkill());
  if (skillsConfig.grammar) skills.push(new GrammarSkill());
  if (skillsConfig.academic) skills.push(new AcademicSkill());
  if (skillsConfig.selfPlagiarism) skills.push(new SelfPlagiarismSkill());
  return skills;
}

/**
 * Pure check pipeline: text + config → skill results.
 * Reimplementation of CLI's runCheckCore for Node.js environment.
 */
export async function runCheckCore(
  text: string,
  config: Config,
  hooks?: RunCheckHooks,
): Promise<CoreResult> {
  const effectiveConfig = { ...config, skills: { ...DEFAULT_SKILLS, ...(config.skills ?? {}) } };
  const skills = buildSkills(effectiveConfig, hooks);
  const registry = new SkillRegistry(skills);
  const raw = await registry.runAllWithAudit(text, effectiveConfig);
  const results = raw.results.map((r) => ({
    ...r,
    verdict: applyThreshold(r.score, r.verdict, effectiveConfig.thresholds?.[r.skillId]),
  }));
  const totalCostUsd = results.reduce((s, r) => s + r.costUsd, 0);
  return { results, totalCostUsd, audit: raw.audit };
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
