import type { CheckRecord } from "./db.ts";
import type { SkillResult } from "./skills/types.ts";
import { generateReport } from "./report.ts";
import { writeFileSync } from "fs";
import { formatScore, formatSkillScore, summarizeResults } from "./output-summary.ts";
import { escapeMarkdownLabel, safeReportUrl } from "./report-sanitize.ts";
import { sanitizeEvidenceLabel, sanitizeSourceLabel } from "../shared/report-url.ts";
import { AUDIT_UI, auditLocaleForLanguage, formatAuditLocation, localizedConfidenceValue, localizedFindingText, localizedSkillName, localizedVerdictLabel } from "./audit/localization.ts";

const VERDICT_ICON: Record<string, string> = { pass: "✅", warn: "⚠️", fail: "❌", skipped: "–" };
const SEVERITY_ICON: Record<string, string> = { info: "ℹ️", warn: "⚠️", error: "❌" };
const PROVIDER_LABEL: Record<string, string> = {
  copyscape: "Copyscape",
  "gemini-ai-detection": "Gemini AI Detection",
  "gemini-grounded-plagiarism": "Gemini Grounded Plagiarism",
  "gemini-grounded": "Gemini 3.1 Pro + Google Search",
  "gemini-deep-research": "Gemini Deep Research",
  "exa-search": "Exa Search",
  "exa-deep-reasoning": "Exa Deep Reasoning",
  minimax: "MiniMax",
  anthropic: "Anthropic",
  openrouter: "OpenRouter",
  languagetool: "LanguageTool",
  "languagetool-selfhosted": "LanguageTool self-hosted",
  "semantic-scholar": "Semantic Scholar",
  openalex: "OpenAlex",
  "cloudflare-vectorize": "Cloudflare Vectorize",
  pinecone: "Pinecone",
  "upstash-vector": "Upstash Vector",
};

export function generateMarkdownReport(record: Omit<CheckRecord, "id" | "createdAt"> & { createdAt?: string }): string {
  const overall = summarizeResults(record.results);
  const now = record.createdAt ?? new Date().toISOString().slice(0, 16);
  const sourceLabel = sanitizeSourceLabel(record.source);
  const locale = auditLocaleForLanguage(record.audit?.language);
  const labels = AUDIT_UI[locale];

  const title = locale === "he" ? labels.qualityReport : "CheckApp Report";
  const sourceHeader = locale === "he" ? labels.source : "Source";
  const wordsHeader = locale === "he" ? labels.words : "Words";
  const dateHeader = locale === "he" ? labels.date : "Date";
  const apiCostHeader = locale === "he" ? labels.apiCost : "API cost";
  const overallHeader = locale === "he" ? "סיכום כולל" : "Overall";
  const providerHeader = locale === "he" ? labels.provider : "Provider";
  let md = `# ${title}\n\n`;
  md += `**${sourceHeader}:** ${sourceLabel}\n`;
  md += `**${wordsHeader}:** ${record.wordCount.toLocaleString()}\n`;
  md += `**${dateHeader}:** ${now}\n`;
  md += `**${apiCostHeader}:** $${record.totalCostUsd.toFixed(3)}\n`;
  md += `**${overallHeader}:** ${formatScore(overall.score)} ${VERDICT_ICON[overall.verdict] ?? ""} ${markdownVerdict(overall.verdict, locale)}\n\n`;
  md += `---\n\n`;

  for (const r of record.results) {
    md += `## ${VERDICT_ICON[r.verdict] ?? ""} ${localizedSkillName(r, locale)} — ${formatSkillScore(r)} ${markdownVerdict(r.verdict, locale)}\n\n`;
    if (r.provider) md += `**${providerHeader}:** ${PROVIDER_LABEL[r.provider] ?? r.provider}\n\n`;
    md += `${localizedMarkdownSummary(r, locale, record.audit?.coverage)}\n\n`;
    // Match the HTML report: for fact-check, show only problems and collapse
    // verified ("info") claims to a count line; other skills keep their info
    // findings that carry sources.
    const isFactCheck = r.skillId === "fact-check" || r.skillId === "fact-check-grounded";
    // Only "supported" info findings are verified claims; other fact-check info
    // findings (e.g. provider-setup guidance) stay visible, not collapsed.
    const isVerifiedClaim = (f: (typeof r.findings)[number]) => f.severity === "info" && f.status === "supported";
    const visible = r.findings.filter(f => f.severity === "warn" || f.severity === "error" || (!isFactCheck && (f.sources?.length ?? 0) > 0) || (isFactCheck && f.severity === "info" && !isVerifiedClaim(f)));
    const verifiedCount = isFactCheck ? r.findings.filter(isVerifiedClaim).length : 0;
    if (verifiedCount > 0) {
      md += `✓ ${verifiedCount} ${locale === "he" ? "טענות אומתו (לא מוצגות)" : (verifiedCount === 1 ? "claim verified (not shown)" : "claims verified (not shown)")}\n\n`;
    }
    if (visible.length > 0) {
      for (const f of visible) {
        md += `- ${SEVERITY_ICON[f.severity] ?? ""} ${localizedFindingText(f, locale)}\n`;
        if (f.quote) md += `  > "${f.quote}"\n`;
        if (f.location) md += `  ${formatAuditLocation(f.location, locale)}\n`;
        if (f.confidence) md += `  ${labels.confidence}: ${localizedConfidenceValue(f.confidence, locale)}\n`;
        if (f.confidenceRationale) md += `  ${labels.confidenceRationale}: ${f.confidenceRationale}\n`;
        if (f.searchQueries?.length) md += `  ${labels.search}: ${f.searchQueries.join(" | ")}\n`;
        if (f.rewrite) md += `  ${labels.suggestedRewrite}: ${f.rewrite}\n`;
        for (const source of f.sources?.slice(0, 2) ?? []) {
          const safeUrl = safeReportUrl(source.url);
          const label = escapeMarkdownLabel(sanitizeEvidenceLabel(source.title ?? source.url));
          md += safeUrl ? `  ${labels.source}: [${label}](${safeUrl})\n` : `  ${labels.source}: ${label}\n`;
        }
      }
      md += `\n`;
    }
  }

  md += `---\n\n`;
  md += `*Generated by [CheckApp](https://github.com/sharonds/checkapp) — MIT License*\n`;
  return md;
}

function localizedMarkdownSummary(
  result: SkillResult,
  locale: ReturnType<typeof auditLocaleForLanguage>,
  coverage?: NonNullable<CheckRecord["audit"]>["coverage"],
): string {
  if (result.skillId !== "fact-check-grounded" && result.skillId !== "fact-check") return result.summary;
  if (!coverage) return result.summary;
  const unsupported = result.findings.filter((finding) => finding.status === "unsupported" || /unsupported|לא נתמך/i.test(finding.text)).length;
  const providerErrors = result.findings.filter((finding) => finding.status === "provider_error").length;
  const unverified = result.findings.filter((finding) => finding.status !== "provider_error" && (finding.status === "unverified" || /unverified|לא אומת/i.test(finding.text))).length;
  return AUDIT_UI[locale].checkedClaims(
    coverage.claimsChecked,
    unsupported,
    unverified,
    result.provider,
    coverage.claimsSkipped,
    coverage.budgetStopReason,
    providerErrors,
  );
}

function markdownVerdict(verdict: string, locale: ReturnType<typeof auditLocaleForLanguage>): string {
  return locale === "he" ? localizedVerdictLabel(verdict, locale) : verdict.toUpperCase();
}

export function exportReport(
  record: Omit<CheckRecord, "id" | "createdAt"> & { createdAt?: string },
  outputPath: string
): void {
  if (outputPath.endsWith(".md")) {
    writeFileSync(outputPath, generateMarkdownReport(record));
  } else {
    // Default to HTML
    writeFileSync(outputPath, generateReport(record));
  }
}
