import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient } from "./llm.ts";

export function buildLegalPrompt(articleText: string): string {
  return `You are a content legal risk reviewer. Scan the article below for these risk categories:
1. Unsubstantiated health claim — promises a medical outcome without evidence ("cures", "prevents", "guaranteed to heal")
2. Defamatory/defamation statement — false statements of fact about a named person or company presented as true
3. False promise — unconditional guarantee of a business result ("you will earn", "100% success")
4. GDPR/privacy risk — implies collecting personal data without consent language
5. Price/offer misrepresentation — advertised price or offer terms that could mislead

ARTICLE:
${articleText.slice(0, 5000)}

Reply with ONLY this JSON, no other text:
{
  "score": <0-100, 100=no risks found>,
  "verdict": <"pass" if score>=80, "warn" if 60-79, "fail" if <60>,
  "summary": "<one sentence>",
  "risks": [
    { "category": "<category name>", "severity": <"warn" or "error">, "quote": "<the problematic text>", "reason": "<why it's a risk>" }
  ]
}`;
}

export class LegalSkill implements Skill {
  readonly id = "legal";
  readonly name = "Legal Risk";

  async run(text: string, config: Config): Promise<SkillResult> {
    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "info", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable legal scanning" }],
        costUsd: 0,
      };
    }

    const response = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 512,
      messages: [{ role: "user", content: buildLegalPrompt(text) }],
    });

    const raw = (response.content[0] as { text: string }).text.trim();
    let parsed: { score: number; verdict: string; summary: string; risks: Array<{ category: string; severity: string; quote: string; reason: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Could not parse legal assessment",
        findings: [], costUsd: 0.002,
      };
    }

    const findings: Finding[] = (parsed.risks ?? []).map((r) => ({
      severity: r.severity as "warn" | "error",
      text: `${r.category}: ${r.reason}`,
      quote: r.quote,
    }));

    return {
      skillId: this.id,
      name: this.name,
      score: parsed.score,
      verdict: parsed.verdict as "pass" | "warn" | "fail",
      summary: parsed.summary,
      findings,
      costUsd: 0.002,
    };
  }
}
