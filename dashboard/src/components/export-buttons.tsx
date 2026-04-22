"use client";

import { Download } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";

interface SkillResult {
  name: string;
  score: number;
  verdict: string;
  summary: string;
  findings: Array<{ severity: string; text: string; quote?: string }>;
  costUsd: number;
}

interface ExportButtonsProps {
  source: string;
  score: number;
  verdict: string;
  wordCount: number;
  totalCost: number;
  createdAt: string;
  results: SkillResult[];
}

function generateMarkdown(props: ExportButtonsProps): string {
  const lines: string[] = [];
  lines.push(`# Article Check Report`);
  lines.push("");
  lines.push(`**Source:** ${props.source}`);
  lines.push(`**Date:** ${formatDateTime(props.createdAt)}`);
  lines.push(`**Score:** ${props.score}/100 (${props.verdict.toUpperCase()})`);
  lines.push(`**Word Count:** ${formatNumber(props.wordCount)}`);
  lines.push(`**Total Cost:** $${props.totalCost.toFixed(4)}`);
  lines.push("");

  for (const r of props.results) {
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`- **Score:** ${r.score}/100 (${r.verdict})`);
    lines.push(`- **Summary:** ${r.summary}`);
    lines.push(`- **Cost:** $${r.costUsd.toFixed(4)}`);

    const issues = r.findings.filter(
      (f) => f.severity === "warn" || f.severity === "error"
    );
    if (issues.length > 0) {
      lines.push("");
      lines.push("### Findings");
      lines.push("");
      for (const f of issues) {
        lines.push(
          `- ${f.severity === "error" ? "[ERROR]" : "[WARN]"} ${f.text}`
        );
        if (f.quote) {
          lines.push(`  > ${f.quote}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function generateHtml(props: ExportButtonsProps): string {
  const md = generateMarkdown(props);
  // Simple markdown-to-HTML conversion for export
  const html = md
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/^  > (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/\n\n/g, "\n<br/>\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Article Check Report — ${props.source}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { margin-top: 2rem; color: #374151; }
  h3 { color: #6b7280; }
  li { margin: 0.25rem 0; }
  blockquote { border-left: 3px solid #d1d5db; padding-left: 1rem; color: #6b7280; font-style: italic; margin: 0.5rem 0; }
  strong { font-weight: 600; }
</style>
</head>
<body>
${html}
</body>
</html>`;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportButtons(props: ExportButtonsProps) {
  const slug = props.source
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40)
    .toLowerCase();

  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() =>
          downloadFile(
            generateMarkdown(props),
            `report-${slug}.md`,
            "text/markdown"
          )
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
      >
        <Download className="h-3.5 w-3.5" />
        Download MD
      </button>
      <button
        type="button"
        onClick={() =>
          downloadFile(
            generateHtml(props),
            `report-${slug}.html`,
            "text/html"
          )
        }
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs font-medium shadow-sm hover:bg-accent hover:text-accent-foreground"
      >
        <Download className="h-3.5 w-3.5" />
        Download HTML
      </button>
    </div>
  );
}
