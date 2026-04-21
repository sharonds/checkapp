import Exa from "exa-js";
import type { Skill, SkillResult, Finding, ClaimType } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient, parseJsonResponse } from "./llm.ts";
import { resolveProvider } from "../providers/resolve.ts";

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

export function formatCitation(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace("www.", "");
  } catch {
    return url;
  }
}

export function claimConfidence(sourceCount: number, supported: boolean | null): "high" | "medium" | "low" {
  if (supported === false) return "low";
  if (supported === null) return "low";
  if (sourceCount >= 3) return "high";
  if (sourceCount >= 1) return "medium";
  return "low";
}

export class FactCheckSkill implements Skill {
  readonly id = "fact-check";
  readonly name = "Fact Check";

  async run(text: string, config: Config): Promise<SkillResult> {
    const resolved = resolveProvider(config, "fact-check");
    if (!resolved) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no fact-check provider configured",
        findings: [{ severity: "info", text: "Configure a fact-check provider in Settings → Providers (e.g. Exa)" }],
        costUsd: 0,
      };
    }
    if (resolved.provider !== "exa-search" && resolved.provider !== "parallel-task" && resolved.provider !== "exa-deep-reasoning") {
      return skippedResult(this, `${resolved.provider} not implemented for fact-check yet`);
    }
    const apiKey = resolved.apiKey;
    if (!apiKey) return skippedResult(this, `${resolved.provider} API key missing`);

    const deepMode = resolved.provider === "exa-deep-reasoning" || resolved.provider === "parallel-task";

    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "info", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable fact-checking" }],
        costUsd: 0,
      };
    }

    const exa = new Exa(apiKey);

    // Step 1: extract claims
    const claimsText = await llm.call(extractClaimsPrompt(text), 1024);

    let claims: string[] = [];
    try {
      const parsed = parseJsonResponse<string[]>(claimsText);
      claims = Array.isArray(parsed) ? parsed : [];
    } catch {
      claims = [];
    }

    if (claims.length === 0) {
      return {
        skillId: this.id, name: this.name, score: 60, verdict: "warn",
        summary: "No specific verifiable claims detected",
        findings: [{
          severity: "warn",
          text: "No checkable statistics, dates, or research findings found — adding cited facts (studies, percentages, named data) increases credibility and SEO authority",
        }],
        costUsd: 0.001,
        provider: resolved.provider,
      };
    }

    // Step 2: search each claim with Exa
    const findings: Finding[] = [];
    let costUsd = 0.001;

    const search = deepMode
      ? (q: string) => exa.search(q, {
          type: "deep-reasoning",
          numResults: 5,
          contents: {
            text: { maxCharacters: 4000 },
            highlights: { maxCharacters: 1000, numSentences: 3, query: q },
          },
        })
      : (q: string) => exa.search(q, {
          type: "auto",
          numResults: 3,
          contents: {
            text: { maxCharacters: 4000 },
            highlights: { maxCharacters: 1000, numSentences: 3, query: q },
          },
        });

    const claimResults = await Promise.all(
      claims.slice(0, 4).map(async (claim) => {
        const result = await search(claim);
        costUsd += deepMode ? 0.025 : 0.007;
        return { claim, results: result.results };
      })
    );

    // Step 3: assess each claim
    const assessments: Array<{ claim: string; supported: boolean | null; note: string; claimType: ClaimType }> = [];
    for (const { claim, results: searchResults } of claimResults) {
      const evidence = searchResults
        .map((r, i) => {
          const highlights = (r.highlights ?? []).join(" ");
          const fullText = r.text ?? "";
          return [
            `[${i + 1}] URL: ${r.url}`,
            `Title: ${r.title ?? "N/A"}`,
            `Highlights: ${highlights || "N/A"}`,
            `Full text: ${fullText || "N/A"}`,
          ].join("\n");
        })
        .join("\n\n---\n\n");

      const assessPrompt = `Is this claim supported by the evidence below?
Claim: "${claim}"

Evidence:
${evidence}

Reply with JSON:
{ "supported": true|false|null, "note": "one sentence", "claimType": "scientific"|"medical"|"financial"|"general" }

- supported: true if evidence supports the claim, false if contradicts, null if inconclusive.
- claimType: classify the claim type. "scientific" for studies/research/statistics about physical world/human behavior. "medical" for health/disease/treatment claims. "financial" for monetary/market/business claims. "general" for everything else.`;

      const assessRaw = await llm.call(assessPrompt, 512);
      costUsd += 0.001;

      try {
        const json = parseJsonResponse<{ supported: boolean | null; note: string; claimType?: string }>(assessRaw);
        const validTypes = ["scientific", "medical", "financial", "general"] as const;
        const claimType = validTypes.includes(json.claimType as never) ? (json.claimType as ClaimType) : "general";
        assessments.push({ claim, supported: json.supported, note: json.note, claimType });
      } catch {
        assessments.push({ claim, supported: null, note: "Could not assess", claimType: "general" });
      }
    }

    const sourceCountMap = new Map(claimResults.map(cr => [cr.claim, cr.results.length]));

    for (const { claim, supported, note, claimType } of assessments) {
      const sourceCount = sourceCountMap.get(claim) ?? 0;
      const confidence = claimConfidence(sourceCount, supported);
      const sources = claimResults.find(cr => cr.claim === claim)?.results ?? [];
      const sourceList = sources.slice(0, 3).map((r) => ({
        url: r.url,
        title: r.title ?? undefined,
        publishedDate: r.publishedDate ?? undefined,
        quote: (r.highlights ?? [])[0],
      }));
      const base = { sources: sourceList, confidence, claimType };
      if (supported === false) {
        findings.push({ severity: "error", text: `Unsupported (${confidence} confidence): "${claim}" — ${note}`, ...base });
      } else if (supported === null) {
        findings.push({ severity: "warn", text: `Unverified (${confidence} confidence): "${claim}" — ${note}`, ...base });
      } else {
        const citations = sources.slice(0, 2).map(r => formatCitation(r.url)).join(", ");
        findings.push({
          severity: "info",
          text: `Verified (${confidence} confidence): "${claim}" — ${note}${citations ? `. Cite: ${citations}` : ""}`,
          ...base,
        });
      }
    }

    const failCount = findings.filter((f) => f.severity === "error").length;
    const warnCount = findings.filter((f) => f.severity === "warn").length;
    const score = Math.round(100 - failCount * 25 - warnCount * 10);
    const verdict = failCount > 0 ? "fail" : warnCount > 1 ? "warn" : "pass";
    const summary = `${assessments.length} claims checked — ${failCount} unsupported, ${warnCount} unverified (via ${llm.provider})`;

    return { skillId: this.id, name: this.name, score: Math.max(0, score), verdict, summary, findings, costUsd, provider: resolved.provider };
  }
}

function skippedResult(skill: FactCheckSkill, reason: string): SkillResult {
  return {
    skillId: skill.id,
    name: skill.name,
    verdict: "skipped",
    score: 0,
    summary: `Skipped: ${reason}.`,
    findings: [],
    costUsd: 0,
  };
}
