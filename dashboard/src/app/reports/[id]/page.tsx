import Link from "next/link";
import { ArrowLeft, Calendar, FileText, DollarSign } from "lucide-react";
import { getCheckById, getTagsForCheck } from "@/lib/db";
import { ScoreRing } from "@/components/score-ring";
import { VerdictBadge } from "@/components/verdict-badge";
import { SkillCard, type SkillResult } from "@/components/skill-card";
import { normalizeSkillResult, type Verdict } from "@/lib/normalize";
import { ReportTags } from "@/components/report-tags";
import { ExportButtons } from "@/components/export-buttons";
import { RegeneratePanel } from "@/components/regenerate-panel";
import { FooterBar } from "@/components/footer-bar";

export const dynamic = "force-dynamic";

function getVerdict(score: number): "pass" | "warn" | "fail" {
  if (score >= 75) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

function resolveVerdict(normalizedVerdict: Verdict, score: number): Verdict {
  // Preserve 'skipped' from the stored skill result — it's the neutral
  // 'not configured / not applicable' state and must not be recomputed
  // from a zero score (which would render as FAIL).
  if (normalizedVerdict === "skipped") return "skipped";
  return getVerdict(score);
}

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const check = getCheckById(Number(id));

  if (!check) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex-1 px-8 py-10">
          <Link
            href="/reports"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to reports
          </Link>
          <div className="mt-8 text-center">
            <h1 className="text-xl font-semibold">Report not found</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              The report you are looking for does not exist or has been removed.
            </p>
          </div>
        </div>
        <FooterBar />
      </div>
    );
  }

  const checkTags = getTagsForCheck(check.id!);

  let results: SkillResult[] = [];
  try {
    const parsed = JSON.parse(check.resultsJson);
    // Every SkillResult from stored SQLite blobs passes through
    // normalizeSkillResult so pre-Phase-7 rows (missing sources[]/citations[]/
    // rewrite) don't crash later UI like B7's ClaimDrillDown.
    if (Array.isArray(parsed)) {
      results = parsed.map((r) => {
        const n = normalizeSkillResult(r);
        return {
          skillId: n.skillId || "unknown",
          name: n.name || "Unknown Skill",
          score: n.score,
          verdict: resolveVerdict(n.verdict, n.score),
          summary: n.summary,
          findings: n.findings,
          costUsd: n.costUsd,
        };
      });
    }
  } catch {
    results = [];
  }

  // Exclude skipped skills — they're 'not configured', not 'failed'.
  const scoredResults = results.filter((r) => r.verdict !== "skipped");
  const scores = scoredResults
    .map((r) => r.score)
    .filter((s): s is number => typeof s === "number");
  const allSkipped = results.length > 0 && scoredResults.length === 0;
  const avgScore =
    scores.length > 0
      ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
      : 0;
  // If every skill was skipped, don't show FAIL — show 'skipped' as the overall state.
  const verdict: Verdict = allSkipped ? "skipped" : getVerdict(avgScore);

  const dateStr = new Date(check.createdAt).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-8 px-8 py-10">
        {/* Back link */}
        <Link
          href="/reports"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to reports
        </Link>

        {/* Header */}
        <div className="flex items-start gap-6">
          <ScoreRing score={avgScore} verdict={verdict} size={120} />
          <div className="flex-1 min-w-0 space-y-3">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight truncate">
                {check.source}
              </h1>
              <VerdictBadge verdict={verdict} />
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Calendar className="h-3.5 w-3.5" />
                {dateStr}
              </span>
              <span className="inline-flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" />
                {check.wordCount.toLocaleString()} words
              </span>
              <span className="inline-flex items-center gap-1">
                <DollarSign className="h-3.5 w-3.5" />
                ${check.totalCost.toFixed(4)}
              </span>
            </div>

            {/* Export buttons */}
            <ExportButtons
              source={check.source}
              score={avgScore}
              verdict={verdict}
              wordCount={check.wordCount}
              totalCost={check.totalCost}
              createdAt={check.createdAt}
              results={results}
            />
          </div>
        </div>

        {/* Tags */}
        <div>
          <h2 className="mb-2 text-sm font-medium text-muted-foreground">
            Tags
          </h2>
          <ReportTags checkId={check.id!} initialTags={checkTags} />
        </div>

        {/* Fix Issues panel */}
        {(() => {
          const hasFixableIssues = results.some(r => r.findings?.some((f: { severity?: string; quote?: string }) => (f.severity === "warn" || f.severity === "error") && f.quote));
          return <RegeneratePanel source={check.source} hasIssues={hasFixableIssues} />;
        })()}

        {/* Skill results */}
        {results.length > 0 && (
          <div>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Skill Results
            </h2>
            <div className="space-y-4">
              {results.map((result, i) => (
                <SkillCard key={`${result.skillId}-${i}`} result={result} />
              ))}
            </div>
          </div>
        )}
      </div>
      <FooterBar />
    </div>
  );
}
