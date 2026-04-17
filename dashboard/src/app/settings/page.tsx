"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { fetchWithCsrf } from "@/lib/fetch-with-csrf";
import { FooterBar } from "@/components/footer-bar";
import { LoadingSkeleton } from "@/components/loading-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

interface ApiKeys {
  copyscape: boolean;
  exa: boolean;
  minimax: boolean;
  anthropic: boolean;
  parallel: boolean;
  openrouter: boolean;
}

const LLM_PROVIDERS = [
  { id: "minimax", label: "MiniMax", badge: "Recommended", disabled: false },
  { id: "anthropic", label: "Anthropic", badge: null, disabled: false },
  { id: "openrouter", label: "OpenRouter", badge: null, disabled: false },
  { id: "openai", label: "OpenAI", badge: "Coming soon", disabled: true },
  { id: "gemini", label: "Gemini", badge: "Coming soon", disabled: true },
];

const KEY_FIELDS = [
  { configKey: "copyscapeUser", label: "Copyscape Username", apiKeyId: "copyscape" },
  { configKey: "copyscapeKey", label: "Copyscape API Key", apiKeyId: "copyscape" },
  { configKey: "exaApiKey", label: "Exa API Key", apiKeyId: "exa" },
  { configKey: "minimaxApiKey", label: "MiniMax API Key", apiKeyId: "minimax" },
  { configKey: "anthropicApiKey", label: "Anthropic API Key", apiKeyId: "anthropic" },
  { configKey: "openrouterApiKey", label: "OpenRouter API Key", apiKeyId: "openrouter" },
  { configKey: "parallelApiKey", label: "Parallel API Key", apiKeyId: "parallel" },
];

const THRESHOLD_SKILLS = [
  { id: "plagiarism", name: "Plagiarism Check" },
  { id: "aiDetection", name: "AI Detection" },
  { id: "seo", name: "SEO Analysis" },
  { id: "factCheck", name: "Fact Check" },
  { id: "tone", name: "Tone of Voice" },
  { id: "legal", name: "Legal Risk" },
  { id: "summary", name: "Content Summary" },
  { id: "brief", name: "Brief Alignment" },
  { id: "purpose", name: "Purpose Detection" },
];

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [apiKeys, setApiKeys] = useState<ApiKeys>({
    copyscape: false,
    exa: false,
    minimax: false,
    anthropic: false,
    parallel: false,
    openrouter: false,
  });

  const [provider, setProvider] = useState("minimax");
  const [keyValues, setKeyValues] = useState<Record<string, string>>({});
  const [thresholds, setThresholds] = useState<
    Record<string, { pass: number; warn: number }>
  >({});
  const [savingKeys, setSavingKeys] = useState(false);
  const [savingThresholds, setSavingThresholds] = useState(false);

  useEffect(() => {
    fetch("/api/config")
      .then((r) => r.json())
      .then((data) => {
        setConfig(data.config ?? {});
        setApiKeys(data.apiKeys ?? {});
        setProvider((data.config?.llmProvider as string) ?? "minimax");

        // Initialize key values from masked config
        const kv: Record<string, string> = {};
        for (const f of KEY_FIELDS) {
          kv[f.configKey] = "";
        }
        setKeyValues(kv);

        // Initialize thresholds
        const existingThresholds =
          (data.config?.thresholds as Record<
            string,
            { pass: number; warn: number }
          >) ?? {};
        const t: Record<string, { pass: number; warn: number }> = {};
        for (const s of THRESHOLD_SKILLS) {
          t[s.id] = existingThresholds[s.id] ?? { pass: 75, warn: 50 };
        }
        setThresholds(t);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleProviderChange(id: string) {
    setProvider(id);
    try {
      const res = await fetchWithCsrf("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ llmProvider: id }),
      });
      if (!res.ok) {
        toast.error("Failed to save");
        return;
      }
      toast.success("LLM provider updated");
    } catch {
      toast.error("Failed to save");
    }
  }

  async function handleSaveKeys() {
    setSavingKeys(true);
    try {
      const updates: Record<string, string> = {};
      for (const [key, val] of Object.entries(keyValues)) {
        if (val.trim()) updates[key] = val.trim();
      }
      if (Object.keys(updates).length > 0) {
        const res = await fetchWithCsrf("/api/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(updates),
        });
        if (!res.ok) {
          toast.error("Failed to save");
          return;
        }
      }
      // Refresh status
      const refetchRes = await fetch("/api/config");
      if (!refetchRes.ok) {
        toast.error("Failed to refresh status");
        return;
      }
      const data = await refetchRes.json();
      setApiKeys(data.apiKeys ?? {});
      setConfig(data.config ?? {});
      // Clear inputs after save
      const kv: Record<string, string> = {};
      for (const f of KEY_FIELDS) kv[f.configKey] = "";
      setKeyValues(kv);
      toast.success("API keys saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingKeys(false);
    }
  }

  async function handleSaveThresholds() {
    setSavingThresholds(true);
    try {
      const res = await fetchWithCsrf("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thresholds }),
      });
      if (!res.ok) {
        toast.error("Failed to save");
        return;
      }
      toast.success("Thresholds saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSavingThresholds(false);
    }
  }

  function getMaskedValue(configKey: string): string {
    const val = config[configKey];
    if (typeof val === "string" && val) return val;
    return "";
  }

  if (loading) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex-1 px-8 py-10 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <LoadingSkeleton key={i} variant="card" />
          ))}
        </div>
        <FooterBar />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure LLM provider, API keys, and score thresholds.
        </p>

        <div className="mt-6 max-w-2xl space-y-8">
          {/* Per-skill Providers link */}
          <Card>
            <CardHeader>
              <CardTitle>Per-skill Providers</CardTitle>
              <CardDescription>
                Pick an engine + enter API key for each skill (fact-check,
                grammar, academic, self-plagiarism, plagiarism)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/settings/providers" className="inline-flex items-center justify-center rounded-lg border border-border bg-background hover:bg-muted hover:text-foreground text-sm font-medium px-2.5 h-8 gap-1.5 transition-all">
                Configure →
              </Link>
            </CardContent>
          </Card>

          {/* LLM Provider */}
          <Card>
            <CardHeader>
              <CardTitle>LLM Provider</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {LLM_PROVIDERS.map((p) => (
                <label
                  key={p.id}
                  className={`flex items-center gap-3 rounded-lg border px-4 py-3 transition-colors ${
                    p.disabled
                      ? "cursor-not-allowed opacity-50"
                      : "cursor-pointer hover:bg-muted/50"
                  } ${
                    provider === p.id
                      ? "border-primary bg-primary/5"
                      : "border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="llm-provider"
                    value={p.id}
                    checked={provider === p.id}
                    disabled={p.disabled}
                    onChange={() => handleProviderChange(p.id)}
                    className="h-4 w-4 accent-primary"
                  />
                  <span className="text-sm font-medium">{p.label}</span>
                  {p.badge && (
                    <Badge
                      variant={p.badge === "Recommended" ? "default" : "secondary"}
                    >
                      {p.badge}
                    </Badge>
                  )}
                </label>
              ))}
            </CardContent>
          </Card>

          <Separator />

          {/* API Keys */}
          <Card>
            <CardHeader>
              <CardTitle>API Keys</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {KEY_FIELDS.map((f) => {
                const masked = getMaskedValue(f.configKey);
                const keyStatus =
                  apiKeys[f.apiKeyId as keyof ApiKeys] ?? false;
                return (
                  <div key={f.configKey} className="space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Label htmlFor={f.configKey}>{f.label}</Label>
                      <span
                        className={`inline-block h-2 w-2 rounded-full ${
                          keyStatus ? "bg-emerald-500" : "bg-red-500"
                        }`}
                      />
                    </div>
                    <Input
                      id={f.configKey}
                      type="password"
                      value={keyValues[f.configKey] ?? ""}
                      onChange={(e) =>
                        setKeyValues((prev) => ({
                          ...prev,
                          [f.configKey]: e.target.value,
                        }))
                      }
                      placeholder={masked || "Enter key..."}
                    />
                  </div>
                );
              })}
              <Button onClick={handleSaveKeys} disabled={savingKeys}>
                {savingKeys ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Keys
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          <Separator />

          {/* Thresholds */}
          <Card>
            <CardHeader>
              <CardTitle>Score Thresholds</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Set custom pass and warn thresholds for each skill (0-100).
                Scores above the pass threshold show as &quot;pass&quot;, above
                warn as &quot;warn&quot;, and below warn as &quot;fail&quot;.
              </p>
              <div className="space-y-3">
                {THRESHOLD_SKILLS.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center gap-4 rounded-lg border px-4 py-3"
                  >
                    <span className="min-w-[140px] text-sm font-medium">
                      {s.name}
                    </span>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`${s.id}-pass`}
                        className="text-xs text-muted-foreground"
                      >
                        Pass
                      </Label>
                      <Input
                        id={`${s.id}-pass`}
                        type="number"
                        min={0}
                        max={100}
                        value={thresholds[s.id]?.pass ?? 75}
                        onChange={(e) =>
                          setThresholds((prev) => ({
                            ...prev,
                            [s.id]: {
                              ...prev[s.id],
                              pass: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-20"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label
                        htmlFor={`${s.id}-warn`}
                        className="text-xs text-muted-foreground"
                      >
                        Warn
                      </Label>
                      <Input
                        id={`${s.id}-warn`}
                        type="number"
                        min={0}
                        max={100}
                        value={thresholds[s.id]?.warn ?? 50}
                        onChange={(e) =>
                          setThresholds((prev) => ({
                            ...prev,
                            [s.id]: {
                              ...prev[s.id],
                              warn: Number(e.target.value),
                            },
                          }))
                        }
                        className="w-20"
                      />
                    </div>
                  </div>
                ))}
              </div>
              <Button
                onClick={handleSaveThresholds}
                disabled={savingThresholds}
              >
                {savingThresholds ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    Save Thresholds
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
      <FooterBar />
    </div>
  );
}
