import type { SkillResult } from "./skills/types.ts";
import { getLlmClient, parseJsonResponse } from "./skills/llm.ts";
import { readConfig, type Config } from "./config.ts";
import { openDb, loadAllContexts } from "./db.ts";

export interface Rewrite {
  original: string;
  rewritten: string;
  reason: string;
}

export interface RegenerateResult {
  rewrites: Rewrite[];
  summary: string;
}

export interface RegenerateSkippedResult {
  status: "skipped";
  reason: string;
  text: string;
  costUsd: number;
}

export function buildRegeneratePrompt(
  articleText: string,
  results: SkillResult[],
  contexts: Record<string, string>
): string {
  const issues: string[] = [];
  for (const r of results) {
    for (const f of r.findings) {
      if ((f.severity === "warn" || f.severity === "error") && f.quote) {
        issues.push(`[${r.name}] ${f.text}\n  Quote: "${f.quote}"`);
      }
    }
  }

  if (issues.length === 0) return "";

  const toneGuide = contexts["tone-guide"] ? `\nTONE GUIDE:\n${contexts["tone-guide"].slice(0, 1500)}\n` : "";
  const legalPolicy = contexts["legal-policy"] ? `\nLEGAL POLICY:\n${contexts["legal-policy"].slice(0, 1500)}\n` : "";

  return `You are a content editor. Rewrite the flagged sentences to fix the identified issues.
Keep the meaning intact. Match the tone guide if provided. Fix legal issues if flagged.
${toneGuide}${legalPolicy}
ORIGINAL ARTICLE:
${articleText.slice(0, 4000)}

ISSUES FOUND:
${issues.join("\n\n")}

For each quoted sentence, provide a rewritten version. Reply with ONLY this JSON:
{
  "rewrites": [
    { "original": "<exact original sentence>", "rewritten": "<improved version>", "reason": "<which issue this fixes>" }
  ],
  "summary": "<one sentence summary of changes>"
}`;
}

export function parseRegenerateResponse(raw: string): RegenerateResult {
  return parseJsonResponse<RegenerateResult>(raw);
}

export async function regenerateArticle(
  articleText: string,
  results: SkillResult[],
  options?: { config?: Config; contexts?: Record<string, string> }
): Promise<RegenerateResult | RegenerateSkippedResult> {
  const cfg = options?.config ?? readConfig();
  let contexts = options?.contexts;
  let db: ReturnType<typeof openDb> | null = null;

  try {
    // Load contexts from DB only if not provided
    if (!contexts) {
      db = openDb();
      contexts = loadAllContexts(db);
    }

    const prompt = buildRegeneratePrompt(articleText, results, contexts);

    if (!prompt) return { rewrites: [], summary: "No fixable issues found" };

    const llm = getLlmClient({ ...cfg, contexts });
    if (!llm) {
      return {
        status: "skipped",
        reason: "No LLM provider configured (set MINIMAX_API_KEY, ANTHROPIC_API_KEY, or OPENROUTER_API_KEY)",
        text: articleText,
        costUsd: 0,
      };
    }

    const raw = await llm.call(prompt, 2048);
    return parseRegenerateResponse(raw);
  } finally {
    db?.close();
  }
}
