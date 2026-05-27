import { checkAiDetector, checkAiDetectorGemini } from "../aidetector.ts";
import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";

const ENGLISH_ONLY_SIGNAL = "only works with English text";

export class AiDetectionSkill implements Skill {
  readonly id = "ai-detection";
  readonly name = "AI Detection";

  async run(text: string, config: Config): Promise<SkillResult> {
    const providerOverride = config.providers?.["ai-detection"]?.provider;

    if (providerOverride === "gemini-ai-detection") {
      return this.#runGemini(text, config, false);
    }

    // Default: Copyscape, with auto-fallback to Gemini on English-only error
    try {
      const result = await checkAiDetector(text, config);

      if (result.error) {
        const isCredits = result.error.includes("credits insufficient");
        return {
          skillId: this.id,
          name: this.name,
          score: 0,
          verdict: isCredits ? "skipped" : "fail",
          summary: isCredits ? result.error : "Skill failed — see error",
          findings: [],
          costUsd: 0,
          error: isCredits ? undefined : result.error,
        };
      }

      const findings: Finding[] = result.topSegments.map((seg) => ({
        severity: seg.aiScore >= 0.85 ? "error" : "warn",
        text: `${Math.round(seg.aiScore * 100)}% AI probability`,
        quote: seg.text,
      }));

      return {
        skillId: this.id,
        name: this.name,
        score: Math.max(0, 100 - result.aiPct),
        verdict: result.verdict === "human" ? "pass" : result.verdict === "mixed" ? "warn" : "fail",
        summary: `${result.aiPct}% AI probability — ${result.verdict}`,
        findings,
        costUsd: 0.03,
        error: result.error,
      };
    } catch (err) {
      const msg = (err as Error).message;

      // Copyscape throws for English-only errors — skip; user must explicitly set
      // providers["ai-detection"].provider = "gemini-ai-detection" for multilingual.
      if (msg.includes(ENGLISH_ONLY_SIGNAL)) {
        return {
          skillId: this.id,
          name: this.name,
          score: 0,
          verdict: "skipped",
          summary: "AI detection skipped — Copyscape does not support non-English text. To enable multilingual detection, set GEMINI_API_KEY (or run checkapp --setup) and configure the ai-detection provider to gemini-ai-detection.",
          findings: [],
          costUsd: 0,
        };
      }

      return {
        skillId: this.id,
        name: this.name,
        score: 0,
        verdict: "fail",
        summary: "Skill failed — see error",
        findings: [],
        costUsd: 0,
        error: msg,
      };
    }
  }

  async #runGemini(text: string, config: Config, isAutoFallback: boolean): Promise<SkillResult> {
    const result = await checkAiDetectorGemini(text, config);

    const findings: Finding[] = result.topSegments.map((seg) => ({
      severity: seg.aiScore >= 0.85 ? "error" : "warn",
      text: `${Math.round(seg.aiScore * 100)}% AI probability`,
      quote: seg.text,
    }));

    if (isAutoFallback && !result.error) {
      findings.unshift({
        severity: "warn",
        text: "Switched to Gemini — Copyscape AI detection does not support non-English text.",
      });
    }

    return {
      skillId: this.id,
      name: this.name,
      score: result.error ? 0 : Math.max(0, 100 - result.aiPct),
      verdict: result.error
        ? "fail"
        : result.verdict === "human" ? "pass" : result.verdict === "mixed" ? "warn" : "fail",
      summary: result.error
        ? "Skill failed — see error"
        : `${result.aiPct}% AI probability — ${result.verdict} (Gemini)`,
      findings,
      costUsd: result.error ? 0 : 0.01,
      error: result.error,
    };
  }
}
