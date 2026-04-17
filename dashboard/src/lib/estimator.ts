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

export interface AppConfigForEstimate {
  providers?: Partial<Record<SkillId, SkillProviderConfig>>;
  skills?: {
    factCheck?: boolean;
    grammar?: boolean;
    academic?: boolean;
    selfPlagiarism?: boolean;
    plagiarism?: boolean;
    [k: string]: boolean | undefined;
  };
}

export interface EstimateResult {
  perSkill: Record<string, number>;
  total: number;
  warnings: string[];
}

function providerBase(cfg: AppConfigForEstimate, skillId: SkillId): number {
  const p = cfg.providers?.[skillId];
  if (!p?.provider) return 0;
  return getProvider(skillId, p.provider)?.costPerCheckUsd ?? 0;
}

export function estimateRunCost(cfg: AppConfigForEstimate, wordCount: number): EstimateResult {
  const perSkill: Record<string, number> = {};
  const warnings: string[] = [];
  const s = cfg.skills ?? {};

  if (s.factCheck) perSkill["fact-check"] = providerBase(cfg, "fact-check") * FACT_CHECK_MAX_CLAIMS;
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
