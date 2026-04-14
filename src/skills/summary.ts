import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient, getTextBlock, parseJsonResponse } from "./llm.ts";

export function buildSummaryPrompt(articleText: string): string {
  return `Analyze this article and return a brief structured summary.

ARTICLE:
${articleText.slice(0, 4000)}

Reply with ONLY this JSON, no other text:
{
  "topic": "<one sentence — what is this article about>",
  "argument": "<one sentence — the main claim or thesis>",
  "audience": "<target reader in 5 words or less>",
  "tone": "<one word: informational/persuasive/conversational/technical/promotional>"
}`;
}

export class SummarySkill implements Skill {
  readonly id = "summary";
  readonly name = "Content Summary";

  async run(text: string, config: Config): Promise<SkillResult> {
    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "info", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable content summary" }],
        costUsd: 0,
      };
    }

    const response = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 1024,
      messages: [{ role: "user", content: buildSummaryPrompt(text) }],
    });

    const raw = getTextBlock(response.content);
    let parsed: { topic: string; argument: string; audience: string; tone: string };
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Could not parse content summary",
        findings: [], costUsd: 0.002,
      };
    }

    const findings: Finding[] = [
      { severity: "info", text: `Topic: ${parsed.topic}` },
      { severity: "info", text: `Argument: ${parsed.argument}` },
      { severity: "info", text: `Audience: ${parsed.audience}` },
      { severity: "info", text: `Tone: ${parsed.tone}` },
    ];

    return {
      skillId: this.id,
      name: this.name,
      score: 100,
      verdict: "pass",
      summary: parsed.topic,
      findings,
      costUsd: 0.002,
    };
  }
}
