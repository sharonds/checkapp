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
import { formatNumber, formatShortDate } from "@/lib/format";

export interface CheckRow {
  id: string;
  source: string;
  score: number;
  verdict: "pass" | "warn" | "fail" | "skipped";
  words: number;
  costUsd: number;
  createdAt: string;
}

function scoreColor(score: number): string {
  if (score >= 75) return "text-score-pass";
  if (score >= 50) return "text-score-warn";
  return "text-score-fail";
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
              {formatNumber(check.words)}
            </TableCell>
            <TableCell className="text-right">
              ${check.costUsd.toFixed(4)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatShortDate(check.createdAt)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
