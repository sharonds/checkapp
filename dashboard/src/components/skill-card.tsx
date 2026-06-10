"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "./score-ring";
import { VerdictBadge } from "./verdict-badge";
import { ClaimDrillDown } from "./ClaimDrillDown";
import type { Finding } from "@/lib/normalize";
import { getProvider, type SkillId } from "@/lib/providers";
import {
  AUDIT_UI,
  formatAuditLocation,
  localeForSkillResult,
  localizedFindingText,
  localizedSkillName,
  localizedSkillSummary,
  type AuditCoverageSummary,
  type AuditLocale,
} from "@/lib/audit-localization";
import { sanitizeText } from "@/lib/sanitize";

const ENGINE_MAP: Record<string, string> = {
  plagiarism: "Copyscape",
  "ai-detection": "Copyscape",
  seo: "Offline",
  "fact-check": "Exa AI",
  grammar: "LanguageTool",
  academic: "Semantic Scholar",
  "self-plagiarism": "Vectorize",
  tone: "MiniMax",
  legal: "MiniMax",
  summary: "MiniMax",
  brief: "MiniMax",
  purpose: "MiniMax",
};

export interface SkillResult {
  skillId: string;
  name: string;
  score: number;
  verdict: "pass" | "warn" | "fail" | "skipped";
  summary: string;
  findings: Finding[];
  costUsd: number;
  provider?: string;
}

export function SkillCard({
  result,
  locale: reportLocale,
  coverage,
}: {
  result: SkillResult;
  locale?: AuditLocale;
  coverage?: AuditCoverageSummary;
}) {
  const locale = reportLocale ?? localeForSkillResult(result);
  const labels = AUDIT_UI[locale];
  const providerSkillId = result.skillId === "fact-check-grounded" ? "fact-check" : result.skillId;
  const engine = result.provider
    ? getProvider(providerSkillId as SkillId, result.provider)?.label ?? result.provider
    : ENGINE_MAP[result.skillId] ?? "Unknown";
  const visibleFindings = result.findings.filter(
    (f) => f.severity === "info" || f.severity === "warn" || f.severity === "error"
  );

  return (
    <Card dir={locale === "he" ? "rtl" : "ltr"}>
      <CardHeader>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-2">
            <ScoreRing score={result.score} verdict={result.verdict} />
            <VerdictBadge verdict={result.verdict} locale={locale} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle>{localizedSkillName(result, locale)}</CardTitle>
              <Badge variant="secondary">{engine}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {localizedSkillSummary(result, locale, coverage)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {labels.cost}: ${result.costUsd.toFixed(4)}
            </p>
          </div>
        </div>
      </CardHeader>
      {visibleFindings.length > 0 && (
        <CardContent>
          <ul className="space-y-2">
            {visibleFindings.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-sm" data-testid={`finding-${f.severity}`} data-severity={f.severity}>
                <span className="shrink-0 mt-0.5">
                  {f.severity === "error" ? "\u274c" : f.severity === "info" ? "\u2139\ufe0f" : "\u26a0\ufe0f"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start gap-2">
                    <span className="flex-1">{localizedFindingText(f, locale)}</span>
                    <ClaimDrillDown finding={f} locale={locale} />
                  </div>
                  {f.quote && (
                    <blockquote dir="auto" className="mt-1 border-s-2 border-muted-foreground/30 ps-2 text-xs text-muted-foreground italic">
                      {f.quote}
                    </blockquote>
                  )}
                  {f.location && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {formatAuditLocation(f.location, locale)}
                    </p>
                  )}
                  {f.rewrite && (
                    <div className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-2 text-xs text-emerald-950">
                      <p className="font-semibold">{labels.suggestedRewrite}</p>
                      <p dir="auto" className="mt-1 whitespace-pre-wrap">
                        {sanitizeText(f.rewrite, 500)}
                      </p>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      )}
    </Card>
  );
}
