import Exa from "exa-js";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient, getTextBlock, parseJsonResponse } from "./llm.ts";

export function extractClaimsPrompt(articleText: string): string {
  return `Extract the 4 most specific, verifiable factual claims from the article below.
Return ONLY a JSON array of strings, no other text. Each string is one claim.
Focus on claims about statistics, dates, scientific facts, or named entities — not opinions.

Article:
${articleText.slice(0, 3000)}

Example output:
["More than one billion people are vitamin D deficient worldwide.", "Vitamin D deficiency causes rickets in children."]

JSON array of claims:`;
}

export class FactCheckSkill implements Skill {
  readonly id = "fact-check";
  readonly name = "Fact Check";

  async run(text: string, config: Config): Promise<SkillResult> {
    if (!config.exaApiKey) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — EXA_API_KEY not configured",
        findings: [{ severity: "info", text: "Add EXA_API_KEY to .env to enable fact-checking" }],
        costUsd: 0,
      };
    }

    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "info", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable fact-checking" }],
        costUsd: 0,
      };
    }

    const exa = new Exa(config.exaApiKey);

    // Step 1: extract claims
    const claimsResponse = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: extractClaimsPrompt(text) }],
    });
    const claimsText = getTextBlock(claimsResponse.content);

    let claims: string[] = [];
    try {
      const parsed = parseJsonResponse<string[]>(claimsText);
      claims = Array.isArray(parsed) ? parsed : [];
    } catch {
      claims = [];
    }

    if (claims.length === 0) {
      return {
        skillId: this.id, name: this.name, score: 70, verdict: "pass",
        summary: "No specific verifiable claims found",
        findings: [], costUsd: 0.001,
      };
    }

    // Step 2: search each claim with Exa
    const findings: Finding[] = [];
    let costUsd = 0.001;

    const claimResults = await Promise.all(
      claims.slice(0, 4).map(async (claim) => {
        const result = await exa.search(claim, {
          type: "auto",
          numResults: 3,
          contents: { highlights: { maxCharacters: 1500, query: claim } },
        });
        costUsd += 0.007;
        return { claim, results: result.results };
      })
    );

    // Step 3: assess each claim
    const assessments: Array<{ claim: string; supported: boolean | null; note: string }> = [];
    for (const { claim, results: searchResults } of claimResults) {
      const evidence = searchResults
        .map((r, i) => `[${i + 1}] ${r.url}\n${(r.highlights ?? []).join(" ")}`)
        .join("\n\n");

      const assessPrompt = `Is this claim supported by the evidence below?
Claim: "${claim}"

Evidence:
${evidence}

Reply with JSON: { "supported": true/false/null, "note": "one sentence explanation" }
null means inconclusive.`;

      const res = await llm.client.messages.create({
        model: llm.model,
        max_tokens: 512,
        messages: [{ role: "user", content: assessPrompt }],
      });
      costUsd += 0.001;

      try {
        const json = parseJsonResponse<{ supported: boolean | null; note: string }>(getTextBlock(res.content));
        assessments.push({ claim, supported: json.supported, note: json.note });
      } catch {
        assessments.push({ claim, supported: null, note: "Could not assess" });
      }
    }

    for (const { claim, supported, note } of assessments) {
      if (supported === false) {
        findings.push({ severity: "error", text: `Unsupported claim: "${claim}" — ${note}` });
      } else if (supported === null) {
        findings.push({ severity: "warn", text: `Unverified claim: "${claim}" — ${note}` });
      } else {
        findings.push({ severity: "info", text: `Verified: "${claim}" — ${note}` });
      }
    }

    const failCount = findings.filter((f) => f.severity === "error").length;
    const warnCount = findings.filter((f) => f.severity === "warn").length;
    const score = Math.round(100 - failCount * 25 - warnCount * 10);
    const verdict = failCount > 0 ? "fail" : warnCount > 1 ? "warn" : "pass";
    const summary = `${assessments.length} claims checked — ${failCount} unsupported, ${warnCount} unverified (via ${llm.provider})`;

    return { skillId: this.id, name: this.name, score: Math.max(0, score), verdict, summary, findings, costUsd };
  }
}
