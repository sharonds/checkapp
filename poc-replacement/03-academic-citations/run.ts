#!/usr/bin/env bun
/**
 * POC 3 — Academic Citations: OpenAlex vs Gemini grounding
 *
 * For each claim:
 *   1. Query OpenAlex for up to 5 papers
 *   2. Query Gemini grounded for up to 5 peer-reviewed papers
 *   3. Score:
 *      - Exact-gold Recall@3, Recall@5: DOI/fuzzy-title match to gold citation
 *      - Acceptable-support Recall@3, Recall@5: judge rates each returned paper
 *        for relevance to the claim
 *
 * Judge for acceptable-support: Gemini plain call (noted bias — Gemini is judging
 * its own output + Semantic Scholar's). See RESULTS.md for caveat.
 *
 * Usage:
 *   bun poc-replacement/03-academic-citations/run.ts
 *
 * Env: GEMINI_API_KEY (OpenAlex uses ALEX_API if present)
 */

import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
  CORPUS,
  SS_COST_PER_SEARCH_USD,
  GEMINI_GROUNDED_COST_USD,
  type CitationTestCase,
  type GoldCitation,
} from "./corpus.ts";
import { callLlm, callLlmGrounded, parseJson } from "../lib/gemini.ts";
import { recallAtK, fmtPct } from "../lib/scoring.ts";

function loadEnv() {
  const candidates = [
    join(import.meta.dir, "../.env"),
    join(import.meta.dir, "../../.env"),
    join(import.meta.dir, "../../../.env"),
    join(import.meta.dir, "../../../../.env"),
    join(import.meta.dir, "../../../../../.env"),
  ];
  for (const envPath of candidates) {
    if (!existsSync(envPath)) continue;
    for (const line of readFileSync(envPath, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
    }
    return;
  }
}
loadEnv();

// ── Types ─────────────────────────────────────────────────────────────────────

interface Paper {
  title: string;
  authors: string;
  year?: number;
  doi?: string;
  url?: string;
}

interface EngineResult {
  engine: "openalex" | "gemini";
  papers: Paper[];
  timeMs: number;
  costUsd: number;
  error?: string;
}

// ── OpenAlex ──────────────────────────────────────────────────────────────
// Free structured academic search, no auth required for polite pool. We also
// pass ALEX_API as api_key when present (premium tier support).
// Docs: https://docs.openalex.org/how-to-use-the-api/api-overview

async function runOpenAlex(claim: string, limit = 5): Promise<EngineResult> {
  const t0 = Date.now();
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", claim);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("select", "id,doi,title,publication_year,authorships,primary_location,type");
  // Filter to peer-reviewed types only (article/review, not preprint-only or dataset)
  url.searchParams.set("filter", "type:article|review");
  // Note: OpenAlex's polite pool (free, 100k req/day) requires only mailto.
  // ALEX_API key was provided but rejected as api_key param (HTTP 400) —
  // OpenAlex doesn't document an api_key mechanism. Polite pool is sufficient.
  const mailto = process.env.OPENALEX_MAILTO; // your contact email, for the polite pool
  if (mailto) url.searchParams.set("mailto", mailto);

  const delays = [3000, 8000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        if ((res.status === 429 || res.status >= 500) && attempt < delays.length) {
          process.stdout.write(` [OpenAlex ${res.status}, retry in ${delays[attempt] / 1000}s]`);
          await new Promise((r) => setTimeout(r, delays[attempt]));
          continue;
        }
        return { engine: "openalex", papers: [], timeMs: Date.now() - t0, costUsd: 0, error: `HTTP ${res.status}` };
      }
      interface OAWork {
        id: string;
        doi?: string | null;
        title: string | null;
        publication_year?: number;
        authorships?: Array<{ author?: { display_name?: string } }>;
        primary_location?: { landing_page_url?: string; source?: { display_name?: string } };
      }
      const json: { results?: OAWork[] } = await res.json();
      const papers: Paper[] = (json.results ?? []).map((w) => ({
        title: w.title ?? "",
        authors: (w.authorships ?? []).map((a) => a.author?.display_name ?? "").filter(Boolean).join(", "),
        year: w.publication_year,
        doi: w.doi ? w.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") : undefined,
        url: w.primary_location?.landing_page_url ?? (w.doi ? `https://doi.org/${w.doi}` : undefined),
      }));
      return { engine: "openalex", papers, timeMs: Date.now() - t0, costUsd: 0 };
    } catch (e) {
      if (attempt === delays.length) return { engine: "openalex", papers: [], timeMs: Date.now() - t0, costUsd: 0, error: String(e) };
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  return { engine: "openalex", papers: [], timeMs: Date.now() - t0, costUsd: 0, error: "retries exhausted" };
}

// ── Gemini grounded ──────────────────────────────────────────────────────────

async function runGeminiCitation(claim: string, limit = 5): Promise<EngineResult> {
  const t0 = Date.now();
  const prompt = `Find ${limit} peer-reviewed academic papers that support this claim.

Claim: "${claim}"

Return ONLY valid JSON (no markdown fences):
{
  "citations": [
    {
      "title": "<full paper title>",
      "authors": "<authors as single string>",
      "year": <integer year>,
      "doi": "<DOI if known>",
      "url": "<direct URL to paper>",
      "relevance": "high" | "medium" | "low"
    }
  ]
}

Return only peer-reviewed journal articles, conference papers, or formal meta-analyses.
Order from highest relevance to lowest. If fewer than ${limit} qualified papers exist, return fewer.`;

  // Retry once on AbortError/timeout — Gemini API has high tail latency under load.
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const { text } = await callLlmGrounded(prompt, 1, 240_000);
      let parsed: { citations?: Array<Paper & { relevance?: string }> };
      try {
        parsed = parseJson(text);
      } catch {
        return { engine: "gemini", papers: [], timeMs: Date.now() - t0, costUsd: GEMINI_GROUNDED_COST_USD * attempt, error: `JSON parse failed: ${text.slice(0, 100)}` };
      }
      const papers: Paper[] = (parsed.citations ?? []).slice(0, limit).map((c) => ({
        title: c.title,
        authors: c.authors ?? "",
        year: c.year,
        doi: c.doi,
        url: c.url,
      }));
      return { engine: "gemini", papers, timeMs: Date.now() - t0, costUsd: GEMINI_GROUNDED_COST_USD * attempt };
    } catch (e) {
      lastError = String(e);
      if (!String(e).includes("aborted") && !String(e).includes("Abort")) break; // only retry on timeout
      if (attempt === 1) process.stdout.write(" [Gemini timed out, retrying...]");
    }
  }
  return { engine: "gemini", papers: [], timeMs: Date.now() - t0, costUsd: GEMINI_GROUNDED_COST_USD * 2, error: lastError };
}

// ── Scoring: exact-gold match ────────────────────────────────────────────────

function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
}

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  const setA = new Set(na.split(" "));
  const setB = new Set(nb.split(" "));
  const inter = [...setA].filter((w) => setB.has(w)).length;
  const uni = new Set([...setA, ...setB]).size;
  return uni === 0 ? 0 : inter / uni; // Jaccard
}

function isExactGoldMatch(paper: Paper, gold: GoldCitation): boolean {
  // DOI match wins
  if (paper.doi && gold.doi && paper.doi.toLowerCase().trim() === gold.doi.toLowerCase().trim()) return true;
  // Fuzzy title match > 0.5 Jaccard
  if (titleSimilarity(paper.title, gold.title) > 0.5) {
    // Year check if both present
    if (paper.year && gold.year && Math.abs(paper.year - gold.year) > 1) return false;
    return true;
  }
  return false;
}

function goldHitsInTopK(papers: Paper[], golds: GoldCitation[], k: number): boolean {
  return papers.slice(0, k).some((p) => golds.some((g) => isExactGoldMatch(p, g)));
}

// ── Scoring: acceptable-support (Gemini judge) ────────────────────────────────

async function judgeAcceptableSupport(claim: string, paper: Paper): Promise<{ supportive: boolean; reasoning: string }> {
  const prompt = `You are a research librarian assessing whether an academic paper supports a specific claim.

Claim: "${claim}"

Paper:
- Title: ${paper.title}
- Authors: ${paper.authors}
- Year: ${paper.year ?? "unknown"}
- DOI: ${paper.doi ?? "none"}

Question: Does this paper directly address and support the claim at ≥ medium relevance?

"Supportive" means the paper's findings genuinely back the claim. "Not supportive" means the paper is off-topic, tangential, or only peripherally related.

Return ONLY valid JSON:
{
  "supportive": true | false,
  "reasoning": "<one sentence>"
}`;

  try {
    const raw = await callLlm(prompt);
    return parseJson(raw);
  } catch {
    return { supportive: false, reasoning: "judge error" };
  }
}

async function acceptableSupportHitsInTopK(claim: string, papers: Paper[], k: number): Promise<{ hit: boolean; judgments: Array<{ paper: Paper; supportive: boolean; reasoning: string }> }> {
  const topK = papers.slice(0, k);
  const judgments = [];
  let hit = false;
  for (const p of topK) {
    const j = await judgeAcceptableSupport(claim, p);
    judgments.push({ paper: p, ...j });
    if (j.supportive) hit = true;
  }
  return { hit, judgments };
}

// ── Main ──────────────────────────────────────────────────────────────────────

const LINE = "─".repeat(72);
console.log(`\n${"═".repeat(72)}`);
console.log(`  POC 3 — Academic Citations: OpenAlex vs Gemini grounding`);
console.log(`${"═".repeat(72)}`);
console.log(`  Corpus  : ${CORPUS.length} claims (4 medical / 3 scientific / 3 financial)`);
console.log(`  Judge   : Gemini 3.1 Pro (for acceptable-support metric, with noted bias)`);
console.log(`  Started : ${new Date().toISOString()}\n`);

interface ClaimScore {
  id: string;
  claim: string;
  claimType: string;
  ss: {
    papers: Paper[];
    timeMs: number;
    error?: string;
    exactGoldHits: { r3: boolean; r5: boolean };
    acceptableSupport: { r3: boolean; r5: boolean; judgments: Array<{ paper: Paper; supportive: boolean; reasoning: string }> };
  };
  gem: {
    papers: Paper[];
    timeMs: number;
    error?: string;
    exactGoldHits: { r3: boolean; r5: boolean };
    acceptableSupport: { r3: boolean; r5: boolean; judgments: Array<{ paper: Paper; supportive: boolean; reasoning: string }> };
  };
}

const scores: ClaimScore[] = [];
let ssCost = 0;
let gemCost = 0;
let judgeCost = 0;
const JUDGE_COST_PER_CALL = 0.003;

for (const c of CORPUS) {
  console.log(`\n${LINE}`);
  console.log(`  [${c.id}] ${c.claimType}`);
  console.log(`  Claim: "${c.claim.slice(0, 100)}..."`);

  process.stdout.write("  Running SS + Gemini in parallel...");
  const [ssRes, gemRes] = await Promise.all([
    runOpenAlex(c.claim, 5),
    runGeminiCitation(c.claim, 5),
  ]);
  console.log(` done (${(ssRes.timeMs / 1000).toFixed(1)}s / ${(gemRes.timeMs / 1000).toFixed(1)}s)`);
  ssCost += ssRes.costUsd;
  gemCost += gemRes.costUsd;

  if (ssRes.error) console.log(`  OpenAlex error: ${ssRes.error}`);
  if (gemRes.error) console.log(`  Gemini error: ${gemRes.error}`);

  const ssExactR3 = goldHitsInTopK(ssRes.papers, c.goldCitations, 3);
  const ssExactR5 = goldHitsInTopK(ssRes.papers, c.goldCitations, 5);
  const gemExactR3 = goldHitsInTopK(gemRes.papers, c.goldCitations, 3);
  const gemExactR5 = goldHitsInTopK(gemRes.papers, c.goldCitations, 5);

  process.stdout.write("  Judging acceptable support for SS top-5...");
  const ssSupport = await acceptableSupportHitsInTopK(c.claim, ssRes.papers, 5);
  console.log(" done");
  judgeCost += JUDGE_COST_PER_CALL * ssRes.papers.slice(0, 5).length;

  process.stdout.write("  Judging acceptable support for Gemini top-5...");
  const gemSupport = await acceptableSupportHitsInTopK(c.claim, gemRes.papers, 5);
  console.log(" done");
  judgeCost += JUDGE_COST_PER_CALL * gemRes.papers.slice(0, 5).length;

  const ssSupportR3 = ssSupport.judgments.slice(0, 3).some((j) => j.supportive);
  const gemSupportR3 = gemSupport.judgments.slice(0, 3).some((j) => j.supportive);

  console.log(`\n  OPENALEX — ${ssRes.papers.length} papers`);
  for (const p of ssRes.papers.slice(0, 3)) {
    const supportive = ssSupport.judgments.find((j) => j.paper.title === p.title)?.supportive;
    console.log(`    [${supportive ? "✓supp" : "✗off "}] ${p.title.slice(0, 80)} (${p.year ?? "?"})`);
  }
  console.log(`    exact-gold R@3: ${ssExactR3 ? "✅" : "❌"}  R@5: ${ssExactR5 ? "✅" : "❌"}`);
  console.log(`    accept-supp R@3: ${ssSupportR3 ? "✅" : "❌"}  R@5: ${ssSupport.hit ? "✅" : "❌"}`);

  console.log(`\n  GEMINI GROUNDED — ${gemRes.papers.length} papers`);
  for (const p of gemRes.papers.slice(0, 3)) {
    const supportive = gemSupport.judgments.find((j) => j.paper.title === p.title)?.supportive;
    console.log(`    [${supportive ? "✓supp" : "✗off "}] ${p.title.slice(0, 80)} (${p.year ?? "?"})`);
  }
  console.log(`    exact-gold R@3: ${gemExactR3 ? "✅" : "❌"}  R@5: ${gemExactR5 ? "✅" : "❌"}`);
  console.log(`    accept-supp R@3: ${gemSupportR3 ? "✅" : "❌"}  R@5: ${gemSupport.hit ? "✅" : "❌"}`);

  scores.push({
    id: c.id,
    claim: c.claim,
    claimType: c.claimType,
    ss: { papers: ssRes.papers, timeMs: ssRes.timeMs, error: ssRes.error, exactGoldHits: { r3: ssExactR3, r5: ssExactR5 }, acceptableSupport: { r3: ssSupportR3, r5: ssSupport.hit, judgments: ssSupport.judgments } },
    gem: { papers: gemRes.papers, timeMs: gemRes.timeMs, error: gemRes.error, exactGoldHits: { r3: gemExactR3, r5: gemExactR5 }, acceptableSupport: { r3: gemSupportR3, r5: gemSupport.hit, judgments: gemSupport.judgments } },
  });

  // Brief pause between claims to avoid cumulative SS rate limiting
  await new Promise((r) => setTimeout(r, 3000));
}

// ── Aggregate ─────────────────────────────────────────────────────────────────

console.log(`\n\n${"═".repeat(72)}`);
console.log(`  AGGREGATE — ${CORPUS.length} claims`);
console.log(`${"═".repeat(72)}`);

const ssExactR3 = scores.map((s) => s.ss.exactGoldHits.r3);
const ssExactR5 = scores.map((s) => s.ss.exactGoldHits.r5);
const gemExactR3 = scores.map((s) => s.gem.exactGoldHits.r3);
const gemExactR5 = scores.map((s) => s.gem.exactGoldHits.r5);

const ssSuppR3 = scores.map((s) => s.ss.acceptableSupport.r3);
const ssSuppR5 = scores.map((s) => s.ss.acceptableSupport.r5);
const gemSuppR3 = scores.map((s) => s.gem.acceptableSupport.r3);
const gemSuppR5 = scores.map((s) => s.gem.acceptableSupport.r5);

console.log(`\n  EXACT-GOLD RECALL (specific pre-identified paper)`);
console.log(`                   Recall@3           Recall@5`);
console.log(`  OpenAlex       :  ${fmtPct(recallAtK(ssExactR3, ssExactR3.length))}           ${fmtPct(recallAtK(ssExactR5, ssExactR5.length))}`);
console.log(`  Gemini        :  ${fmtPct(recallAtK(gemExactR3, gemExactR3.length))}           ${fmtPct(recallAtK(gemExactR5, gemExactR5.length))}`);

console.log(`\n  ACCEPTABLE-SUPPORT RECALL (any peer-reviewed supportive paper)`);
console.log(`                   Recall@3           Recall@5`);
console.log(`  OpenAlex       :  ${fmtPct(recallAtK(ssSuppR3, ssSuppR3.length))}           ${fmtPct(recallAtK(ssSuppR5, ssSuppR5.length))}`);
console.log(`  Gemini        :  ${fmtPct(recallAtK(gemSuppR3, gemSuppR3.length))}           ${fmtPct(recallAtK(gemSuppR5, gemSuppR5.length))}`);

console.log(`\n  Cost`);
console.log(`  OpenAlex       : $${ssCost.toFixed(4)} (free tier)`);
console.log(`  Gemini grounded : $${gemCost.toFixed(4)}`);
console.log(`  Gemini judge    : $${judgeCost.toFixed(4)} (acceptable-support scoring)`);
console.log(`  Total           : $${(ssCost + gemCost + judgeCost).toFixed(4)}`);

const outFile = join(import.meta.dir, `results-${Date.now()}.json`);
writeFileSync(outFile, JSON.stringify({
  timestamp: new Date().toISOString(),
  corpus: CORPUS.map((c) => ({ id: c.id, claimType: c.claimType, goldCount: c.goldCitations.length })),
  aggregate: {
    openalex: {
      exactGoldRecallAt3: recallAtK(ssExactR3, ssExactR3.length),
      exactGoldRecallAt5: recallAtK(ssExactR5, ssExactR5.length),
      acceptableSupportRecallAt3: recallAtK(ssSuppR3, ssSuppR3.length),
      acceptableSupportRecallAt5: recallAtK(ssSuppR5, ssSuppR5.length),
      totalCost: ssCost,
    },
    gemini: {
      exactGoldRecallAt3: recallAtK(gemExactR3, gemExactR3.length),
      exactGoldRecallAt5: recallAtK(gemExactR5, gemExactR5.length),
      acceptableSupportRecallAt3: recallAtK(gemSuppR3, gemSuppR3.length),
      acceptableSupportRecallAt5: recallAtK(gemSuppR5, gemSuppR5.length),
      totalCost: gemCost,
    },
    judgeCost,
  },
  perClaim: scores,
}, null, 2));
console.log(`\n  Results saved → ${outFile}\n`);
