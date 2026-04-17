import { readAppConfig } from "@/lib/config";
import { PROVIDER_REGISTRY, type SkillId, type SkillProviderConfig } from "@/lib/providers";
import { ProvidersForm } from "./ProvidersForm";

export const dynamic = "force-dynamic"; // Reads config file at render

interface SafeProviderConfig {
  provider?: string;
  extra?: Record<string, string>;
  hasKey?: boolean;
}

export default function ProvidersPage() {
  const cfg = readAppConfig() as Record<string, unknown>;
  const rawProviders =
    (cfg.providers as Partial<Record<SkillId, SkillProviderConfig>>) ?? {};
  const skillIds = Object.keys(PROVIDER_REGISTRY) as SkillId[];

  // Strip apiKey from config before passing to client component
  const safeProviders: Partial<Record<SkillId, SafeProviderConfig>> = Object.fromEntries(
    Object.entries(rawProviders).map(([id, p]) => [
      id,
      {
        provider: p?.provider,
        extra: p?.extra,
        hasKey: Boolean(p?.apiKey),
      },
    ])
  );

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 px-8 py-10">
        <div className="max-w-3xl space-y-6">
          <header>
            <h1 className="text-2xl font-semibold tracking-tight">Per-skill Providers</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick an engine per skill and enter your API key. CheckApp stores
              keys in plaintext at <code>~/.checkapp/config.json</code> —
              protect with <code>chmod 600</code> and keep the dashboard on
              localhost.
            </p>
          </header>
          <ProvidersForm
            initialProviders={safeProviders}
            skillIds={skillIds}
          />
        </div>
      </div>
    </div>
  );
}
