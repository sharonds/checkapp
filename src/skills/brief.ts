import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { getLlmClient, parseJsonResponse } from "./llm.ts";

export function buildBriefPrompt(articleText: string, brief: string): string {
  return `You are a content editor checking if an article meets its brief requirements.

CONTENT BRIEF:
${brief.slice(0, 3000)}

ARTICLE:
${articleText.slice(0, 4000)}

Analyze how well the article meets the brief. Check for:
1. Word count compliance (if brief specifies a target)
2. Topic coverage — which required topics are covered vs missing
3. Key message alignment — are the main points from the brief addressed
4. Audience fit — does the tone match the target audience

Reply with ONLY this JSON, no other text:
{
  "score": <0-100, 100=fully meets brief>,
  "verdict": <"pass" if score>=75, "warn" if 50-74, "fail" if <50>,
  "summary": "<one sentence assessment>",
  "covered": ["<topic/requirement that IS covered>"],
  "missing": ["<topic/requirement that is MISSING>"],
  "suggestions": ["<specific improvement suggestion>"]
}`;
}

interface BriefResponse {
  score: number;
  verdict: string;
  summary: string;
  covered: string[];
  missing: string[];
  suggestions: string[];
}

export class BriefSkill implements Skill {
  readonly id = "brief";
  readonly name = "Brief Matching";

  async run(text: string, config: Config): Promise<SkillResult> {
    const brief = config.contexts?.["brief"];
    if (!brief) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no brief uploaded",
        findings: [{ severity: "warn", text: "Upload a content brief: checkapp context add brief ./brief.md" }],
        costUsd: 0,
      };
    }

    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Skipped — no LLM key configured",
        findings: [{ severity: "warn", text: "Add MINIMAX_API_KEY or ANTHROPIC_API_KEY to enable brief matching" }],
        costUsd: 0,
      };
    }

    const raw = await llm.call(buildBriefPrompt(text, brief), 1024);
    let parsed: BriefResponse;
    try {
      parsed = parseJsonResponse(raw);
    } catch {
      return {
        skillId: this.id, name: this.name, score: 50, verdict: "warn",
        summary: "Could not parse brief assessment",
        findings: [], costUsd: 0.002,
      };
    }

    const findings: Finding[] = [];
    for (const m of parsed.missing ?? []) {
      findings.push({ severity: "error", text: `Missing from brief: ${m}` });
    }
    for (const s of parsed.suggestions ?? []) {
      findings.push({ severity: "warn", text: s });
    }

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
