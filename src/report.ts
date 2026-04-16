import type { SkillResult } from "./skills/types.ts";
import type { CheckRecord } from "./db.ts";

const VERDICT_COLOR: Record<string, string> = {
  pass: "#16a34a",
  warn: "#d97706",
  fail: "#dc2626",
};

const VERDICT_BG: Record<string, string> = {
  pass: "#f0fdf4",
  warn: "#fffbeb",
  fail: "#fef2f2",
};

const VERDICT_BORDER: Record<string, string> = {
  pass: "#bbf7d0",
  warn: "#fde68a",
  fail: "#fecaca",
};

const SEVERITY_ICON: Record<string, string> = {
  warn: "⚠️",
  error: "❌",
};

const ENGINE_LABEL: Record<string, { label: string; color: string }> = {
  "plagiarism": { label: "Copyscape", color: "#0078D4" },
  "ai-detection": { label: "Copyscape", color: "#0078D4" },
  "seo": { label: "Offline", color: "#6b7280" },
  "fact-check": { label: "Exa AI", color: "#7c3aed" },
  "tone": { label: "MiniMax", color: "#0891b2" },
  "legal": { label: "MiniMax", color: "#0891b2" },
  "summary": { label: "MiniMax", color: "#0891b2" },
  "brief": { label: "MiniMax", color: "#0891b2" },
  "purpose": { label: "MiniMax", color: "#0891b2" },
};

function scoreBar(score: number, verdict: string): string {
  const color = VERDICT_COLOR[verdict] ?? "#6b7280";
  return `<div style="background:#e5e7eb;border-radius:4px;height:6px;width:100%;margin-top:10px">
    <div style="background:${color};border-radius:4px;height:6px;width:${score}%;transition:width 0.3s"></div>
  </div>`;
}

function engineBadge(skillId: string): string {
  const eng = ENGINE_LABEL[skillId];
  if (!eng) return "";
  return `<span style="font-size:11px;font-weight:500;color:${eng.color};background:${eng.color}18;padding:2px 8px;border-radius:10px;border:1px solid ${eng.color}44">${eng.label}</span>`;
}

function skillCard(r: SkillResult): string {
  const color = VERDICT_COLOR[r.verdict] ?? "#6b7280";
  const bg = VERDICT_BG[r.verdict] ?? "#f9fafb";
  const border = VERDICT_BORDER[r.verdict] ?? "#e5e7eb";

  const badge = `<span style="background:${color};color:#fff;padding:2px 9px;border-radius:10px;font-size:11px;font-weight:700;letter-spacing:0.04em">${r.verdict.toUpperCase()}</span>`;

  // Only show warn and error findings — info is noise when skills run
  const visibleFindings = r.findings.filter((f) => f.severity === "warn" || f.severity === "error");
  const findingsHtml = visibleFindings.length === 0 ? "" : `
    <ul style="margin:12px 0 0 0;padding:0;list-style:none">
      ${visibleFindings.map((f) => `
        <li style="margin-bottom:8px;padding:8px 12px;background:#fff;border-radius:6px;border:1px solid #f3f4f6;font-size:13px;color:#374151;line-height:1.5">
          <span style="margin-right:5px">${SEVERITY_ICON[f.severity] ?? ""}</span>${escapeHtml(f.text)}
          ${f.quote ? `<div style="margin-top:4px;padding:4px 8px;background:#f9fafb;border-left:3px solid #d1d5db;border-radius:2px;font-style:italic;font-size:12px;color:#6b7280">"${escapeHtml(f.quote.slice(0, 140))}${f.quote.length > 140 ? "…" : ""}"</div>` : ""}
        </li>`).join("")}
    </ul>`;

  return `<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:20px;margin-bottom:14px">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <span style="font-weight:700;font-size:15px;color:#111827">${escapeHtml(r.name)}</span>
        <span style="margin-left:8px">${engineBadge(r.skillId)}</span>
      </div>
      <span style="display:flex;align-items:center;gap:10px;flex-shrink:0;margin-left:16px">
        <span style="font-size:22px;font-weight:800;color:${color}">${r.score}</span>
        ${badge}
      </span>
    </div>
    ${scoreBar(r.score, r.verdict)}
    <p style="margin:8px 0 0 0;font-size:13px;color:#6b7280">${escapeHtml(r.summary)}</p>
    ${r.error ? `<p style="margin:8px 0 0 0;font-size:12px;color:#dc2626">⚠ ${escapeHtml(r.error)}</p>` : ""}
    ${findingsHtml}
  </div>`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function overallBanner(score: number, verdict: string, wordCount: number, costUsd: number, now: string): string {
  const color = VERDICT_COLOR[verdict] ?? "#6b7280";
  const label = verdict === "pass" ? "✓ Ready to publish" : verdict === "warn" ? "⚠ Needs attention" : "✕ Do not publish";
  const labelBg = verdict === "pass" ? "#16a34a22" : verdict === "warn" ? "#d9770622" : "#dc262622";
  const accent = verdict === "pass" ? "#16a34a" : verdict === "warn" ? "#d97706" : "#dc2626";

  // Circular score indicator SVG
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const dash = (score / 100) * circumference;
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
          <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;color:${accent}">${score}</div>
        </div>
        <div>
          <div style="font-size:11px;letter-spacing:0.1em;color:#64748b;text-transform:uppercase;font-weight:600;margin-bottom:4px">Checkit</div>
          <div style="font-size:20px;font-weight:700;color:#f1f5f9;margin-bottom:8px">Quality Report</div>
          <span style="background:${labelBg};color:${accent};font-size:12px;font-weight:700;padding:4px 12px;border-radius:20px;border:1px solid ${accent}44">${label}</span>
        </div>
      </div>
      <div style="text-align:right;font-size:12px;color:#64748b;line-height:2.2">
        <div><span style="color:#94a3b8">Words</span> &nbsp;<strong style="color:#e2e8f0">${wordCount.toLocaleString()}</strong></div>
        <div><span style="color:#94a3b8">API cost</span> &nbsp;<strong style="color:#e2e8f0">$${costUsd.toFixed(3)}</strong></div>
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
      ${engineBadge(result.skillId)}
    </div>
    ${rows}
  </div>`;
}

export function generateReport(record: Omit<CheckRecord, "id" | "createdAt"> & { createdAt?: string }): string {
  const overallScore = record.results.length > 0
    ? Math.round(record.results.reduce((s, r) => s + r.score, 0) / record.results.length)
    : 0;
  const overallVerdict = record.results.some((r) => r.verdict === "fail") ? "fail"
    : record.results.some((r) => r.verdict === "warn") ? "warn" : "pass";

  const now = record.createdAt ?? new Date().toISOString().replace("T", " ").slice(0, 16);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Checkit — ${escapeHtml(record.source)}</title>
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
    ${overallBanner(overallScore, overallVerdict, record.wordCount, record.totalCostUsd, now)}
    <div class="source">${escapeHtml(record.source)}</div>
    ${(() => { const sr = record.results.find((r) => r.skillId === "summary"); return sr ? summaryBlock(sr) : ""; })()}
    <div class="powered-by">
      <span>Powered by</span>
      <a class="engine-link" href="https://copyscape.com" style="color:#0078D4;border-color:#0078D444;background:#0078D408">Copyscape</a>
      <a class="engine-link" href="https://exa.ai" style="color:#7c3aed;border-color:#7c3aed44;background:#7c3aed08">Exa AI</a>
      <a class="engine-link" href="https://platform.minimax.io" style="color:#0891b2;border-color:#0891b244;background:#0891b208">MiniMax</a>
    </div>
    ${record.results.filter((r) => r.skillId !== "summary").map(skillCard).join("")}
    <div class="footer">
      <div class="footer-top">
        <span class="footer-brand">Checkit</span>
        <div class="footer-links">
          <a class="footer-link" href="https://github.com/sharonds/checkit">GitHub</a>
          <a class="footer-link" href="https://github.com/sharonds/checkit/blob/main/LICENSE">MIT License</a>
          <a class="footer-link" href="https://copyscape.com">Copyscape</a>
          <a class="footer-link" href="https://exa.ai">Exa AI</a>
          <a class="footer-link" href="https://platform.minimax.io">MiniMax</a>
        </div>
      </div>
      <p class="footer-disclaimer">
        This report is provided for informational purposes only under the
        <a href="https://github.com/sharonds/checkit/blob/main/LICENSE">MIT License</a>.
        Results are generated by third-party APIs (Copyscape, Exa AI, MiniMax) and may not be complete or accurate.
        The authors of Checkit make no warranties and accept no liability for decisions made based on these results.
        Always apply your own judgement before publishing.
      </p>
    </div>
  </div>
</body>
</html>`;
}
