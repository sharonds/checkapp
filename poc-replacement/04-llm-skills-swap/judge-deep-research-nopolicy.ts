#!/usr/bin/env bun
/**
 * Judge Deep Research legal no-policy output vs GPT-5.4/MiniMax/Gemini legal
 * no-policy outputs for 01-health. Uses gpt-5.4-mini as judge.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";

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
const OPENAI_KEY = process.env.OPENAI_API_KEY!;

// Load POC 4 results for legal-no-policy outputs
const files = readdirSync(import.meta.dir).filter((f) => /^results-\d+\.json$/.test(f)).sort();
const poc4 = JSON.parse(readFileSync(join(import.meta.dir, files[files.length - 1]), "utf8"));

type Provider = "minimax" | "gemini" | "openai";
const outputs: Record<Provider, string> = { minimax: "", gemini: "", openai: "" };
for (const o of poc4.outputs) {
  if (o.article === "01-health" && o.skill === "legal-no-policy") {
    outputs[o.provider as Provider] = o.result.text;
  }
}

// Load Deep Research no-policy output
const drFiles = readdirSync(import.meta.dir).filter((f) => /^deep-research-legal-nopolicy-01-health-\d+\.json$/.test(f)).sort();
const dr = JSON.parse(readFileSync(join(import.meta.dir, drFiles[drFiles.length - 1]), "utf8"));

async function judge(outA: string, outB: string) {
  const prompt = `You are evaluating two AI outputs for a CheckApp "legal" skill — auditing a health article for legal risks WITHOUT a policy document provided (the skill must identify inherent legal risks on its own).

Rubric dimensions:
- **risk_specificity** (1-5): Does the output name specific laws/regulations (FTC Act §5, FDCA, state AG actions, case law)?
- **severity_calibration** (1-5): Does severity ranking match actual enforcement precedent?
- **actionability** (1-5): Does the output provide concrete remediation (specific phrasing changes, disclaimers to add)?

Output A:
"""
${outA.slice(0, 8000)}
"""

Output B:
"""
${outB.slice(0, 8000)}
"""

Rate each (integer 1-5). Return ONLY JSON:
{"A":{"risk_specificity":<1-5>,"severity_calibration":<1-5>,"actionability":<1-5>},"B":{"risk_specificity":<1-5>,"severity_calibration":<1-5>,"actionability":<1-5>},"reasoning":"<one sentence>"}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-5.4-mini", messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "";
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
    return JSON.parse(cleaned) as { A: Record<string, number>; B: Record<string, number>; reasoning: string };
  } catch { return null; }
}

console.log("Judging Deep Research (no-policy) vs MiniMax/Gemini/GPT-5.4 (no-policy), 01-health...\n");

const providers: Provider[] = ["minimax", "gemini", "openai"];
const results: Array<{ opponent: Provider; drScores: Record<string, number>; oppScores: Record<string, number>; reasoning: string }> = [];

for (const opp of providers) {
  process.stdout.write(`DR vs ${opp}... `);
  const flip = Math.random() < 0.5;
  const [A, B] = flip ? [outputs[opp], dr.output] : [dr.output, outputs[opp]];
  const v = await judge(A, B);
  if (!v) { console.log("judge failed"); continue; }
  const drScores = flip ? v.B : v.A;
  const oppScores = flip ? v.A : v.B;
  const drMean = Object.values(drScores).reduce((x, y) => x + y, 0) / 3;
  const oppMean = Object.values(oppScores).reduce((x, y) => x + y, 0) / 3;
  console.log(`DR=${drMean.toFixed(2)} vs ${opp}=${oppMean.toFixed(2)} ${drMean > oppMean + 0.1 ? "← DR" : oppMean > drMean + 0.1 ? "← " + opp : "(tie)"}`);
  console.log(`  reason: ${v.reasoning.slice(0, 200)}`);
  results.push({ opponent: opp, drScores, oppScores, reasoning: v.reasoning });
}

console.log(`\n${"═".repeat(60)}`);
console.log(`  Aggregate — Deep Research (no-policy) vs each standard LLM (no-policy):`);
for (const r of results) {
  const drMean = Object.values(r.drScores).reduce((x, y) => x + y, 0) / 3;
  const oppMean = Object.values(r.oppScores).reduce((x, y) => x + y, 0) / 3;
  console.log(`  vs ${r.opponent.padEnd(8)} DR=${drMean.toFixed(2)} vs opponent=${oppMean.toFixed(2)}  Δ=${(drMean - oppMean).toFixed(2)}`);
}

const drMeanScore = results.length ? results.reduce((acc, r) => acc + Object.values(r.drScores).reduce((x, y) => x + y, 0) / 3, 0) / results.length : 0;
console.log(`\n  DR mean score across all pairings: ${drMeanScore.toFixed(2)} / 5`);
console.log(`  Threshold for premium-tier adoption (per DECISION-MATRIX): > 4.0`);
console.log(`  Decision: ${drMeanScore > 4.0 ? "✅ ADOPT as premium legal tier" : drMeanScore > 3.5 ? "⚠️  MARGINAL — consider more articles" : "❌ DO NOT ADOPT for legal use"}`);

const outFile = join(import.meta.dir, `dr-nopolicy-judgement-${Date.now()}.json`);
writeFileSync(outFile, JSON.stringify({ timestamp: new Date().toISOString(), drWordCount: dr.output.split(/\s+/).length, drElapsedSec: dr.elapsedSec, drCostUsd: 1.5, drMeanScore, results }, null, 2));
console.log(`\n  Saved → ${outFile}\n`);
