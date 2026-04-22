// MIRROR OF: ~/checkapp/src/cost/estimator.ts
// If you edit here, edit there too. Drift guard (B8) will CI-fail on divergence.

import type { SkillId, SkillProviderConfig } from "./providers";
import { getProvider } from "./providers";

const FACT_CHECK_MAX_CLAIMS = 4;
const ACADEMIC_MAX_ENRICH = 5;
const EMBED_COST_PER_1K_TOKENS = 0.00002;
const WORDS_PER_TOKEN = 0.75;
const LT_MAX_BYTES_PER_REQUEST = 20_000;
const BYTES_PER_WORD = 6;
const AI_DETECTION_COST = 0.03;

export interface AppConfigForEstimate {
  providers?: Partial<Record<SkillId, SkillProviderConfig>>;
  factCheckTier?: "basic" | "standard" | "premium";
  factCheckTierFlag?: boolean;
  skills?: {
    factCheck?: boolean;
    grammar?: boolean;
    academic?: boolean;
    selfPlagiarism?: boolean;
    plagiarism?: boolean;
    [k: string]: boolean | undefined;
  };
  // Legacy pre-Phase-7 fields — the estimator reads these as fallbacks when
  // `providers` is absent (see `providerBase()` below). Typed here so test
  // fixtures and legacy config files pass TypeScript's excess-property check.
  exaApiKey?: string;
  copyscapeKey?: string;
}

export interface EstimateResult {
  perSkill: Record<string, number>;
  total: number;
  warnings: string[];
}

function providerBase(cfg: AppConfigForEstimate, skillId: SkillId): number {
  const p = cfg.providers?.[skillId];
  if (p?.provider) {
    return getProvider(skillId, p.provider)?.costPerCheckUsd ?? 0;
  }
  // Legacy fallbacks for pre-Phase-7 config shapes (typed on AppConfigForEstimate).
  if (skillId === "fact-check" && cfg.exaApiKey) {
    return getProvider("fact-check", "exa-search")?.costPerCheckUsd ?? 0;
  }
  if (skillId === "plagiarism" && cfg.copyscapeKey) {
    return getProvider("plagiarism", "copyscape")?.costPerCheckUsd ?? 0;
  }
  return 0;
}

export function estimateRunCost(cfg: AppConfigForEstimate, wordCount: number): EstimateResult {
  const perSkill: Record<string, number> = {};
  const warnings: string[] = [];
  const s = cfg.skills ?? {};

  if (s.factCheck) {
    const effectiveTier = cfg.factCheckTierFlag === true ? (cfg.factCheckTier ?? "basic") : null;
    perSkill["fact-check"] = effectiveTier
      ? effectiveTier === "standard"
        ? 0.16
        : effectiveTier === "premium"
          ? 1.5
          : 0.04
      : providerBase(cfg, "fact-check") * FACT_CHECK_MAX_CLAIMS;
  }
  if ((s as any).aiDetection) {
    perSkill.aiDetection = providerBase(cfg, "ai-detection" as any) || AI_DETECTION_COST;
  }
  if (s.grammar === true) {
    perSkill.grammar = providerBase(cfg, "grammar");
    const bytes = wordCount * BYTES_PER_WORD;
    if (bytes > LT_MAX_BYTES_PER_REQUEST) {
      warnings.push(
        `LanguageTool managed tier has a 20KB per-request cap; this ${wordCount}-word article (~${Math.ceil(bytes / 1000)}KB) will be split and may be rate-limited.`
      );
    }
  }
  if (s.academic === true) {
    const t = Math.min(ACADEMIC_MAX_ENRICH, Math.ceil(wordCount / 400));
    perSkill.academic = providerBase(cfg, "academic") * t;
  }
  if (s.selfPlagiarism === true) {
    const base = providerBase(cfg, "self-plagiarism");
    const tokens = wordCount / WORDS_PER_TOKEN;
    perSkill["self-plagiarism"] = base + (tokens / 1000) * EMBED_COST_PER_1K_TOKENS;
  }
  if (s.plagiarism) perSkill.plagiarism = providerBase(cfg, "plagiarism");

  const total = Object.values(perSkill).reduce((a, b) => a + b, 0);
  return { perSkill, total, warnings };
}
