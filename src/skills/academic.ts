import type { SkillResult, Finding, Citation, EnricherSkill, ClaimType } from "./types.ts";
import type { Config } from "../config.ts";
import { resolveProvider } from "../providers/resolve.ts";
import { ssSearch } from "../providers/semanticscholar.ts";

const MAX_ENRICH_TARGETS = 5;
const TARGET_CLAIM_TYPES = new Set<ClaimType>(["scientific", "medical", "financial"]);

export class AcademicSkill implements EnricherSkill {
  readonly id = "academic";
  readonly name = "Academic Citations";
  readonly kind = "enricher" as const;

  async run(text: string, config: Config): Promise<SkillResult> {
    return this.enrich(text, config, []);
  }

  async enrich(text: string, config: Config, priorResults: SkillResult[]): Promise<SkillResult> {
    const resolved = resolveProvider(config, "academic");
    if (!resolved) {
      return {
        skillId: this.id, name: this.name, score: 0, verdict: "skipped",
        summary: "Skipped: no provider configured.",
        findings: [],
        costUsd: 0,
      };
    }

    let targets: Array<{ claim: string; claimType: ClaimType }> = [];
    const factCheck = priorResults.find(r => r.skillId === "fact-check");
    if (factCheck) {
      targets = factCheck.findings
        .filter(f => f.claimType && TARGET_CLAIM_TYPES.has(f.claimType))
        .map(f => ({ claim: extractClaim(f.text), claimType: f.claimType as ClaimType }))
        .filter(t => t.claim.length > 0);
    }

    if (targets.length === 0 && !factCheck) {
      const sentences = text.split(/(?<=[.!?])\s+/).filter(s =>
        /\d|study|trial|research|percent|%/i.test(s) && s.length > 20
      );
      targets = sentences.slice(0, 3).map(s => ({ claim: s.trim(), claimType: "scientific" as const }));
    }

    if (targets.length === 0) {
      return {
        skillId: this.id, name: this.name, score: 100, verdict: "pass",
        summary: "No claims needing academic citation",
        findings: [], costUsd: 0, provider: resolved.provider,
      };
    }

    const findings: Finding[] = [];
    for (const target of targets.slice(0, MAX_ENRICH_TARGETS)) {
      const papers = await ssSearch(target.claim, 3);
      const citations: Citation[] = papers.map((p) => ({
        title: p.title,
        authors: p.authors?.map(a => a.name),
        year: p.year,
        doi: p.externalIds?.DOI,
        url: p.url,
        abstractSnippet: p.abstract?.slice(0, 200),
      }));
      findings.push({
        severity: "info",
        text: `Suggested citations for: "${target.claim.slice(0, 80)}${target.claim.length > 80 ? "…" : ""}"`,
        citations: citations.length > 0 ? citations : undefined,
        claimType: target.claimType,
      });
    }

    const verdict: SkillResult["verdict"] = findings.some(f => f.citations?.length) ? "pass" : "warn";
    return {
      skillId: this.id, name: this.name, score: 100, verdict,
      summary: `${findings.length} claim(s) ${findings.some(f => f.citations?.length) ? "matched" : "processed; no papers found"}`,
      findings, costUsd: 0, provider: resolved.provider,
    };
  }
}

function extractClaim(findingText: string): string {
  const match = /"([^"]+)"/.exec(findingText);
  return match ? match[1] : findingText;
}
