#!/usr/bin/env bun
/**
 * Deep Research Legal on 01-health WITHOUT a policy doc (Mode B).
 * Tests the hypothesis: DR's broad regulatory research capability earns its
 * keep when the skill has to identify inherent legal risks on its own,
 * without a reference policy.
 *
 * Single article, single mode, ~$1.50, ~8-10 min.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { buildLegalPrompt } from "../../src/skills/legal.ts";

function loadEnv() {
  const paths = ["../.env", "../../.env", "../../../.env", "../../../../.env", "../../../../../.env"];
  for (const p of paths) {
    const full = join(import.meta.dir, p);
    if (!existsSync(full)) continue;
    for (const line of readFileSync(full, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
    return;
  }
}
loadEnv();

const KEY = process.env.GEMINI_API_KEY!;
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const article = readFileSync(join(import.meta.dir, "../../poc/articles/01-health.md"), "utf8");
// No policy doc — deliberately omitted to test Mode B
const legalPrompt = buildLegalPrompt(article /* no policy */);

const input = `You are performing a thorough legal and regulatory risk audit of the article below.

No company-specific policy document is provided. Identify ALL legal, regulatory, and compliance risks based on applicable US federal and state law, FTC and FDA guidance, and industry precedent. Research specific enforcement actions, warning letters, and case law that establish the risk.

${legalPrompt}

ADDITIONAL INSTRUCTIONS FOR DEEP RESEARCH:
- Identify every category of inherent legal risk in the article (health claims, securities claims, defamation, IP, GDPR/privacy, false advertising, etc.)
- For each finding, cite the SPECIFIC legal source (statute, regulation number, agency guidance doc, warning letter, or case law precedent)
- Rank findings by severity based on actual enforcement precedent
- Recommend concrete remediation language for each high-severity finding`;

const t0 = Date.now();
console.log(`Submitting Deep Research legal audit (no-policy mode) for 01-health.md (~10 min)...\n`);

const createRes = await fetch(`${BASE}/interactions?key=${KEY}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    input,
    agent: "deep-research-preview-04-2026",
    background: true,
    store: true,
    agent_config: { type: "deep-research", thinking_summaries: "auto", visualization: "off" },
  }),
});
if (!createRes.ok) { console.error(`✗ ${createRes.status}: ${(await createRes.text()).slice(0, 300)}`); process.exit(1); }
const created = await createRes.json();
const id: string = created.id;
console.log(`  Deep Research ID: ${id}`);

const POLL = 15_000;
const MAX = 80;
let data: Record<string, unknown> | null = null;
for (let i = 0; i < MAX; i++) {
  await new Promise((r) => setTimeout(r, POLL));
  process.stdout.write(`\r  polling ${(i + 1) * 15}s...`);
  const r = await fetch(`${BASE}/interactions/${id}?key=${KEY}`);
  if (!r.ok) continue;
  data = await r.json();
  const status = (data as { status?: string; state?: string }).status ?? (data as { state?: string }).state ?? "";
  if (status === "failed") { process.stdout.write("\n"); console.error(`✗ Failed`); process.exit(1); }
  if (status === "completed" || status === "complete") break;
}
process.stdout.write("\n");
if (!data) { console.error("no data"); process.exit(1); }

function extractText(d: Record<string, unknown>): string {
  type Part = { text?: string };
  if (Array.isArray(d.outputs)) {
    const found = (d.outputs as Array<{ text?: string }>).find((o) => o.text);
    if (found?.text) return found.text;
  }
  if (Array.isArray(d.candidates)) {
    const cands = d.candidates as Array<{ content?: { parts?: Part[] } }>;
    return cands[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  }
  return JSON.stringify(d, null, 2);
}

const text = extractText(data);
const elapsed = (Date.now() - t0) / 1000;
console.log(`✅ ${elapsed.toFixed(0)}s | ${text.length} chars | ${text.split(/\s+/).length} words\n`);
console.log(text.slice(0, 1200));
console.log(text.length > 1200 ? "\n[...truncated...]" : "");

const outFile = join(import.meta.dir, `deep-research-legal-nopolicy-01-health-${Date.now()}.json`);
writeFileSync(outFile, JSON.stringify({
  timestamp: new Date().toISOString(),
  interactionId: id,
  article: "01-health",
  mode: "no-policy",
  prompt: input,
  output: text,
  elapsedSec: elapsed,
  estimatedCostUsd: 1.5,
}, null, 2));
console.log(`\n  Saved → ${outFile}\n`);
