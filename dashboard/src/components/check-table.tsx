"use client";

import Link from "next/link";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { VerdictBadge } from "./verdict-badge";

export interface CheckRow {
  id: string;
  source: string;
  score: number;
  verdict: "pass" | "warn" | "fail";
  words: number;
  costUsd: number;
  createdAt: string;
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-600 dark:text-green-400";
  if (score >= 50) return "text-amber-600 dark:text-amber-400";
  return "text-red-600 dark:text-red-400";
}

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffMs = now - then;
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

export function CheckTable({ checks }: { checks: CheckRow[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Source</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead>Verdict</TableHead>
          <TableHead className="text-right">Words</TableHead>
          <TableHead className="text-right">Cost</TableHead>
          <TableHead>Date</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {checks.map((check) => (
          <TableRow key={check.id} className="cursor-pointer hover:bg-muted/50">
            <TableCell>
              <Link
                href={`/reports/${check.id}`}
                className="block max-w-[40ch] truncate hover:underline"
                title={check.source}
              >
                {check.source.length > 40
                  ? check.source.slice(0, 40) + "\u2026"
                  : check.source}
              </Link>
            </TableCell>
            <TableCell className={`text-right font-medium ${scoreColor(check.score)}`}>
              {check.score}
            </TableCell>
            <TableCell>
              <VerdictBadge verdict={check.verdict} />
            </TableCell>
            <TableCell className="text-right">
              {check.words.toLocaleString()}
            </TableCell>
            <TableCell className="text-right">
              ${check.costUsd.toFixed(4)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {relativeTime(check.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
