export type SkillId =
  | "fact-check" | "grammar" | "academic" | "self-plagiarism"
  | "plagiarism" | "tone" | "legal" | "seo" | "ai-detection"
  | "summary" | "brief" | "purpose";

export type ProviderId =
  | "exa-search" | "exa-deep-reasoning" | "parallel-search" | "parallel-task" | "tavily"
  | "gemini-grounded" | "gemini-deep-research"
  | "languagetool" | "languagetool-selfhosted" | "sapling" | "llm-fallback"
  | "copyscape" | "originality"
  | "semantic-scholar" | "openalex"
  | "cloudflare-vectorize" | "pinecone" | "upstash-vector";

export interface SkillProviderConfig {
  provider: ProviderId;
  apiKey?: string;
  extra?: Record<string, string>;
}

export interface ProviderMetadata {
  id: ProviderId;
  label: string;
  speed: "fast" | "medium" | "slow";
  costPerCheckUsd: number;
  costLabel: string;
  depth: "shallow" | "standard" | "deep";
  freeTier: boolean;
  requiresKey: boolean;
  endpoint?: string;
}
