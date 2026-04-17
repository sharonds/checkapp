import type { Skill, SkillResult, Finding } from "./types.ts";
import type { Config } from "../config.ts";
import { resolveProvider } from "../providers/resolve.ts";
import { ltCheck } from "../providers/languagetool.ts";

const MAX_FINDINGS = 50;

export class GrammarSkill implements Skill {
  readonly id = "grammar";
  readonly name = "Grammar & Style";

  async run(text: string, config: Config): Promise<SkillResult> {
    const resolved = resolveProvider(config, "grammar");
    if (!resolved) {
      return {
        skillId: this.id, name: this.name, score: 0, verdict: "skipped",
        summary: "Skipped: no provider configured.",
        findings: [],
        costUsd: 0,
      };
    }

    if (resolved.provider === "languagetool" || resolved.provider === "languagetool-selfhosted") {
      return await this.runLanguageTool(text, config, resolved);
    }

    if (resolved.provider === "llm-fallback") {
      return await this.runLlmFallback(text, config, resolved);
    }

    // sapling and other providers — stub skip until implemented
    return {
      skillId: this.id, name: this.name, score: 0, verdict: "skipped",
      summary: `Skipped: ${resolved.provider} not implemented for grammar yet.`,
      findings: [],
      costUsd: 0, provider: resolved.provider,
    };
  }

  private async runLanguageTool(
    text: string,
    config: Config,
    resolved: NonNullable<ReturnType<typeof resolveProvider>>,
  ): Promise<SkillResult> {
    const endpoint = resolved.metadata?.endpoint
      ?? config.providers?.grammar?.extra?.endpoint
      ?? "https://api.languagetool.org/v2/check";

    try {
      const ltRes = await ltCheck({ endpoint, text, apiKey: resolved.apiKey });
      const findings = ltRes.matches.slice(0, MAX_FINDINGS).map((m): Finding => {
        const best = m.replacements[0]?.value ?? "";
        const bad = text.slice(m.offset, m.offset + m.length);
        const rewrite = best && bad ? m.sentence.replace(bad, best) : undefined;
        return {
          severity: m.rule.id.startsWith("MORFOLOGIK") ? "error" : "warn",
          text: `${m.rule.description}: ${m.message}`,
          quote: m.sentence,
          rewrite,
        };
      });
      const errors = findings.filter(f => f.severity === "error").length;
      const warns = findings.filter(f => f.severity === "warn").length;
      const score = Math.max(0, 100 - errors * 8 - warns * 2);
      // Any finding drops below pass — even one is a user-visible mistake.
      const verdict: SkillResult["verdict"] =
        findings.length === 0 ? "pass" : score >= 50 ? "warn" : "fail";
      return {
        skillId: this.id, name: this.name, score, verdict,
        summary: findings.length === 0 ? "No grammar issues found" : `${findings.length} issues (${errors} errors, ${warns} warnings)`,
        findings, costUsd: 0, provider: resolved.provider,
      };
    } catch (err) {
      return {
        skillId: this.id, name: this.name, score: 60, verdict: "warn",
        summary: `LanguageTool check failed: ${(err as Error).message}`,
        findings: [{ severity: "info", text: "LanguageTool endpoint unreachable — check network or endpoint config" }],
        costUsd: 0, provider: resolved.provider,
      };
    }
  }

  private async runLlmFallback(
    text: string,
    config: Config,
    _resolved: NonNullable<ReturnType<typeof resolveProvider>>,
  ): Promise<SkillResult> {
    const { getLlmClient, parseJsonResponse } = await import("./llm.ts");
    const llm = getLlmClient(config);
    if (!llm) {
      return {
        skillId: this.id, name: this.name, score: 60, verdict: "warn",
        summary: "LLM fallback unavailable — no LLM key configured",
        findings: [{ severity: "info", text: "Configure an LLM provider (MINIMAX_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY)" }],
        costUsd: 0,
      };
    }

    const prompt = `Find up to 10 grammar, spelling, or style errors in the text below.
Return ONLY a JSON array of objects with this shape:
[{ "quote": "<exact erroneous sentence from the text>", "rewrite": "<corrected sentence>", "rule": "<short rule name, e.g. 'Subject-verb agreement'>" }]

Text:
${text.slice(0, 4000)}

JSON array:`;

    let items: Array<{ quote: string; rewrite: string; rule: string }> = [];
    try {
      const raw = await llm.call(prompt, 2048);
      const parsed = parseJsonResponse<Array<{ quote: string; rewrite: string; rule: string }>>(raw);
      if (Array.isArray(parsed)) {
        // Drop malformed items — missing quote/rewrite produces garbage findings.
        items = parsed.filter((i) =>
          i != null && typeof i === "object"
          && typeof i.quote === "string" && i.quote.length > 0
          && typeof i.rewrite === "string" && i.rewrite.length > 0
        ).slice(0, 10);
      }
    } catch { /* swallow — fall through to empty findings */ }

    let findings: Finding[] = items.map((i) => ({
      severity: "warn",
      text: String(i.rule ?? "Grammar issue"),
      quote: String(i.quote ?? ""),
      rewrite: String(i.rewrite ?? ""),
    }));

    // R9: Grammar-pass on AI rewrites. LT is free and deterministic — correct
    // mechanical errors in the LLM's rewrite before surfacing it to the user.
    // Skipped if explicitly disabled via providers.grammar.extra.recheck (false or "false").
    // `extra` is typed Record<string, string> but config JSON may contain booleans;
    // the cast is deliberate — user config is untrusted JSON.
    const recheckRaw = config.providers?.grammar?.extra?.recheck as unknown;
    const recheckDisabled = recheckRaw === false || recheckRaw === "false";
    // Self-hosted LT users: set providers.grammar.extra.recheckEndpoint to your
    // self-hosted URL to keep text off third-party servers.
    const recheckEndpoint = (config.providers?.grammar?.extra?.recheckEndpoint as string | undefined)
      ?? "https://api.languagetool.org/v2/check";
    if (!recheckDisabled) {
      findings = await Promise.all(findings.map(async (f) => {
        if (!f.rewrite) return f;
        try {
          const recheck = await ltCheck({
            endpoint: recheckEndpoint,
            text: f.rewrite,
          });
          if (recheck.matches.length === 0) return f;
          let corrected = f.rewrite;
          for (const m of recheck.matches.slice(0, 5)) {
            const best = m.replacements[0]?.value;
            if (!best) continue;
            const bad = f.rewrite.slice(m.offset, m.offset + m.length);
            if (!bad) continue;
            corrected = corrected.replace(bad, best);
          }
          return { ...f, rewrite: corrected };
        } catch {
          return f;
        }
      }));
    }

    const score = Math.max(0, 100 - findings.length * 3);
    const verdict: SkillResult["verdict"] = score >= 75 ? "pass" : score >= 50 ? "warn" : "fail";
    return {
      skillId: this.id, name: this.name, score, verdict,
      summary: findings.length === 0 ? "No grammar issues found (LLM)" : `LLM found ${findings.length} issues${recheckDisabled ? "" : " (rewrites grammar-checked)"}`,
      findings, costUsd: 0.002, provider: "llm-fallback",
    };
  }
}
