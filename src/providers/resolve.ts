import type { Config } from "../config.ts";
import type { SkillId, SkillProviderConfig, ProviderMetadata } from "./types.ts";
import { getProvider } from "./registry.ts";

/**
 * Maps legacy flat Config fields to a skill+provider pair, so callers that
 * migrated from pre-Phase-7 configs (EXA_API_KEY, COPYSCAPE_KEY) still work.
 */
const LEGACY_MAP: Partial<Record<SkillId, { provider: SkillProviderConfig["provider"]; keyOf: (c: Config) => string | undefined }>> = {
  "fact-check": { provider: "exa-search", keyOf: (c) => c.exaApiKey },
  plagiarism: { provider: "copyscape", keyOf: (c) => c.copyscapeKey || undefined },
  academic: { provider: "openalex", keyOf: (c) => c.openalexMailto },
};

const GEMINI_FACT_CHECK_PROVIDERS = new Set<SkillProviderConfig["provider"]>([
  "gemini-grounded",
  "gemini-deep-research",
]);

const EXA_PROVIDERS = new Set<SkillProviderConfig["provider"]>(["exa-search", "exa-deep-reasoning"]);

const GEMINI_PROVIDERS = new Set<SkillProviderConfig["provider"]>([
  ...GEMINI_FACT_CHECK_PROVIDERS,
  "gemini-grounded-plagiarism",
  "gemini-ai-detection",
]);

export function resolveProvider(
  config: Config,
  skillId: SkillId,
): { provider: SkillProviderConfig["provider"]; apiKey?: string; metadata?: ProviderMetadata } | null {
  const explicit = config.providers?.[skillId];
  if (explicit?.provider) {
    // A provider picked without its own key uses the matching environment key (GEMINI_API_KEY, EXA_API_KEY).
    const apiKey =
      explicit.apiKey ??
      (GEMINI_PROVIDERS.has(explicit.provider) ? config.geminiApiKey
        : EXA_PROVIDERS.has(explicit.provider) ? config.exaApiKey : undefined);
    return { provider: explicit.provider, apiKey, metadata: getProvider(skillId, explicit.provider) };
  }
  const legacy = LEGACY_MAP[skillId];
  if (legacy) {
    const apiKey = legacy.keyOf(config);
    if (apiKey) return { provider: legacy.provider, apiKey, metadata: getProvider(skillId, legacy.provider) };
  }
  return null;
}
