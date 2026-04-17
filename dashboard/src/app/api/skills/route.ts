import { jsonWithCors } from "@/lib/cors";
import { readAppConfig, writeAppConfig, getApiKeyStatus } from "@/lib/config";
import { guardLocalMutation } from "@/lib/guard-local";
import { NextRequest } from "next/server";

const SKILL_META = [
  { id: "plagiarism", name: "Plagiarism Check", engine: "Copyscape", supportedProviders: ["copyscape"] },
  { id: "aiDetection", name: "AI Detection", engine: "Copyscape", supportedProviders: ["copyscape"] },
  { id: "seo", name: "SEO Analysis", engine: "Offline", supportedProviders: [] },
  { id: "factCheck", name: "Fact Check", engine: "Exa AI + MiniMax", supportedProviders: ["exa"] },
  { id: "tone", name: "Tone of Voice", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
  { id: "legal", name: "Legal Risk", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
  { id: "summary", name: "Content Summary", engine: "LLM", supportedProviders: ["minimax", "anthropic", "openrouter"] },
];

function isSkillReady(skill: typeof SKILL_META[0], apiKeys: ReturnType<typeof getApiKeyStatus>): boolean {
  // Skills with no provider requirements are always ready
  if (skill.supportedProviders.length === 0) return true;

  // Skills requiring providers: check if any supported provider is configured
  return skill.supportedProviders.some((provider) => {
    const key = provider as keyof typeof apiKeys;
    return apiKeys[key] === true;
  });
}

export async function GET() {
  try {
    const config = readAppConfig() as Record<string, unknown>;
    const skills = (config.skills ?? {}) as Record<string, boolean>;
    const apiKeys = getApiKeyStatus();
    const result = SKILL_META.map((s) => ({
      ...s,
      enabled: skills[s.id] ?? false,
      ready: isSkillReady(s, apiKeys),
    }));
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
