"use client";
import { useState } from "react";
import { toast } from "sonner";
import { fetchWithCsrf } from "@/lib/fetch-with-csrf";
import {
  PROVIDER_REGISTRY,
  SKILL_LABELS,
  type SkillId,
  type ProviderId,
  type ProviderMetadata,
  type SkillProviderConfig,
} from "@/lib/providers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface SafeProviderConfig {
  provider?: string;
  extra?: Record<string, string>;
  hasKey?: boolean;
}

interface Props {
  initialProviders: Partial<Record<SkillId, SafeProviderConfig>>;
  skillIds: SkillId[];
}

function ProviderChips({ p }: { p: ProviderMetadata }) {
  return (
    <div className="flex flex-wrap gap-1 text-xs">
      <Badge variant="secondary">{p.speed}</Badge>
      <Badge variant="secondary">{p.costLabel}</Badge>
      <Badge variant="secondary">{p.depth}</Badge>
      {p.freeTier && (
        <Badge className="bg-green-100 text-green-900 hover:bg-green-100">free tier</Badge>
      )}
      {p.requiresKey && (
        <Badge className="bg-amber-100 text-amber-900 hover:bg-amber-100">key required</Badge>
      )}
    </div>
  );
}

export function ProvidersForm({ initialProviders, skillIds }: Props) {
  const [providers, setProviders] =
    useState<Partial<Record<SkillId, SafeProviderConfig | SkillProviderConfig>>>(initialProviders);
  const [saving, setSaving] = useState<SkillId | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState<Partial<Record<SkillId, string>>>({});

  async function save(skillId: SkillId) {
    const current = providers[skillId];
    if (!current?.provider) {
      toast.error(`Pick a provider for ${SKILL_LABELS[skillId]} first`);
      return;
    }
    setSaving(skillId);
    try {
      const userInput = apiKeyInput[skillId] ?? "";
      const payload: any = {
        skillId,
        provider: current.provider,
        extra: current.extra,
      };
      // Only include apiKey in request if user typed something
      if (userInput) {
        payload.apiKey = userInput;
      }
      const res = await fetchWithCsrf("/api/providers", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      toast.success(`${SKILL_LABELS[skillId]} saved`);
      setApiKeyInput((prev) => ({ ...prev, [skillId]: "" })); // Clear input after save
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(null);
    }
  }

  function update(skillId: SkillId, patch: Partial<SkillProviderConfig>) {
    setProviders((prev) => {
      const existing =
        prev[skillId] ??
        ({ provider: patch.provider ?? ("" as ProviderId) } as SkillProviderConfig);
      return { ...prev, [skillId]: { ...existing, ...patch } };
    });
  }

  return (
    <div className="space-y-4">
      {skillIds.map((skillId) => {
        const options = PROVIDER_REGISTRY[skillId] ?? [];
        const current = providers[skillId];
        const selected = options.find((o) => o.id === current?.provider);

        return (
          <Card key={skillId}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{SKILL_LABELS[skillId]}</span>
                {(current as any)?.hasKey && (
                  <Badge className="bg-green-100 text-green-900">configured</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-2">
                {options.map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex items-start gap-3 rounded border p-3 cursor-pointer hover:bg-accent/30 focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 ${
                      current?.provider === opt.id ? "border-primary bg-accent/20" : ""
                    }`}
                  >
                    <input
                      type="radio"
                      name={`provider-${skillId}`}
                      checked={current?.provider === opt.id}
                      onChange={() => update(skillId, { provider: opt.id })}
                      className="mt-1"
                    />
                    <div className="flex-1 space-y-1">
                      <div className="font-medium">{opt.label}</div>
                      <ProviderChips p={opt} />
                    </div>
                  </label>
                ))}
              </div>

              {selected?.requiresKey && (
                <div className="space-y-1.5">
                  <Label htmlFor={`key-${skillId}`}>API key</Label>
                  <Input
                    id={`key-${skillId}`}
                    type="password"
                    placeholder={
                      (current as any)?.hasKey
                        ? "••••••• (configured — leave blank to keep)"
                        : "Paste your API key"
                    }
                    value={apiKeyInput[skillId] ?? ""}
                    onChange={(e) =>
                      setApiKeyInput((prev) => ({ ...prev, [skillId]: e.target.value }))
                    }
                  />
                </div>
              )}

              {skillId === "self-plagiarism" &&
                current?.provider === "cloudflare-vectorize" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor={`acct-${skillId}`}>Cloudflare Account ID</Label>
                      <Input
                        id={`acct-${skillId}`}
                        value={current?.extra?.accountId ?? ""}
                        onChange={(e) =>
                          update(skillId, {
                            extra: { ...current?.extra, accountId: e.target.value },
                          })
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`idx-${skillId}`}>Index Name</Label>
                      <Input
                        id={`idx-${skillId}`}
                        placeholder="articles"
                        value={current?.extra?.indexName ?? ""}
                        onChange={(e) =>
                          update(skillId, {
                            extra: { ...current?.extra, indexName: e.target.value },
                          })
                        }
                      />
                    </div>
                  </div>
                )}

              <Button
                onClick={() => save(skillId)}
                disabled={saving === skillId || !current?.provider}
              >
                {saving === skillId ? "Saving…" : "Save"}
              </Button>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
