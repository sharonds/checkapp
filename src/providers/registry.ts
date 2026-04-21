import type { SkillId, ProviderMetadata } from "./types.ts";

export const PROVIDER_REGISTRY: Partial<Record<SkillId, ProviderMetadata[]>> = {
  "fact-check": [
    { id: "exa-search", label: "Exa Search", speed: "fast", costPerCheckUsd: 0.008, costLabel: "$0.008/check", depth: "standard", freeTier: false, requiresKey: true },
    { id: "exa-deep-reasoning", label: "Exa Deep Reasoning", speed: "slow", costPerCheckUsd: 0.025, costLabel: "$0.025/check", depth: "deep", freeTier: false, requiresKey: true },
    { id: "gemini-grounded", label: "Gemini 3.1 Pro + Google Search", speed: "medium", costPerCheckUsd: 0.01, costLabel: "$0.01/check", depth: "standard", freeTier: false, requiresKey: true },
    { id: "gemini-deep-research", label: "Gemini Deep Research (Premium Audit)", speed: "slow", costPerCheckUsd: 0.05, costLabel: "$0.05/check", depth: "deep", freeTier: false, requiresKey: true },
    { id: "parallel-task", label: "Parallel Task", speed: "slow", costPerCheckUsd: 0.03, costLabel: "$0.03/check", depth: "deep", freeTier: true, requiresKey: true },
  ],
  grammar: [
    { id: "languagetool", label: "LanguageTool (managed)", speed: "fast", costPerCheckUsd: 0, costLabel: "free tier", depth: "standard", freeTier: true, requiresKey: false, endpoint: "https://api.languagetool.org/v2/check" },
    { id: "languagetool-selfhosted", label: "LanguageTool (self-hosted)", speed: "fast", costPerCheckUsd: 0, costLabel: "free (OSS)", depth: "standard", freeTier: true, requiresKey: false },
    { id: "sapling", label: "Sapling", speed: "fast", costPerCheckUsd: 0.0008, costLabel: "$0.0008/100 words", depth: "standard", freeTier: false, requiresKey: true },
    { id: "llm-fallback", label: "LLM fallback (uses active LLM)", speed: "slow", costPerCheckUsd: 0.002, costLabel: "LLM cost", depth: "standard", freeTier: false, requiresKey: false },
  ],
  academic: [
    { id: "semantic-scholar", label: "Semantic Scholar", speed: "medium", costPerCheckUsd: 0, costLabel: "free", depth: "standard", freeTier: true, requiresKey: false, endpoint: "https://api.semanticscholar.org/graph/v1/paper/search" },
  ],
  "self-plagiarism": [
    { id: "cloudflare-vectorize", label: "Cloudflare Vectorize", speed: "fast", costPerCheckUsd: 0.0001, costLabel: "$0.01/1M vectors", depth: "standard", freeTier: true, requiresKey: true },
    { id: "pinecone", label: "Pinecone", speed: "fast", costPerCheckUsd: 0.0008, costLabel: "$0.08/1M vectors", depth: "standard", freeTier: true, requiresKey: true },
    { id: "upstash-vector", label: "Upstash Vector", speed: "fast", costPerCheckUsd: 0, costLabel: "free tier (10k vectors)", depth: "standard", freeTier: true, requiresKey: true },
  ],
  plagiarism: [
    { id: "copyscape", label: "Copyscape", speed: "medium", costPerCheckUsd: 0.03, costLabel: "$0.03/check", depth: "standard", freeTier: false, requiresKey: true },
    { id: "originality", label: "Originality.ai", speed: "slow", costPerCheckUsd: 0.01, costLabel: "$0.01/check", depth: "deep", freeTier: false, requiresKey: true },
  ],
};

export function getProviders(skillId: SkillId): ProviderMetadata[] {
  return PROVIDER_REGISTRY[skillId] ?? [];
}

export function getProvider(skillId: SkillId, providerId: string): ProviderMetadata | undefined {
  return getProviders(skillId).find((p) => p.id === providerId);
}
