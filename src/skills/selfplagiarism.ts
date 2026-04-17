import type { Skill, SkillResult, Finding, Source } from "./types.ts";
import type { Config } from "../config.ts";
import { resolveProvider } from "../providers/resolve.ts";
import { embed, vectorizeQuery } from "../providers/vectorize.ts";

const SIM_THRESHOLD = 0.85;
const SIM_ERROR_THRESHOLD = 0.95;

export class SelfPlagiarismSkill implements Skill {
  readonly id = "self-plagiarism";
  readonly name = "Self-Plagiarism";

  async run(text: string, config: Config): Promise<SkillResult> {
    const resolved = resolveProvider(config, "self-plagiarism");
    if (!resolved?.apiKey) {
      return {
        skillId: this.id, name: this.name, score: 90, verdict: "warn",
        summary: "Self-plagiarism skipped — no provider configured",
        findings: [{ severity: "info", text: "Configure Cloudflare Vectorize (or Pinecone/Upstash) in Settings → Providers. Requires an OpenRouter key for embeddings." }],
        costUsd: 0,
      };
    }

    if (!config.openrouterApiKey) {
      return {
        skillId: this.id, name: this.name, score: 90, verdict: "warn",
        summary: "Self-plagiarism skipped — OPENROUTER_API_KEY required for embeddings",
        findings: [{ severity: "info", text: "Add an OpenRouter key to enable embedding. text-embedding-3-small @ 768 dims (~$0.00002/1k tokens)." }],
        costUsd: 0,
      };
    }

    if (resolved.provider !== "cloudflare-vectorize") {
      return {
        skillId: this.id, name: this.name, score: 90, verdict: "warn",
        summary: `Self-plagiarism provider ${resolved.provider} not yet implemented — lands in a follow-up`,
        findings: [{ severity: "info", text: "Use Cloudflare Vectorize for now." }],
        costUsd: 0, provider: resolved.provider,
      };
    }

    const accountId = config.providers?.["self-plagiarism"]?.extra?.accountId;
    const indexName = config.providers?.["self-plagiarism"]?.extra?.indexName ?? "articles";
    if (!accountId) {
      return {
        skillId: this.id, name: this.name, score: 90, verdict: "warn",
        summary: "Self-plagiarism misconfigured — missing accountId",
        findings: [{ severity: "info", text: "Add providers['self-plagiarism'].extra.accountId (your Cloudflare account id)." }],
        costUsd: 0, provider: resolved.provider,
      };
    }

    try {
      const vec = await embed(text, config.openrouterApiKey);
      const matches = await vectorizeQuery({
        accountId, indexName, apiKey: resolved.apiKey,
        vector: vec, topK: 5,
      });

      const hits = matches.filter(m => m.score >= SIM_THRESHOLD);

      if (hits.length === 0) {
        return {
          skillId: this.id, name: this.name, score: 100, verdict: "pass",
          summary: matches.length === 0
            ? "No self-plagiarism detected (index may be empty — run `checkapp index <dir>` to ingest past articles)"
            : "No self-plagiarism detected",
          findings: [], costUsd: 0.0001, provider: resolved.provider,
        };
      }

      const findings: Finding[] = hits.map((m): Finding => {
        const src: Source = {
          url: m.metadata?.url ?? `vectorize://${m.id}`,
          title: m.metadata?.title ?? m.id,
          publishedDate: m.metadata?.publishedAt,
          quote: m.metadata?.snippet,
          relevanceScore: m.score,
        };
        return {
          severity: m.score >= SIM_ERROR_THRESHOLD ? "error" : "warn",
          text: `High similarity (${(m.score * 100).toFixed(0)}%) with your past article: ${src.title}`,
          sources: [src],
          rewrite: "Consider linking to the original or rewriting this section to avoid duplicate content.",
        };
      });

      const score = Math.max(0, 100 - hits.length * 20);
      // Score-based base verdict:
      let verdict: SkillResult["verdict"] = score >= 75 ? "pass" : score >= 50 ? "warn" : "fail";
      // Any user-visible hit (warn or error) blocks a pass — no green verdict with
      // a visible finding. Override only downgrades pass; never upgrades warn/fail.
      if (verdict === "pass" && findings.some(f => f.severity === "warn" || f.severity === "error")) {
        verdict = "warn";
      }
      return {
        skillId: this.id, name: this.name, score, verdict,
        summary: `${hits.length} overlap(s) found with past articles`,
        findings, costUsd: 0.0001, provider: resolved.provider,
      };
    } catch (err) {
      return {
        skillId: this.id, name: this.name, score: 90, verdict: "warn",
        summary: `Self-plagiarism check failed: ${(err as Error).message.slice(0, 200)}`,
        findings: [{ severity: "info", text: "Check Vectorize index name, accountId, and API key permissions." }],
        costUsd: 0, provider: resolved.provider,
      };
    }
  }
}
