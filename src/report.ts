import type { SkillResult } from "./skills/types.ts";
import type { CheckRecord } from "./db.ts";
import { formatScore, formatSkillScore, summarizeResults } from "./output-summary.ts";
import { sanitizeEvidenceLabel, sanitizeSourceLabel } from "../shared/report-url.ts";
import { safeReportUrl } from "./report-sanitize.ts";
import {
  AUDIT_UI,
  auditLocaleForFinding,
  auditLocaleForLanguage,
  formatAuditLocation,
  localizedFindingText,
  localizedFindingStatus,
  localizedSkillName,
  localizedVerdictLabel,
  type AuditLocale,
} from "./audit/localization.ts";

const VERDICT_COLOR: Record<string, string> = {
  pass: "#16a34a",
  warn: "#d97706",
  fail: "#dc2626",
  skipped: "#6b7280",
};

const VERDICT_BG: Record<string, string> = {
  pass: "#f0fdf4",
  warn: "#fffbeb",
  fail: "#fef2f2",
  skipped: "#f9fafb",
};

const VERDICT_BORDER: Record<string, string> = {
  pass: "#bbf7d0",
  warn: "#fde68a",
  fail: "#fecaca",
  skipped: "#e5e7eb",
};

const SEVERITY_ICON: Record<string, string> = {
  warn: "⚠️",
  error: "❌",
};

interface ProviderMeta {
  label: string;
  color: string;
  href: string;
  processor: string;
}

const PROVIDER_LABEL: Record<string, ProviderMeta> = {
  copyscape: { label: "Copyscape", color: "#0078D4", href: "https://copyscape.com", processor: "Copyscape" },
  "gemini-ai-detection": { label: "Gemini AI Detection", color: "#4285f4", href: "https://ai.google.dev", processor: "Google Gemini" },
  "gemini-grounded-plagiarism": { label: "Gemini Grounded Plagiarism", color: "#4285f4", href: "https://ai.google.dev", processor: "Google Gemini" },
  gemini: { label: "Gemini", color: "#4285f4", href: "https://ai.google.dev", processor: "Google Gemini" },
  "gemini-grounded": { label: "Gemini 3 Pro Preview + Google Search", color: "#4285f4", href: "https://ai.google.dev", processor: "Google Gemini" },
  "gemini-deep-research": { label: "Gemini Deep Research", color: "#4285f4", href: "https://ai.google.dev", processor: "Google Gemini" },
  "exa-search": { label: "Exa AI", color: "#7c3aed", href: "https://exa.ai", processor: "Exa AI" },
  "exa-deep-reasoning": { label: "Exa AI", color: "#7c3aed", href: "https://exa.ai", processor: "Exa AI" },
  minimax: { label: "MiniMax", color: "#0891b2", href: "https://platform.minimax.io", processor: "MiniMax" },
  anthropic: { label: "Anthropic", color: "#6b46c1", href: "https://www.anthropic.com", processor: "Anthropic" },
  openrouter: { label: "OpenRouter", color: "#111827", href: "https://openrouter.ai", processor: "OpenRouter" },
  "llm-fallback": { label: "LLM fallback", color: "#0891b2", href: "", processor: "Configured LLM provider" },
  languagetool: { label: "LanguageTool", color: "#2563eb", href: "https://languagetool.org", processor: "LanguageTool" },
  "languagetool-selfhosted": { label: "LanguageTool self-hosted", color: "#2563eb", href: "", processor: "Self-hosted LanguageTool" },
  "semantic-scholar": { label: "Semantic Scholar", color: "#1857b6", href: "https://www.semanticscholar.org", processor: "Semantic Scholar" },
  openalex: { label: "OpenAlex", color: "#0f766e", href: "https://openalex.org", processor: "OpenAlex" },
  "cloudflare-vectorize": { label: "Cloudflare Vectorize", color: "#f38020", href: "https://www.cloudflare.com/developer-platform/products/vectorize/", processor: "Cloudflare Vectorize" },
  pinecone: { label: "Pinecone", color: "#1f7a8c", href: "https://www.pinecone.io", processor: "Pinecone" },
  "upstash-vector": { label: "Upstash Vector", color: "#00e9a3", href: "https://upstash.com", processor: "Upstash" },
};

const SKILL_ENGINE_FALLBACK: Record<string, ProviderMeta> = {
  plagiarism: PROVIDER_LABEL.copyscape,
  "ai-detection": PROVIDER_LABEL.copyscape,
  seo: { label: "Offline", color: "#6b7280", href: "", processor: "Offline" },
  "fact-check": PROVIDER_LABEL["exa-search"],
};

function scoreBar(score: number | null, verdict: string): string {
  const color = VERDICT_COLOR[verdict] ?? "#6b7280";
  const width = score === null ? 0 : score;
  return `<div style="background:#e5e7eb;border-radius:4px;height:6px;width:100%;margin-top:10px">
    <div style="background:${color};border-radius:4px;height:6px;width:${width}%;transition:width 0.3s"></div>
  </div>`;
}

function badgeMeta(result: SkillResult): ProviderMeta | undefined {
  return (result.provider ? PROVIDER_LABEL[result.provider] : undefined) ?? SKILL_ENGINE_FALLBACK[result.skillId];
}

function engineBadge(result: SkillResult): string {
  const eng = badgeMeta(result);
  if (!eng) return "";
  return `<span style="font-size:11px;font-weight:500;color:${eng.color};background:${eng.color}18;padding:2px 8px;border-radius:10px;border:1px solid ${eng.color}44">${eng.label}</span>`;
}

function usedProviders(results: SkillResult[]): ProviderMeta[] {
  const seen = new Map<string, ProviderMeta>();
  for (const result of results) {
    if (!result.provider) continue;
    const meta = PROVIDER_LABEL[result.provider];
    if (!meta || !meta.href) continue;
    seen.set(meta.processor, meta);
  }
  return [...seen.values()];
}

function skillCard(r: SkillResult, locale: AuditLocale, audit?: CheckRecord["audit"]): string {
  const color = VERDICT_COLOR[r.verdict] ?? "#6b7280";
  const bg = VERDICT_BG[r.verdict] ?? "#f9fafb";
  const border = VERDICT_BORDER[r.verdict] ?? "#e5e7eb";

  const labels = AUDIT_UI[locale];
  const badge = `<span style="background:${color};color:#fff;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:0.04em">${escapeHtml(localizedVerdictLabel(r.verdict, locale))}</span>`;
  const skillName = localizedSkillName(r, locale);
  const summary = localizedSkillSummary(r, locale, audit);

  // Only show warn and error findings — info is noise when skills run
  const visibleFindings = r.findings.filter((f) => f.severity === "warn" || f.severity === "error" || (f.sources?.length ?? 0) > 0);
  const findingsHtml = visibleFindings.length === 0 ? "" : `
    <ul style="margin:12px 0 0 0;padding:0;list-style:none">
      ${visibleFindings.map((f) => `
        <li style="margin-bottom:8px;padding:8px 12px;background:#fff;border-radius:6px;border:1px solid #f3f4f6;font-size:13px;color:#374151;line-height:1.5">
          <span style="margin-inline-end:5px">${SEVERITY_ICON[f.severity] ?? ""}</span>${escapeHtml(localizedFindingLead(f, locale) ?? f.text)}
          ${f.quote ? `<div dir="auto" style="margin-top:4px;padding-block:4px;padding-inline-end:8px;padding-inline-start:8px;background:#f9fafb;border-inline-start:3px solid #d1d5db;border-radius:2px;font-style:italic;font-size:12px;color:#6b7280">"${escapeHtml(f.quote.slice(0, 220))}${f.quote.length > 220 ? "…" : ""}"</div>` : ""}
          ${f.location ? `<div style="margin-top:4px;font-size:11px;color:#6b7280">${escapeHtml(formatAuditLocation(f.location, localeForFindingOrReport(f, locale)))}</div>` : ""}
          ${f.matchType || f.groundingMode ? `<div style="margin-top:4px;font-size:11px;color:#6b7280">${[
            f.matchType ? `${labels.matchType}: ${f.matchType}` : "",
            f.groundingMode ? `${labels.grounding}: ${f.groundingMode}` : "",
          ].filter(Boolean).map(escapeHtml).join(" · ")}</div>` : ""}
          ${f.confidenceRationale ? `<div style="margin-top:4px;font-size:11px;color:#6b7280"><strong>${escapeHtml(labels.confidenceRationale)}:</strong> ${escapeHtml(f.confidenceRationale)}</div>` : ""}
          ${f.rewrite ? `<div dir="auto" style="margin-top:6px;padding:6px 8px;background:#ecfdf5;border:1px solid #bbf7d0;border-radius:4px;font-size:12px;color:#065f46"><strong>${escapeHtml(labels.suggestedRewrite)}:</strong> ${escapeHtml(f.rewrite)}</div>` : ""}
          ${f.sources?.length ? `<div style="margin-top:6px;font-size:12px;color:#4b5563">${escapeHtml(labels.source)}: ${f.sources.slice(0, 2).map((s) => {
            const safeUrl = safeReportUrl(s.url);
            const label = escapeHtml(sanitizeEvidenceLabel(s.title || s.url));
            return safeUrl
              ? `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:#2563eb;text-decoration:none">${label}</a>`
              : label;
          }).join(", ")}</div>` : ""}
        </li>`).join("")}
    </ul>`;

  return `<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:20px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <span style="font-weight:700;font-size:15px;color:#111827">${escapeHtml(skillName)}</span>
        <span style="margin-inline-start:8px">${engineBadge(r)}</span>
      </div>
      <span style="display:flex;align-items:center;gap:10px;flex-shrink:0;margin-inline-start:16px">
        <span style="font-size:22px;font-weight:800;color:${color}">${escapeHtml(formatSkillScore(r))}</span>
        ${badge}
      </span>
    </div>
    ${scoreBar(r.verdict === "skipped" ? null : r.score, r.verdict)}
    <p style="margin:8px 0 0 0;font-size:13px;color:#6b7280">${escapeHtml(summary)}</p>
    ${r.error ? `<p style="margin:8px 0 0 0;font-size:12px;color:#dc2626">⚠ ${escapeHtml(r.error)}</p>` : ""}
    ${findingsHtml}
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function localeForFindingOrReport(f: SkillResult["findings"][number], reportLocale: AuditLocale): AuditLocale {
  const findingLocale = auditLocaleForFinding(f);
  return findingLocale === "he" ? "he" : reportLocale;
}

function localizedFindingLead(f: SkillResult["findings"][number], reportLocale: AuditLocale): string | undefined {
  const locale = localeForFindingOrReport(f, reportLocale);
  const status = localizedFindingStatus(f, locale);
  if (!status) return undefined;
  if (f.status === "unsupported" || f.status === "unverified" || f.status === "plagiarism_match") {
    return localizedFindingText(f, locale);
  }
  if (f.explanation) return f.confidence ? `${status} (${f.confidence}): ${f.explanation}` : `${status}: ${f.explanation}`;
  return f.confidence ? `${status} (${f.confidence})` : status;
}

function localizedSkillSummary(r: SkillResult, locale: AuditLocale, audit?: CheckRecord["audit"]): string {
  if (r.skillId !== "fact-check-grounded" && r.skillId !== "fact-check") return r.summary;
  const coverage = audit?.coverage;
  if (!coverage) return r.summary;
  const unsupported = r.findings.filter((f) => f.status === "unsupported" || f.text.toLowerCase().includes("unsupported")).length;
  const unverified = r.findings.filter((f) => f.status === "unverified" || f.text.toLowerCase().includes("unverified")).length;
  return AUDIT_UI[locale].checkedClaims(
    coverage.claimsChecked,
    unsupported,
    unverified,
    r.provider,
    coverage.claimsSkipped,
    coverage.budgetStopReason,
  );
}

function overallBanner(score: number | null, verdict: string, wordCount: number, costUsd: number, now: string, locale: AuditLocale): string {
  const color = VERDICT_COLOR[verdict] ?? "#6b7280";
  const labels = AUDIT_UI[locale];
  const label = localizedVerdictLabel(verdict, locale);
  const labelBg = verdict === "skipped"
    ? "#6b728022"
    : verdict === "pass" ? "#16a34a22" : verdict === "warn" ? "#d9770622" : "#dc262622";
  const accent = verdict === "skipped"
    ? "#6b7280"
    : verdict === "pass" ? "#16a34a" : verdict === "warn" ? "#d97706" : "#dc2626";

  // Circular score indicator SVG
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dash = ((score ?? 0) / 100) * circumference;
  const circle = `<svg width="80" height="80" style="transform:rotate(-90deg)">
    <circle cx="40" cy="40" r="${radius}" fill="none" stroke="#ffffff18" stroke-width="5"/>
    <circle cx="40" cy="40" r="${radius}" fill="none" stroke="${accent}" stroke-width="5"
      stroke-dasharray="${dash.toFixed(1)} ${circumference.toFixed(1)}" stroke-linecap="round"/>
  </svg>`;

  return `<div style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);color:#fff;border-radius:14px;padding:24px 28px;margin-bottom:20px;box-shadow:0 4px 24px #0002">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px">
      <div style="display:flex;align-items:center;gap:20px">
        <div style="position:relative;width:80px;height:80px;flex-shrink:0">
          ${circle}
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:${accent}">${score === null ? "N/A" : score}</div>
        </div>
        <div>
          <div style="font-size:11px;letter-spacing:0.1em;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:4px">CheckApp</div>
          <div style="font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:8px">${escapeHtml(labels.qualityReport)}</div>
          <span style="background:${labelBg};color:${accent};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;border:1px solid ${accent}44">${label}</span>
        </div>
      </div>
      <div style="text-align:end;font-size:12px;color:#64748b;line-height:2.2">
        <div><span style="color:#94a3b8">${escapeHtml(labels.words)}</span> &nbsp;<strong style="color:#e2e8f0">${wordCount.toLocaleString()}</strong></div>
        <div><span style="color:#94a3b8">${escapeHtml(labels.apiCost)}</span> &nbsp;<strong style="color:#e2e8f0">$${costUsd.toFixed(3)}</strong></div>
        <div><span style="color:#94a3b8">${now}</span></div>
      </div>
    </div>
  </div>`;
}

function summaryBlock(result: SkillResult): string {
  const infoFindings = result.findings.filter((f) => f.severity === "info");
  if (infoFindings.length === 0) return "";

  const rows = infoFindings.map((f) => {
    const [label, ...rest] = f.text.split(": ");
    const value = rest.join(": ");
    return `<div style="display:flex;gap:8px;margin-bottom:6px">
      <span style="font-weight:600;color:#0e7490;min-width:80px;font-size:13px">${escapeHtml(label)}</span>
      <span style="color:#334155;font-size:13px">${escapeHtml(value)}</span>
    </div>`;
  }).join("");

  return `<div style="background:#ecfeff;border:1px solid #a5f3fc;border-radius:10px;padding:20px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <span style="font-weight:700;font-size:15px;color:#0e7490">${escapeHtml(result.name)}</span>
      ${engineBadge(result)}
    </div>
    ${rows}
  </div>`;
}

export function generateReport(record: Omit<CheckRecord, "id" | "createdAt"> & { createdAt?: string }): string {
  const overall = summarizeResults(record.results);
  const locale = auditLocaleForLanguage(record.audit?.language);
  const labels = AUDIT_UI[locale];
  const sourceLabel = sanitizeSourceLabel(record.source);

  const now = record.createdAt ?? new Date().toISOString().replace("T", " ").slice(0, 16);
  const providers = usedProviders(record.results);
  const providerLinks = providers.map((p) =>
    `<a class="engine-link" href="${p.href}" target="_blank" rel="noopener noreferrer" style="color:${p.color};border-color:${p.color}44;background:${p.color}08">${escapeHtml(p.label)}</a>`
  ).join("");
  const footerProviderLinks = providers.map((p) =>
    `<a class="footer-link" href="${p.href}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.label)}</a>`
  ).join("");
  const providerNames = providers.map((p) => p.processor).join(", ");
  const providerDisclaimer = providerNames
    ? labels.footerDisclaimerProviders(escapeHtml(providerNames))
    : labels.footerDisclaimerOffline;
  const htmlLang = locale;
  const htmlDir = locale === "he" ? "rtl" : "ltr";

  return `<!DOCTYPE html>
<html lang="${htmlLang}" dir="${htmlDir}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CheckApp — ${escapeHtml(sourceLabel)}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; margin: 0; padding: 32px 16px; color: #111827; }
    .container { max-width: 780px; margin: 0 auto; }
    .source { font-size: 12px; color: #94a3b8; margin-bottom: 16px; word-break: break-all; padding: 0 2px; }
    .powered-by { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }
    .powered-by span { font-size: 11px; color: #94a3b8; }
    .engine-link { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 12px; text-decoration: none; border: 1px solid; }
    .footer { margin-top: 32px; padding: 20px; background: #fff; border-radius: 10px; border: 1px solid #e2e8f0; }
    .footer-top { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid #f1f5f9; }
    .footer-brand { font-size: 13px; font-weight: 700; color: #1e293b; }
    .footer-links { display: flex; gap: 12px; flex-wrap: wrap; }
    .footer-link { font-size: 12px; color: #3b82f6; text-decoration: none; font-weight: 500; }
    .footer-link:hover { text-decoration: underline; }
    .footer-disclaimer { font-size: 11px; color: #94a3b8; line-height: 1.6; }
    .footer-disclaimer a { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="container">
    ${overallBanner(overall.score, overall.verdict, record.wordCount, record.totalCostUsd, now, locale)}
    <div class="source">${escapeHtml(sourceLabel)}</div>
    ${(() => { const sr = record.results.find((r) => r.skillId === "summary"); return sr ? summaryBlock(sr) : ""; })()}
    <div class="powered-by">
      <span>${escapeHtml(labels.poweredBy)}</span>
      ${providerLinks || `<span>${escapeHtml(labels.offlineChecks)}</span>`}
    </div>
    ${record.results.filter((r) => r.skillId !== "summary").map((r) => skillCard(r, locale, record.audit)).join("")}
    <div class="footer">
      <div class="footer-top">
        <span class="footer-brand">CheckApp</span>
        <div class="footer-links">
          <a class="footer-link" href="https://github.com/sharonds/checkapp">GitHub</a>
          <a class="footer-link" href="https://github.com/sharonds/checkapp/blob/main/LICENSE">MIT License</a>
          ${footerProviderLinks}
        </div>
      </div>
      <p class="footer-disclaimer">
        ${escapeHtml(labels.footerDisclaimerIntro)}
        <a href="https://github.com/sharonds/checkapp/blob/main/LICENSE">MIT License</a>.
        ${providerDisclaimer}
        ${escapeHtml(labels.footerDisclaimerLiability)}
        ${escapeHtml(labels.footerDisclaimerJudgement)}
      </p>
    </div>
  </div>
</body>
</html>`;
}
