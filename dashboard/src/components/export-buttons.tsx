"use client";

import { Download } from "lucide-react";
import { formatDateTime, formatNumber } from "@/lib/format";
import {
  sanitizeEvidenceLabel,
  sanitizeHttpReportUrl,
  sanitizeSourceLabel,
  sourceFilenameSlug,
} from "../../../shared/report-url";
import {
  AUDIT_UI,
  auditLocaleForLanguage,
  formatAuditLocation,
  localizedConfidenceValue,
  localizedFindingText,
  localizedVerdictLabel,
  localizedSkillName,
  localizedSkillSummary,
  type AuditCoverageSummary,
  type AuditLocale,
} from "@/lib/audit-localization";
import type { AuditDirection, AuditLanguage, AuditLocation } from "@/lib/normalize";

interface SkillResult {
  skillId?: string;
  name: string;
  score: number;
  verdict: string;
  summary: string;
  provider?: string;
  findings: Array<{
    severity: string;
    text: string;
    status?: string;
    quote?: string;
    confidence?: string;
    confidenceRationale?: string;
    explanation?: string;
    explanationLanguage?: AuditLanguage;
    rewrite?: string;
    location?: AuditLocation;
    searchQueries?: string[];
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
  auditLanguage?: AuditLanguage;
  auditDirection?: AuditDirection;
  auditCoverage?: AuditCoverageSummary;
}

export function generateMarkdown(props: ExportButtonsProps): string {
  const lines: string[] = [];
  const sourceLabel = sanitizeSourceLabel(props.source);
  const locale = auditLocaleForLanguage(props.auditLanguage);
  const labels = AUDIT_UI[locale];
  lines.push(`# ${labels.qualityReport}`);
  lines.push("");
  lines.push(`**${labels.source}:** ${sourceLabel}`);
  lines.push(`**${labels.date}:** ${formatDateTime(props.createdAt)}`);
  lines.push(`**${labels.score}:** ${formatScore(props.score)} (${localizedVerdictLabel(props.verdict, locale)})`);
  lines.push(`**${labels.words}:** ${formatNumber(props.wordCount)}`);
  lines.push(`**${labels.totalCost}:** ${formatCurrency(props.totalCost)}`);
  lines.push("");

  for (const r of props.results) {
    lines.push(`## ${localizedSkillName({ skillId: r.skillId ?? "", name: r.name }, locale)}`);
    lines.push("");
    lines.push(`- **${labels.score}:** ${formatScore(r.score)} (${localizedVerdictLabel(r.verdict, locale)})`);
    if (r.provider) lines.push(`- **${labels.provider}:** ${r.provider}`);
    lines.push(`- **${labels.summary}:** ${localizedSkillSummary({ ...r, skillId: r.skillId ?? "" }, locale, props.auditCoverage)}`);
    lines.push(`- **${labels.cost}:** ${formatCurrency(r.costUsd)}`);

    const issues = r.findings.filter(
      (f) => f.severity === "warn" || f.severity === "error" || (f.sources?.length ?? 0) > 0
    );
    if (issues.length > 0) {
      lines.push("");
      lines.push(`### ${labels.findings}`);
      lines.push("");
      for (const f of issues) {
        lines.push(
          `- ${f.severity === "error" ? "[ERROR]" : "[WARN]"} ${localizedFindingText(f, locale)}`
        );
        if (f.quote) {
          lines.push(`  > ${f.quote}`);
        }
        if (f.location) {
          lines.push(`  ${formatAuditLocation(f.location, locale)}`);
        }
        if (f.confidence) {
          lines.push(`  ${labels.confidence}: ${localizedConfidenceValue(f.confidence, locale)}`);
        }
        if (f.confidenceRationale) {
          lines.push(`  ${labels.confidenceRationale}: ${f.confidenceRationale}`);
        }
        if (f.searchQueries?.length) {
          lines.push(`  ${labels.search}: ${f.searchQueries.join(" | ")}`);
        }
        if (f.rewrite) {
          lines.push(`  ${labels.suggestedRewrite}: ${f.rewrite}`);
        }
        for (const source of f.sources?.slice(0, 4) ?? []) {
          const safeUrl = sanitizeHttpReportUrl(source.url);
          const label = escapeMarkdownLabel(sanitizeEvidenceLabel(source.title ?? source.url));
          lines.push(safeUrl ? `  ${labels.source}: [${label}](${safeUrl})` : `  ${labels.source}: ${label}`);
        }
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function generateHtml(props: ExportButtonsProps): string {
  const locale = auditLocaleForLanguage(props.auditLanguage);
  const labels = AUDIT_UI[locale];
  const rootDir = locale === "he" ? "rtl" : "ltr";
  const sourceLabel = sanitizeSourceLabel(props.source);
  const sections = props.results.map((r) => {
    const issues = r.findings.filter(
      (f) => f.severity === "warn" || f.severity === "error" || (f.sources?.length ?? 0) > 0
    );
    const findings = issues.length === 0 ? "" : `
      <h3>${escapeHtml(labels.findings)}</h3>
      <ul>
        ${issues.map((f) => `
          <li>
            <strong>${f.severity === "error" ? "[ERROR]" : "[WARN]"}</strong> ${escapeHtml(localizedFindingText(f, locale))}
            ${f.quote ? `<blockquote dir="auto">${escapeHtml(f.quote)}</blockquote>` : ""}
            ${f.location ? `<div>${escapeHtml(formatAuditLocation(f.location, locale))}</div>` : ""}
            ${f.confidence ? `<div>${escapeHtml(labels.confidence)}: ${escapeHtml(localizedConfidenceValue(f.confidence, locale))}</div>` : ""}
            ${f.confidenceRationale ? `<div>${escapeHtml(labels.confidenceRationale)}: ${escapeHtml(f.confidenceRationale)}</div>` : ""}
            ${f.rewrite ? `<div dir="auto"><strong>${escapeHtml(labels.suggestedRewrite)}:</strong> ${escapeHtml(f.rewrite)}</div>` : ""}
            ${(f.sources?.slice(0, 4) ?? []).map((source) => {
              const safeUrl = sanitizeHttpReportUrl(source.url);
              const label = escapeHtml(sanitizeEvidenceLabel(source.title ?? source.url));
              return safeUrl
                ? `<div>${escapeHtml(labels.source)}: <a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${label}</a></div>`
                : `<div>${escapeHtml(labels.source)}: ${label}</div>`;
            }).join("")}
          </li>`).join("")}
      </ul>`;

    return `
      <section>
        <h2>${escapeHtml(localizedSkillName({ skillId: (r as { skillId?: string }).skillId ?? "", name: r.name }, locale))}</h2>
        <ul>
          <li><strong>${escapeHtml(labels.score)}:</strong> ${escapeHtml(formatScore(r.score))} (${escapeHtml(localizedVerdictLabel(r.verdict, locale))})</li>
          ${r.provider ? `<li><strong>${escapeHtml(labels.provider)}:</strong> ${escapeHtml(r.provider)}</li>` : ""}
          <li><strong>${escapeHtml(labels.summary)}:</strong> ${escapeHtml(localizedSkillSummary({ ...r, skillId: r.skillId ?? "" }, locale, props.auditCoverage))}</li>
          <li><strong>${escapeHtml(labels.cost)}:</strong> ${escapeHtml(formatCurrency(r.costUsd))}</li>
        </ul>
        ${findings}
      </section>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="${locale}" dir="${rootDir}">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>${escapeHtml(labels.qualityReport)} — ${escapeHtml(sourceLabel)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #e5e7eb; padding-bottom: 0.5rem; }
  h2 { margin-top: 2rem; color: #374151; }
  h3 { color: #6b7280; }
  section { margin-top: 2rem; }
  li { margin: 0.25rem 0; }
  blockquote { border-inline-start: 3px solid #d1d5db; padding-inline-start: 1rem; color: #6b7280; font-style: italic; margin: 0.5rem 0; }
  strong { font-weight: 600; }
  a { color: #2563eb; }
</style>
</head>
<body>
<h1>${escapeHtml(labels.qualityReport)}</h1>
<p><strong>${escapeHtml(labels.source)}:</strong> ${escapeHtml(sourceLabel)}</p>
<p><strong>${escapeHtml(labels.date)}:</strong> ${escapeHtml(formatDateTime(props.createdAt))}</p>
<p><strong>${escapeHtml(labels.score)}:</strong> ${escapeHtml(formatScore(props.score))} (${escapeHtml(localizedVerdictLabel(props.verdict, locale))})</p>
<p><strong>${escapeHtml(labels.words)}:</strong> ${escapeHtml(formatNumber(props.wordCount))}</p>
<p><strong>${escapeHtml(labels.apiCost)}:</strong> ${escapeHtml(formatCurrency(props.totalCost))}</p>
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
  const slug = sourceFilenameSlug(props.source);

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
