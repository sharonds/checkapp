"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileSearch,
  History,
  LoaderCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  fetchReportDeepAudit,
  fetchReportDeepAuditHistory,
  pollReportDeepAudit,
  requestReportDeepAudit,
  type DeepAuditInitialResponse,
  type DeepAuditRecord,
  type DeepAuditStatus,
} from "@/lib/deep-audit-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { safeHref } from "@/lib/sanitize";

interface DeepAuditPanelProps {
  reportId: number;
}

const ACTIVE_STATUSES: DeepAuditStatus[] = ["pending", "in_progress"];

export function DeepAuditPanel({ reportId }: DeepAuditPanelProps) {
  const [data, setData] = useState<DeepAuditInitialResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [history, setHistory] = useState<DeepAuditRecord[] | null>(null);

  const mostRecent = data?.mostRecent ?? null;
  const previousCount = data?.previousCount ?? 0;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsLoading(true);
      setLoadError(null);
      try {
        const next = await fetchReportDeepAudit(reportId);
        if (!cancelled) {
          setData(next);
          setPollAttempt(0);
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  useEffect(() => {
    if (!mostRecent || !ACTIVE_STATUSES.includes(mostRecent.status)) {
      return;
    }

    let cancelled = false;
    const ageMs = Date.now() - mostRecent.startedAt;
    const delayMs = ageMs >= 5 * 60_000 ? 30_000 : 15_000;

    const timer = window.setTimeout(async () => {
      try {
        const refreshed = await pollReportDeepAudit(reportId, mostRecent.id);
        if (cancelled) return;

        setData((current) => {
          if (!current) return current;
          return {
            ...current,
            mostRecent: refreshed,
          };
        });
        setHistory((current) => updateHistoryRecord(current, refreshed));
        setActionError(null);
      } catch (error) {
        if (!cancelled) {
          setActionError(getErrorMessage(error));
        }
      } finally {
        if (!cancelled) {
          setPollAttempt((current) => current + 1);
        }
      }
    }, delayMs);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mostRecent?.id, mostRecent?.status, mostRecent?.startedAt, pollAttempt, reportId]);

  async function handleStartAudit() {
    setActionPending(true);
    setActionError(null);

    try {
      const response = await requestReportDeepAudit(reportId);
      setData((current) => ({
        mostRecent: response.audit,
        previousCount: getNextPreviousCount(current, response),
      }));
      setHistory((current) => {
        if (!current) return current;
        if (response.reused) {
          return updateHistoryRecord(current, response.audit);
        }
        return [response.audit, ...current.filter((audit) => audit.id !== response.audit.id)];
      });
      setPollAttempt(0);
      toast.success(
        response.reused
          ? "Reusing the active Deep Audit"
          : "Deep Audit started",
      );
    } catch (error) {
      const message = getErrorMessage(error);
      setActionError(message);
      toast.error(message);
    } finally {
      setActionPending(false);
    }
  }

  async function handleToggleHistory() {
    const nextOpen = !historyOpen;
    setHistoryOpen(nextOpen);
    if (!nextOpen || history !== null) {
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const response = await fetchReportDeepAuditHistory(reportId);
      setHistory(response.audits);
    } catch (error) {
      const message = getErrorMessage(error);
      setHistoryError(message);
      toast.error(message);
    } finally {
      setHistoryLoading(false);
    }
  }

  return (
    <Card className="border-sky-500/20 bg-sky-500/[0.03]">
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 space-y-1">
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSearch className="h-4 w-4 text-sky-600" />
              Deep Audit
            </CardTitle>
            <CardDescription>
              Premium fact-check deep research for this saved report. Each run is
              stored separately so you can compare past audits.
            </CardDescription>
          </div>
          <CardAction className="flex items-center gap-2">
            <Badge variant="outline">$1.50</Badge>
            <Badge variant="outline">~10 min</Badge>
          </CardAction>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-4">
        {isLoading ? (
          <StateShell
            icon={<LoaderCircle className="h-4 w-4 animate-spin text-sky-600" />}
            title="Loading Deep Audit status"
            description="Checking whether this report already has an active or historical audit."
          />
        ) : loadError ? (
          <StateShell
            tone="destructive"
            icon={<AlertTriangle className="h-4 w-4" />}
            title="Deep Audit status could not be loaded"
            description={loadError}
            action={
              <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
                Reload
              </Button>
            }
          />
        ) : mostRecent === null ? (
          <StateShell
            icon={<Sparkles className="h-4 w-4 text-sky-600" />}
            title="No Deep Audit yet"
            description="Start a premium audit to get a long-form verification report with claim-by-claim evidence."
            action={
              <Button disabled={actionPending} onClick={handleStartAudit}>
                {actionPending ? (
                  <>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Starting…
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Request Deep Audit
                  </>
                )}
              </Button>
            }
          />
        ) : (
          <>
            {renderMostRecentState({
              audit: mostRecent,
              actionPending,
              onStartAudit: handleStartAudit,
            })}
            <AuditMeta audit={mostRecent} />
          </>
        )}

        {actionError && !loadError ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
            {actionError}
          </div>
        ) : null}

        {previousCount > 0 ? (
          <div className="rounded-lg border border-border/70 bg-background/80">
            <button
              type="button"
              onClick={handleToggleHistory}
              className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm font-medium"
            >
              <span className="inline-flex items-center gap-2">
                <History className="h-4 w-4 text-muted-foreground" />
                View previous audits ({previousCount})
              </span>
              {historyOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </button>

            {historyOpen ? (
              <div className="border-t border-border/70 px-4 py-4">
                {historyLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Loading previous audits…
                  </div>
                ) : historyError ? (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-900">
                    {historyError}
                  </div>
                ) : (
                  <PreviousAuditsList
                    audits={(history ?? []).filter((audit) => audit.id !== mostRecent?.id)}
                  />
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function renderMostRecentState({
  audit,
  actionPending,
  onStartAudit,
}: {
  audit: DeepAuditRecord;
  actionPending: boolean;
  onStartAudit: () => Promise<void>;
}) {
  if (audit.status === "pending" || audit.status === "in_progress") {
    return (
      <StateShell
        icon={<LoaderCircle className="h-4 w-4 animate-spin text-sky-600" />}
        title="Deep Audit in progress"
        description={`Estimated completion: ${formatTimestamp(
          audit.startedAt + 15 * 60_000,
        )}. Refreshing automatically while this audit runs.`}
      />
    );
  }

  if (audit.status === "completed") {
    return (
      <div className="space-y-4">
        <StateShell
          tone="success"
          icon={<Sparkles className="h-4 w-4 text-emerald-600" />}
          title="Deep Audit completed"
          description="The latest long-form fact-check report is ready below."
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={actionPending}
              onClick={() => {
                void onStartAudit();
              }}
            >
              {actionPending ? (
                <>
                  <LoaderCircle className="h-4 w-4 animate-spin" />
                  Starting…
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  Request Fresh Audit
                </>
              )}
            </Button>
          }
        />
        <div className="rounded-xl border border-border/70 bg-background p-4">
          {audit.resultText?.trim() ? (
            <AuditMarkdown text={audit.resultText} />
          ) : (
            <p className="text-sm text-muted-foreground">
              This audit completed without stored report text.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (audit.status === "failed") {
    return (
      <StateShell
        tone="destructive"
        icon={<AlertTriangle className="h-4 w-4" />}
        title="Last Deep Audit failed"
        description={audit.errorMessage ?? "The audit failed before a report was produced."}
        action={
          <Button
            variant="destructive"
            size="sm"
            disabled={actionPending}
            onClick={() => {
              void onStartAudit();
            }}
          >
            {actionPending ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin" />
                Starting…
              </>
            ) : (
              <>
                <RefreshCw className="h-4 w-4" />
                Try Again
              </>
            )}
          </Button>
        }
      />
    );
  }

  return (
    <StateShell
      tone="warning"
      icon={<Clock3 className="h-4 w-4 text-amber-600" />}
      title="Last Deep Audit went stale"
      description={
        audit.errorMessage ??
        "This audit was abandoned after the stale threshold. Start a fresh run to resume."
      }
      action={
        <Button
          variant="outline"
          size="sm"
          disabled={actionPending}
          onClick={() => {
            void onStartAudit();
          }}
        >
          {actionPending ? (
            <>
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Starting…
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
              Start Fresh Audit
            </>
          )}
        </Button>
      }
    />
  );
}

function StateShell({
  icon,
  title,
  description,
  action,
  tone = "default",
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-4",
        tone === "default" && "border-sky-500/20 bg-sky-500/[0.04]",
        tone === "success" && "border-emerald-500/20 bg-emerald-500/[0.04]",
        tone === "warning" && "border-amber-500/30 bg-amber-500/[0.08]",
        tone === "destructive" && "border-destructive/30 bg-destructive/5",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-medium">
            {icon}
            <span>{title}</span>
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
    </div>
  );
}

function AuditMeta({ audit }: { audit: DeepAuditRecord }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <Badge variant="outline">{audit.status.replace("_", " ")}</Badge>
      <span>Started {formatTimestamp(audit.startedAt)}</span>
      {audit.completedAt ? <span>Completed {formatTimestamp(audit.completedAt)}</span> : null}
      <span>Requested via {audit.requestedBy}</span>
    </div>
  );
}

function PreviousAuditsList({ audits }: { audits: DeepAuditRecord[] }) {
  if (audits.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No previous audits are available yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {audits.map((audit) => (
        <details
          key={audit.id}
          className="rounded-lg border border-border/70 bg-background/70"
        >
          <summary className="cursor-pointer list-none px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Badge variant="outline">{audit.status.replace("_", " ")}</Badge>
                  <span>Audit #{audit.id}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Started {formatTimestamp(audit.startedAt)}
                  {audit.completedAt
                    ? ` • Completed ${formatTimestamp(audit.completedAt)}`
                    : ""}
                </p>
              </div>
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            </div>
          </summary>
          <div className="border-t border-border/70 px-4 py-4">
            <AuditMeta audit={audit} />
            {audit.status === "completed" && audit.resultText?.trim() ? (
              <div className="mt-3 rounded-lg border border-border/70 bg-muted/30 p-4">
                <AuditMarkdown text={audit.resultText} />
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                {audit.errorMessage ??
                  "No stored report text is available for this audit."}
              </p>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}

function AuditMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);

  return (
    <div className="space-y-4 text-sm leading-6 text-foreground">
      {blocks.map((block, index) => {
        if (block.type === "heading") {
          if (block.level === 1) {
            return (
              <h2 key={index} className="text-lg font-semibold tracking-tight">
                {renderInline(block.text, `${index}-heading`)}
              </h2>
            );
          }
          if (block.level === 2) {
            return (
              <h3 key={index} className="text-base font-semibold">
                {renderInline(block.text, `${index}-heading`)}
              </h3>
            );
          }
          return (
            <h4 key={index} className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {renderInline(block.text, `${index}-heading`)}
            </h4>
          );
        }

        if (block.type === "list") {
          return (
            <ul key={index} className="space-y-2 pl-5">
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex} className="list-disc">
                  {renderInline(item, `${index}-list-${itemIndex}`)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === "blockquote") {
          return (
            <blockquote
              key={index}
              className="border-l-2 border-sky-500/40 pl-4 text-muted-foreground"
            >
              {block.lines.map((line, lineIndex) => (
                <p key={lineIndex}>{renderInline(line, `${index}-quote-${lineIndex}`)}</p>
              ))}
            </blockquote>
          );
        }

        if (block.type === "table") {
          const [header, ...rows] = block.rows;
          return (
            <div key={index} className="overflow-x-auto rounded-lg border border-border/70">
              <table className="min-w-full border-collapse text-left text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {header.map((cell, cellIndex) => (
                      <th
                        key={cellIndex}
                        className="border-b border-border/70 px-3 py-2 font-medium"
                      >
                        {renderInline(cell, `${index}-th-${cellIndex}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, rowIndex) => (
                    <tr key={rowIndex} className="align-top">
                      {row.map((cell, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="border-t border-border/70 px-3 py-2 text-muted-foreground"
                        >
                          {renderInline(cell, `${index}-td-${rowIndex}-${cellIndex}`)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        }

        if (block.type === "code") {
          return (
            <pre
              key={index}
              className="overflow-x-auto rounded-lg border border-border/70 bg-muted/40 p-3 text-xs leading-5"
            >
              <code>{block.code}</code>
            </pre>
          );
        }

        return (
          <p key={index} className="text-sm leading-6">
            {block.lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 ? <br /> : null}
                {renderInline(line, `${index}-p-${lineIndex}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

type MarkdownBlock =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; lines: string[] }
  | { type: "list"; items: string[] }
  | { type: "blockquote"; lines: string[] }
  | { type: "table"; rows: string[][] }
  | { type: "code"; code: string };

function parseMarkdown(text: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trimEnd() ?? "";

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        text: heading[2],
      });
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", code: codeLines.join("\n") });
      continue;
    }

    if (line.startsWith("|")) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("|")) {
        tableLines.push(lines[index].trim());
        index += 1;
      }
      const rows = tableLines
        .filter((row, rowIndex) => {
          if (rowIndex !== 1) return true;
          return !/^\|\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?$/.test(row);
        })
        .map(splitTableRow);
      blocks.push({ type: "table", rows });
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\s*-\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*-\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "list", items });
      continue;
    }

    if (/^\s*>\s+/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s+/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s+/, "").trim());
        index += 1;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(#{1,3})\s+/.test(lines[index]) &&
      !lines[index].startsWith("```") &&
      !lines[index].trim().startsWith("|") &&
      !/^\s*-\s+/.test(lines[index]) &&
      !/^\s*>\s+/.test(lines[index])
    ) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", lines: paragraphLines });
  }

  return blocks;
}

function splitTableRow(row: string): string[] {
  const trimmed = row.replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function renderInline(text: string, keyPrefix: string) {
  const parts: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\((https?:\/\/[^)]+)\))/g;
  let lastIndex = 0;
  let partIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matched = match[0];
    const start = match.index ?? 0;

    if (start > lastIndex) {
      parts.push(text.slice(lastIndex, start));
    }

    if (matched.startsWith("**")) {
      parts.push(
        <strong key={`${keyPrefix}-${partIndex}`}>
          {matched.slice(2, -2)}
        </strong>,
      );
    } else {
      const link = matched.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      if (link) {
        const href = safeHref(link[2]);
        parts.push(
          href === "#"
            ? <span key={`${keyPrefix}-${partIndex}`}>{link[1]}</span>
            : (
              <a
                key={`${keyPrefix}-${partIndex}`}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-sky-700 underline underline-offset-2"
              >
                {link[1]}
              </a>
            ),
        );
      } else {
        parts.push(matched);
      }
    }

    lastIndex = start + matched.length;
    partIndex += 1;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : text;
}

function updateHistoryRecord(
  history: DeepAuditRecord[] | null,
  audit: DeepAuditRecord,
): DeepAuditRecord[] | null {
  if (!history) return history;
  const filtered = history.filter((entry) => entry.id !== audit.id);
  return [audit, ...filtered].sort((left, right) => right.startedAt - left.startedAt || right.id - left.id);
}

function getNextPreviousCount(
  current: DeepAuditInitialResponse | null,
  response: { audit: DeepAuditRecord; reused: boolean },
): number {
  if (!current?.mostRecent) {
    return current?.previousCount ?? 0;
  }
  if (response.reused || current.mostRecent.id === response.audit.id) {
    return current.previousCount;
  }
  return current.previousCount + 1;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unexpected Deep Audit error";
}

function formatTimestamp(value: number): string {
  return new Date(value).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
