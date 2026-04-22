import { buildDashboardSummary, getAllChecks, getTotalStats } from "@/lib/db";
import { CheckTable, type CheckRow } from "@/components/check-table";
import { EmptyState } from "@/components/empty-state";
import { FooterBar } from "@/components/footer-bar";
import { Card, CardContent } from "@/components/ui/card";
import { FileSearch } from "lucide-react";

export const dynamic = "force-dynamic";

function scoreColorClass(score: number): string {
  if (score >= 75) return "text-score-pass";
  if (score >= 50) return "text-score-warn";
  return "text-score-fail";
}

export default function DashboardPage() {
  const stats = getTotalStats();
  const allChecks = getAllChecks();

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

  const dashboard = buildDashboardSummary(allChecks);
  const verdictTotal =
    dashboard.verdictCounts.pass +
    dashboard.verdictCounts.warn +
    dashboard.verdictCounts.fail +
    dashboard.verdictCounts.skipped;
  const checkRows: CheckRow[] = dashboard.parsedChecks.slice(0, 10).map((p) => ({
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
              <p className={`text-2xl font-bold ${scoreColorClass(dashboard.overallAvg)}`}>
                {dashboard.overallAvg}
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
              <p className="text-2xl font-bold">{dashboard.checksThisMonth}</p>
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
                {dashboard.verdictCounts.pass > 0 && (
                  <div
                    className="bg-score-pass"
                    style={{
                      width: `${(dashboard.verdictCounts.pass / verdictTotal) * 100}%`,
                    }}
                  />
                )}
                {dashboard.verdictCounts.warn > 0 && (
                  <div
                    className="bg-score-warn"
                    style={{
                      width: `${(dashboard.verdictCounts.warn / verdictTotal) * 100}%`,
                    }}
                  />
                )}
                {dashboard.verdictCounts.fail > 0 && (
                  <div
                    className="bg-score-fail"
                    style={{
                      width: `${(dashboard.verdictCounts.fail / verdictTotal) * 100}%`,
                    }}
                  />
                )}
                {dashboard.verdictCounts.skipped > 0 && (
                  <div
                    className="bg-muted-foreground/50"
                    style={{
                      width: `${(dashboard.verdictCounts.skipped / verdictTotal) * 100}%`,
                    }}
                  />
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              <span className="text-score-pass">
                {dashboard.verdictCounts.pass} passed
              </span>
              {" \u00b7 "}
              <span className="text-score-warn">
                {dashboard.verdictCounts.warn} warnings
              </span>
              {" \u00b7 "}
              <span className="text-score-fail">
                {dashboard.verdictCounts.fail} failed
              </span>
              {dashboard.verdictCounts.skipped > 0 && (
                <>
                  {" \u00b7 "}
                  <span>{dashboard.verdictCounts.skipped} skipped</span>
                </>
              )}
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
              {dashboard.days.map((day) => (
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
                      height: `${Math.max((day.cost / dashboard.maxCost) * 80, day.cost > 0 ? 4 : 0)}px`,
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
