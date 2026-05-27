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
  { id: "plagiarism", name: "Plagiarism Check", engine: "Copyscape", supportedProviders: ["copyscape"] },
  { id: "aiDetection", name: "AI Detection", engine: "Copyscape / Gemini", supportedProviders: ["copyscape", "gemini"] },
  { id: "seo", name: "SEO Analysis", engine: "Offline", supportedProviders: [] },
  { id: "factCheck", name: "Fact Check", engine: "Exa AI + MiniMax", supportedProviders: ["exa"] },
  { id: "tone", name: "Tone of Voice", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
  { id: "legal", name: "Legal Risk", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
  { id: "summary", name: "Content Summary", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
];

function requiredProviders(
  skill: SkillMeta,
  providers: Partial<Record<SkillId, SkillProviderConfig>>,
): ApiKeyProvider[] {
  if (skill.id !== "aiDetection") return skill.supportedProviders;

  const selected = providers["ai-detection"];
  return selected?.provider === "gemini-ai-detection" ? ["gemini"] : ["copyscape"];
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

  return apiKeys[provider] === true;
}

function missingProviders(
  skill: SkillMeta,
  apiKeys: ApiKeyStatus,
  providers: Partial<Record<SkillId, SkillProviderConfig>>,
): ApiKeyProvider[] {
  const required = requiredProviders(skill, providers);
  if (required.length === 0) return [];

  if (skill.id !== "aiDetection") {
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
      const supportedProviders = requiredProviders(s, providers);
      const missing = missingProviders(s, apiKeys, providers);
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
