import type { Config } from "../config.ts";
import type { SkillId } from "../providers/types.ts";
import { resolveProvider } from "../providers/resolve.ts";

/**
 * Constants derived from the skills themselves.
 * fact-check.ts calls exa.search up to 4 times (claims.slice(0,4)).
 * self-plagiarism embeds the full article; text-embedding-3-small is $0.00002/1k tokens.
 */
const FACT_CHECK_MAX_CLAIMS = 4;
const ACADEMIC_MAX_ENRICH = 5;
const EMBED_COST_PER_1K_TOKENS = 0.00002;
const WORDS_PER_TOKEN = 0.75;
const LT_MAX_BYTES_PER_REQUEST = 20_000;
const BYTES_PER_WORD = 6;
const AI_DETECTION_COST = 0.03;

export interface EstimateResult {
  perSkill: Record<string, number>;
  total: number;
  warnings: string[];
}

export function estimateFactCheckCost(tier: Config["factCheckTier"] = "basic"): number {
  switch (tier) {
    case "basic":
      return 0.04;
    case "standard":
      return 0.16;
    case "premium":
      return 1.5;
    default:
      return 0.04;
  }
}

/**
 * Pre-flight cost estimate. Returns a per-skill breakdown, running total,
 * and human-readable warnings when known provider limits will be hit.
 *
 * Deliberately honest: fact-check is multiplied by max-claim count, academic
 * by typical enrich targets, self-plagiarism scales its embedding cost by
 * token count. Grammar's LanguageTool tier is free but capped — we emit a
 * warning when the article exceeds 20KB per request.
 */
export function estimateRunCost(config: Config, wordCount: number): EstimateResult {
  const perSkill: Record<string, number> = {};
  const warnings: string[] = [];

  const providerBase = (id: SkillId): number => {
    const r = resolveProvider(config, id);
    if (r?.metadata?.costPerCheckUsd) {
      return r.metadata.costPerCheckUsd;
    }
    // Legacy fallbacks for old key formats
    if (id === "fact-check" && (config as any).exaApiKey) {
      return resolveProvider({ ...config, providers: { "fact-check": { provider: "exa-search", apiKey: "k" } } }, "fact-check")?.metadata?.costPerCheckUsd ?? 0;
    }
    if (id === "plagiarism" && (config as any).copyscapeKey) {
      return resolveProvider({ ...config, providers: { plagiarism: { provider: "copyscape", apiKey: "k" } } }, "plagiarism")?.metadata?.costPerCheckUsd ?? 0;
    }
    return 0;
  };

  if (config.skills.factCheck) {
    const effectiveTier = config.factCheckTierFlag === true
      ? (config.factCheckTier ?? "basic")
      : null;
    perSkill["fact-check"] = effectiveTier
      ? estimateFactCheckCost(effectiveTier)
      : providerBase("fact-check") * FACT_CHECK_MAX_CLAIMS;
  }
  if ((config.skills as any).aiDetection) {
    perSkill.aiDetection = providerBase("ai-detection" as any) || AI_DETECTION_COST;
  }
  if (config.skills.grammar === true) {
    perSkill.grammar = providerBase("grammar");
    const estimatedBytes = wordCount * BYTES_PER_WORD;
    if (estimatedBytes > LT_MAX_BYTES_PER_REQUEST) {
      warnings.push(
        `LanguageTool managed tier has a 20KB per-request cap; this ${wordCount}-word article (~${Math.ceil(estimatedBytes / 1000)}KB) will be split into multiple requests and may be rate-limited (20 req/min).`
      );
    }
  }
  if (config.skills.academic === true) {
    const targets = Math.min(ACADEMIC_MAX_ENRICH, Math.ceil(wordCount / 400));
    perSkill.academic = providerBase("academic") * targets;
  }
  if (config.skills.selfPlagiarism === true) {
    const base = providerBase("self-plagiarism");
    const tokens = wordCount / WORDS_PER_TOKEN;
    const embedCost = (tokens / 1000) * EMBED_COST_PER_1K_TOKENS;
    perSkill["self-plagiarism"] = base + embedCost;
  }
  if (config.skills.plagiarism) {
    perSkill.plagiarism = providerBase("plagiarism");
  }

  const total = Object.values(perSkill).reduce((a, b) => a + b, 0);
  return { perSkill, total, warnings };
}
