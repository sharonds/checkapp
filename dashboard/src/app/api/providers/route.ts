import { NextRequest, NextResponse } from "next/server";
import { readAppConfig, writeAppConfig } from "@/lib/config";
import { guardLocalMutation } from "@/lib/guard-local";
import type { SkillId, SkillProviderConfig } from "@/lib/providers";

export async function GET() {
  const cfg = readAppConfig() as Record<string, unknown>;
  const raw = (cfg.providers as Partial<Record<SkillId, SkillProviderConfig>>) ?? {};
  const maskedProviders = Object.fromEntries(
    Object.entries(raw).map(([skillId, pc]) => {
      const v = pc as SkillProviderConfig | undefined;
      return [skillId, v ? { provider: v.provider, extra: v.extra } : undefined];
    })
  );
  const hasKey = Object.fromEntries(
    Object.entries(raw).map(([skillId, pc]) => {
      const v = pc as SkillProviderConfig | undefined;
      return [skillId, Boolean(v?.apiKey)];
    })
  );
  return NextResponse.json({ providers: maskedProviders, hasKey });
}

export async function PUT(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;

  const body = (await req.json()) as {
    skillId: SkillId;
    provider: string;
    apiKey?: string;
    extra?: Record<string, string>;
  };

  const cfg = readAppConfig() as Record<string, unknown>;
  const providers = { ...((cfg.providers as Record<string, unknown>) ?? {}) };
  const existing = (cfg.providers as Record<string, SkillProviderConfig> | undefined)?.[body.skillId];

  // Preserve existing apiKey when body omits it
  // Empty string ("") explicitly clears the key; undefined preserves it
  const apiKey = body.apiKey === undefined
    ? existing?.apiKey
    : (body.apiKey === "" ? undefined : body.apiKey);

  providers[body.skillId] = { provider: body.provider, apiKey, extra: body.extra ?? existing?.extra };
  writeAppConfig({ providers });
  return NextResponse.json({ ok: true });
}
