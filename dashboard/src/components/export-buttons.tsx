"use client";

import { Download } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";
import { sanitizeHttpReportUrl } from "../../../shared/report-url";

interface SkillResult {
  name: string;
  score: number;
  verdict: string;
  summary: string;
  provider?: string;
  findings: Array<{
    severity: string;
    text: string;
    quote?: string;
    confidence?: string;
    sources?: Array<{ url: string; title?: string }>;
  }>;
  costUsd: number;
}

interface ExportButtonsProps {
  source: string;
  score: number | null;
  verdict: string;
  wordCount: number;
  totalCost: number;
  createdAt: string;
  results: SkillResult[];
}

export function generateMarkdown(props: ExportButtonsProps): string {
  const lines: string[] = [];
  lines.push(`# Article Check Report`);
  lines.push("");
  lines.push(`**Source:** ${props.source}`);
  lines.push(`**Date:** ${formatDateTime(props.createdAt)}`);
  lines.push(`**Score:** ${formatScore(props.score)} (${String(props.verdict ?? "").toUpperCase()})`);
  lines.push(`**Word Count:** ${formatNumber(props.wordCount)}`);
  lines.push(`**Total Cost:** ${formatCurrency(props.totalCost)}`);
  lines.push("");

  for (const r of props.results) {
    lines.push(`## ${r.name}`);
    lines.push("");
    lines.push(`- **Score:** ${formatScore(r.score)} (${r.verdict})`);
    if (r.provider) lines.push(`- **Provider:** ${r.provider}`);
    lines.push(`- **Summary:** ${r.summary}`);
    lines.push(`- **Cost:** ${formatCurrency(r.costUsd)}`);

    const issues = r.findings.filter(
      (f) => f.severity === "warn" || f.severity === "error" || (f.sources?.length ?? 0) > 0
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
        if (f.confidence) {
          lines.push(`  Confidence: ${f.confidence}`);
        }
        for (const source of f.sources?.slice(0, 3) ?? []) {
          const safeUrl = sanitizeHttpReportUrl(source.url);
          const label = escapeMarkdownLabel(source.title ?? source.url);
          lines.push(safeUrl ? `  Source: [${label}](${safeUrl})` : `  Source: ${label}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function generateHtml(props: ExportButtonsProps): string {
  const sections = props.results.map((r) => {
    const issues = r.findings.filter(
      (f) => f.severity === "warn" || f.severity === "error" || (f.sources?.length ?? 0) > 0
    );
    const findings = issues.length === 0 ? "" : `
      <h3>Findings</h3>
      <ul>
        ${issues.map((f) => `
          <li>
            <strong>${f.severity === "error" ? "[ERROR]" : "[WARN]"}</strong> ${escapeHtml(f.text)}
            ${f.quote ? `<blockquote>${escapeHtml(f.quote)}</blockquote>` : ""}
            ${f.confidence ? `<div>Confidence: ${escapeHtml(f.confidence)}</div>` : ""}
            ${(f.sources?.slice(0, 3) ?? []).map((source) => {
              const safeUrl = sanitizeHttpReportUrl(source.url);
              const label = escapeHtml(source.title ?? source.url);
              return safeUrl
                ? `<div>Source: <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a></div>`
                : `<div>Source: ${label}</div>`;
            }).join("")}
          </li>`).join("")}
      </ul>`;

    return `
      <section>
        <h2>${escapeHtml(r.name)}</h2>
        <ul>
          <li><strong>Score:</strong> ${escapeHtml(formatScore(r.score))} (${escapeHtml(r.verdict)})</li>
          ${r.provider ? `<li><strong>Provider:</strong> ${escapeHtml(r.provider)}</li>` : ""}
          <li><strong>Summary:</strong> ${escapeHtml(r.summary)}</li>
          <li><strong>Cost:</strong> ${escapeHtml(formatCurrency(r.costUsd))}</li>
        </ul>
        ${findings}
      </section>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="en" dir="auto">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Article Check Report — ${escapeHtml(props.source)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { margin-top: 2rem; color: #374151; }
  h3 { color: #6b7280; }
  section { margin-top: 2rem; }
  li { margin: 0.25rem 0; }
  blockquote { border-left: 3px solid #d1d5db; padding-left: 1rem; color: #6b7280; font-style: italic; margin: 0.5rem 0; }
  strong { font-weight: 600; }
  a { color: #2563eb; }
</style>
</head>
<body>
<h1>Article Check Report</h1>
<p><strong>Source:</strong> ${escapeHtml(props.source)}</p>
<p><strong>Date:</strong> ${escapeHtml(formatDateTime(props.createdAt))}</p>
<p><strong>Score:</strong> ${escapeHtml(formatScore(props.score))} (${escapeHtml(String(props.verdict ?? "").toUpperCase())})</p>
<p><strong>Word Count:</strong> ${escapeHtml(formatNumber(props.wordCount))}</p>
<p><strong>Total Cost:</strong> ${escapeHtml(formatCurrency(props.totalCost))}</p>
${sections}
</body>
</html>`;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatScore(score: unknown): string {
  return typeof score === "number" && Number.isFinite(score) ? `${score}/100` : "N/A";
}

function formatCurrency(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `$${value.toFixed(4)}` : "N/A";
}

function escapeMarkdownLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\]/g, "\\]").replace(/\[/g, "\\[");
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
