import { getRecentChecks, getTotalStats } from "@/lib/db";
import { CheckTable, type CheckRow } from "@/components/check-table";
import { EmptyState } from "@/components/empty-state";
import { FooterBar } from "@/components/footer-bar";
import { Card, CardContent } from "@/components/ui/card";
import { FileSearch } from "lucide-react";

export const dynamic = "force-dynamic";

function getVerdict(score: number): "pass" | "warn" | "fail" {
  if (score >= 75) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

function scoreColorClass(score: number): string {
  if (score >= 75) return "text-score-pass";
  if (score >= 50) return "text-score-warn";
  return "text-score-fail";
}

function getDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function DashboardPage() {
  const stats = getTotalStats();
  const recentChecks = getRecentChecks(10);

  if (stats.totalChecks === 0) {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex-1 px-8 py-10">
          <EmptyState
            icon={FileSearch}
            title="No checks yet"
            description="Run your first article check to see results here"
            action={{ label: "Run Check", href: "/check" }}
          />
        </div>
        <FooterBar />
      </div>
    );
  }

  // Parse results from each check
  const parsed = recentChecks.map((c) => {
    let results: Array<{ score?: number }> = [];
    try {
      results = JSON.parse(c.resultsJson);
    } catch {
      results = [];
    }

    const scores = Array.isArray(results)
      ? results.map((r) => r.score).filter((s): s is number => typeof s === "number")
      : [];
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;

    return {
      id: c.id,
      source: c.source,
      wordCount: c.wordCount,
      totalCost: c.totalCost,
      createdAt: c.createdAt,
      avgScore,
      verdict: getVerdict(avgScore),
    };
  });

  // Compute overall average score
  const allScores = parsed.map((p) => p.avgScore).filter((s) => s > 0);
  const overallAvg =
    allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : 0;

  // Verdict distribution
  const verdictCounts = { pass: 0, warn: 0, fail: 0 };
  for (const p of parsed) {
    verdictCounts[p.verdict]++;
  }
  const verdictTotal = verdictCounts.pass + verdictCounts.warn + verdictCounts.fail;

  // Checks this month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  const checksThisMonth = recentChecks.filter(
    (c) => c.createdAt >= monthStart
  ).length;

  // Cost chart — last 7 calendar days
  const days: Array<{ label: string; shortDate: string; cost: number }> = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    days.push({
      label: getDayLabel(d),
      shortDate: formatDateShort(d),
      cost: 0,
    });
    for (const c of recentChecks) {
      if (c.createdAt.startsWith(dateStr)) {
        days[days.length - 1].cost += c.totalCost;
      }
    }
  }
  const maxCost = Math.max(...days.map((d) => d.cost), 0.001);

  // Transform for CheckTable
  const checkRows: CheckRow[] = parsed.map((p) => ({
    id: String(p.id),
    source: p.source,
    score: p.avgScore,
    verdict: p.verdict,
    words: p.wordCount,
    costUsd: p.totalCost,
    createdAt: p.createdAt,
  }));

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-6 px-8 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>

        {/* Stat cards */}
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Card size="sm">
            <CardContent>
              <p className="text-2xl font-bold">{stats.totalChecks}</p>
              <p className="text-xs text-muted-foreground">Total Checks</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className={`text-2xl font-bold ${scoreColorClass(overallAvg)}`}>
                {overallAvg}
              </p>
              <p className="text-xs text-muted-foreground">Average Score</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-2xl font-bold">
                ${stats.totalCost.toFixed(4)}
              </p>
              <p className="text-xs text-muted-foreground">Total Cost</p>
            </CardContent>
          </Card>
          <Card size="sm">
            <CardContent>
              <p className="text-2xl font-bold">{checksThisMonth}</p>
              <p className="text-xs text-muted-foreground">Checks This Month</p>
            </CardContent>
          </Card>
        </div>

        {/* Verdict distribution */}
        <Card size="sm">
          <CardContent className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              Verdict Distribution
            </p>
            {verdictTotal > 0 && (
              <div className="flex h-3 w-full overflow-hidden rounded-full">
                {verdictCounts.pass > 0 && (
                  <div
                    className="bg-score-pass"
                    style={{
                      width: `${(verdictCounts.pass / verdictTotal) * 100}%`,
                    }}
                  />
                )}
                {verdictCounts.warn > 0 && (
                  <div
                    className="bg-score-warn"
                    style={{
                      width: `${(verdictCounts.warn / verdictTotal) * 100}%`,
                    }}
                  />
                )}
                {verdictCounts.fail > 0 && (
                  <div
                    className="bg-score-fail"
                    style={{
                      width: `${(verdictCounts.fail / verdictTotal) * 100}%`,
                    }}
                  />
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <span className="text-score-pass">
                {verdictCounts.pass} passed
              </span>
              {" \u00b7 "}
              <span className="text-score-warn">
                {verdictCounts.warn} warnings
              </span>
              {" \u00b7 "}
              <span className="text-score-fail">
                {verdictCounts.fail} failed
              </span>
            </p>
          </CardContent>
        </Card>

        {/* Cost chart — last 7 days */}
        <Card size="sm">
          <CardContent className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">
              API Cost — Last 7 Days
            </p>
            <div className="flex items-end gap-2" style={{ height: 120 }}>
              {days.map((day) => (
                <div
                  key={day.shortDate}
                  className="flex flex-1 flex-col items-center gap-1"
                >
                  {day.cost > 0 && (
                    <span className="text-[10px] text-muted-foreground">
                      ${day.cost.toFixed(3)}
                    </span>
                  )}
                  <div
                    className="w-full rounded-sm bg-primary/80 transition-all dark:bg-primary/60"
                    style={{
                      height: `${Math.max((day.cost / maxCost) * 80, day.cost > 0 ? 4 : 0)}px`,
                    }}
                  />
                  <span className="text-[10px] text-muted-foreground">
                    {day.label}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recent checks table */}
        <div>
          <h2 className="mb-3 text-lg font-semibold">
            Recent Checks
          </h2>
          <CheckTable checks={checkRows} />
        </div>
      </div>
      <FooterBar />
    </div>
  );
}
