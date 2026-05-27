import { jsonWithCors } from "@/lib/cors";
import { readAppConfig, writeAppConfig, getApiKeyStatus } from "@/lib/config";
import { guardLocalMutation } from "@/lib/guard-local";
import type { SkillId, SkillProviderConfig } from "@/lib/providers";
import { NextRequest } from "next/server";

type ApiKeyStatus = ReturnType<typeof getApiKeyStatus>;
type ApiKeyProvider = keyof ApiKeyStatus;
type SkillMeta = {
  id: string;
  name: string;
  engine: string;
  supportedProviders: ApiKeyProvider[];
};

const SKILL_META: SkillMeta[] = [
  { id: "plagiarism", name: "Plagiarism Check", engine: "Copyscape / Gemini Grounded", supportedProviders: ["copyscape", "gemini"] },
  { id: "aiDetection", name: "AI Detection", engine: "Copyscape / Gemini", supportedProviders: ["copyscape", "gemini"] },
  { id: "seo", name: "SEO Analysis", engine: "Offline", supportedProviders: [] },
  { id: "factCheck", name: "Fact Check", engine: "Exa AI + LLM / Gemini Grounded", supportedProviders: ["exa", "gemini"] },
  { id: "tone", name: "Tone of Voice", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
  { id: "legal", name: "Legal Risk", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
  { id: "summary", name: "Content Summary", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
];

function standardFactCheckSelected(config: Record<string, unknown>): boolean {
  return config.factCheckTierFlag === true && config.factCheckTier === "standard";
}

function requiredProviders(
  skill: SkillMeta,
  providers: Partial<Record<SkillId, SkillProviderConfig>>,
  config: Record<string, unknown>,
): ApiKeyProvider[] {
  if (skill.id === "aiDetection") {
    const selected = providers["ai-detection"];
    return selected?.provider === "gemini-ai-detection" ? ["gemini"] : ["copyscape"];
  }

  if (skill.id === "plagiarism") {
    const selected = providers.plagiarism;
    return selected?.provider === "gemini-grounded-plagiarism" ? ["gemini"] : ["copyscape"];
  }

  if (skill.id === "factCheck") {
    if (standardFactCheckSelected(config) || providers["fact-check"]?.provider === "gemini-grounded") {
      return ["gemini"];
    }
    return ["exa"];
  }

  return skill.supportedProviders;
}

function hasProviderKey(
  provider: ApiKeyProvider,
  apiKeys: ApiKeyStatus,
  skill: SkillMeta,
  providers: Partial<Record<SkillId, SkillProviderConfig>>,
): boolean {
  if (skill.id === "aiDetection" && provider === "gemini") {
    return Boolean(providers["ai-detection"]?.apiKey) || apiKeys.gemini === true;
  }

  if (skill.id === "plagiarism" && provider === "gemini") {
    return Boolean(providers.plagiarism?.apiKey) || apiKeys.gemini === true;
  }

  if (skill.id === "factCheck") {
    const selected = providers["fact-check"];
    if (provider === "gemini") {
      return Boolean(selected?.provider === "gemini-grounded" && selected.apiKey) || apiKeys.gemini === true;
    }
    if (provider === "exa") {
      return Boolean(selected?.provider?.startsWith("exa-") && selected.apiKey) || apiKeys.exa === true;
    }
  }

  return apiKeys[provider] === true;
}

function missingProviders(
  skill: SkillMeta,
  apiKeys: ApiKeyStatus,
  providers: Partial<Record<SkillId, SkillProviderConfig>>,
  config: Record<string, unknown>,
): ApiKeyProvider[] {
  const required = requiredProviders(skill, providers, config);
  if (required.length === 0) return [];

  if (skill.id !== "aiDetection" && skill.id !== "plagiarism" && skill.id !== "factCheck") {
    return required.some((provider) => apiKeys[provider] === true) ? [] : required;
  }

  return required.filter((provider) => !hasProviderKey(provider, apiKeys, skill, providers));
}

export async function GET() {
  try {
    const config = readAppConfig() as Record<string, unknown>;
    const skills = (config.skills ?? {}) as Record<string, boolean>;
    const providers = (config.providers ?? {}) as Partial<Record<SkillId, SkillProviderConfig>>;
    const apiKeys = getApiKeyStatus();
    const result = SKILL_META.map((s) => {
      const supportedProviders = requiredProviders(s, providers, config);
      const missing = missingProviders(s, apiKeys, providers, config);
      return {
        ...s,
        supportedProviders,
        missingProviders: missing,
        enabled: skills[s.id] ?? false,
        ready: missing.length === 0,
      };
    });
    return jsonWithCors(result);
  } catch (err) {
    return jsonWithCors({ error: "Failed to fetch skills" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const { skillId, enabled } = await req.json() as { skillId: string; enabled: boolean };
    const config = readAppConfig() as Record<string, unknown>;
    const skills = { ...(config.skills as Record<string, boolean> ?? {}) };
    skills[skillId] = enabled;
    writeAppConfig({ skills });
    return jsonWithCors({ ok: true });
  } catch (err) {
    return jsonWithCors({ error: "Failed to toggle skill" }, { status: 500 });
  }
}
