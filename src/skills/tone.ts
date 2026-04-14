import { readFileSync, existsSync } from "fs";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient } from "./llm.ts";

export function buildTonePrompt(articleText: string, toneGuide: string): string {
  return `You are a brand voice editor. Assess how well the article matches the tone guide below.

TONE GUIDE:
${toneGuide.slice(0, 2000)}

ARTICLE:
${articleText.slice(0, 4000)}

Reply with ONLY this JSON structure, no other text:
{
  "score": <0-100 how well the article matches the tone>,
  "verdict": <"pass" if score>=75, "warn" if 50-74, "fail" if <50>,
  "summary": "<one sentence overall assessment>",
  "violations": [
    { "quote": "<sentence from article>", "issue": "<what tone rule it breaks>" }
  ]
}`;
}

export class ToneSkill implements Skill {
  readonly id = "tone";
  readonly name = "Tone of Voice";

  async run(text: string, config: Config): Promise<SkillResult> {
    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "info", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to .env to enable tone checking" }],
        costUsd: 0,
      };
    }
    if (!config.toneGuideFile || !existsSync(config.toneGuideFile)) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no tone guide file configured",
        findings: [{ severity: "info", text: "Set TONE_GUIDE_FILE=path/to/brand-voice.md in .env or run --setup" }],
        costUsd: 0,
      };
    }

    const toneGuide = readFileSync(config.toneGuideFile, "utf-8");

    const response = await llm.client.messages.create({
      model: llm.model,
      max_tokens: 512,
      messages: [{ role: "user", content: buildTonePrompt(text, toneGuide) }],
    });

    const raw = (response.content[0] as { text: string }).text.trim();

    let parsed: { score: number; verdict: string; summary: string; violations: Array<{ quote: string; issue: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Could not parse tone assessment",
        findings: [], costUsd: 0.002,
      };
    }

    const findings: Finding[] = (parsed.violations ?? []).map((v) => ({
      severity: "warn" as const,
      text: v.issue,
      quote: v.quote,
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
