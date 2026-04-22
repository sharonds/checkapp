import type { Config } from "../config.ts";
import { createGeminiCapability } from "../providers/gemini-capability.ts";
import {
  getActiveAuditForParent,
  getDeepAudit,
  openDb,
  insertDeepAudit,
  updateAuditStatus,
  type DB,
  type DeepAuditParentType,
  type DeepAuditRequestedBy,
  type DeepAuditStatus,
} from "../db.ts";
import {
  emitAuditCompletedEvent,
  emitAuditCreatedEvent,
  emitAuditFailedEvent,
  emitAuditPollEvent,
  emitAuditRequestedEvent,
} from "../telemetry/audit-events.ts";
import { BASE, createInteraction, extractText, type InteractionResponse } from "../utils/interactions-api.ts";
import type { Skill, SkillResult } from "./types.ts";

const ESTIMATED_COMPLETION_MS = 15 * 60_000;
const DEFAULT_COST_USD = 1.5;

export interface FactCheckDeepResearchSkillOptions {
  db?: DB;
  dbPath?: string;
  now?: () => number;
}

export interface InitiateDeepResearchResult {
  interactionId: string | null;
  status: Extract<DeepAuditStatus, "pending" | "in_progress">;
  estimatedCompletion: number;
}

export class FactCheckDeepResearchSkill implements Skill {
  readonly id = "fact-check-deep-research";
  readonly name = "Fact Check (Deep Research)";

  private readonly db?: DB;
  private readonly dbPath?: string;
  private readonly now: () => number;

  constructor(options: FactCheckDeepResearchSkillOptions = {}) {
    this.db = options.db;
    this.dbPath = options.dbPath;
    this.now = options.now ?? Date.now;
  }

  async run(_text: string, _config: Config): Promise<SkillResult> {
    return {
      skillId: this.id,
      name: this.name,
      score: 0,
      verdict: "skipped",
      summary: "Deep Audit is async — initiate via dashboard or MCP tool",
      findings: [],
      costUsd: 0,
      provider: "gemini-deep-research",
    };
  }

  async initiate(
    text: string,
    parentType: DeepAuditParentType,
    parentKey: string,
    config: Config,
    requestedBy: DeepAuditRequestedBy = "mcp",
  ): Promise<InitiateDeepResearchResult> {
    const apiKey = requireGeminiApiKey(config);
    emitAuditRequestedEvent({
      provider: "gemini-deep-research",
      parentType,
      parentKey,
      requestedBy,
    });

    return this.withDb(async (db) => {
      const active = getActiveAuditForParent(db, parentType, parentKey);
      if (active?.interactionId) {
        const status = active.status === "pending" ? "pending" : "in_progress";
        return {
          interactionId: active.interactionId,
          status,
          estimatedCompletion: active.startedAt + ESTIMATED_COMPLETION_MS,
        };
      }

      const capability = createGeminiCapability({ apiKey });
      const model = capability.getModel("deep-research");
      if (model !== capability.models.deepResearch) {
        throw new Error("Gemini Deep Research capability is currently unavailable");
      }

      const pendingAuditId = active?.id ?? null;
      const startedAt = this.now();
      const auditId = pendingAuditId ?? insertDeepAudit(db, {
        parentType,
        parentKey,
        requestedBy,
        startedAt,
        costEstimateUsd: DEFAULT_COST_USD,
      });

      try {
        const { id: interactionId } = await createInteraction(apiKey, {
          input: buildDeepResearchPrompt(text),
          agent: model,
          background: true,
          store: true,
          agent_config: {
            type: "deep-research",
            thinking_summaries: "auto",
            visualization: "off",
          },
        });

        db.run(
          "UPDATE deep_audits SET interaction_id = ?, status = 'in_progress', started_at = ?, requested_by = ?, cost_estimate_usd = ? WHERE id = ?",
          [interactionId, startedAt, requestedBy, DEFAULT_COST_USD, auditId],
        );
        emitAuditCreatedEvent({
          provider: "gemini-deep-research",
          auditId,
          interactionId,
          parentType,
          parentKey,
          requestedBy,
        });

        return {
          interactionId,
          status: "in_progress",
          estimatedCompletion: startedAt + ESTIMATED_COMPLETION_MS,
        };
      } catch (error) {
        db.run(
          "UPDATE deep_audits SET status = 'failed', completed_at = ?, error_message = ? WHERE id = ?",
          [this.now(), errorMessage(error), auditId],
        );
        emitAuditFailedEvent({
          provider: "gemini-deep-research",
          auditId,
          interactionId: null,
          parentType,
          parentKey,
          requestedBy,
          reason: errorMessage(error),
          stage: "create",
        });
        throw error;
      }
    });
  }

  async fetchResult(interactionId: string, config: Config): Promise<SkillResult | null> {
    const apiKey = requireGeminiApiKey(config);
    emitAuditPollEvent({
      provider: "gemini-deep-research",
      interactionId,
    });
    const response = await fetch(
      `${BASE}/interactions/${encodeURIComponent(interactionId)}?key=${encodeURIComponent(apiKey)}`,
    );

    if (response.status === 404) {
      const error = `Interaction ${interactionId} was not found`;
      return this.withDb((db) => {
        updateAuditStatus(db, interactionId, "failed", {
          errorMessage: error,
          completedAt: this.now(),
        });
        const audit = getDeepAudit(db, interactionId);
        emitAuditFailedEvent({
          provider: "gemini-deep-research",
          interactionId,
          auditId: audit?.id ?? null,
          parentType: audit?.parentType ?? null,
          parentKey: audit?.parentKey ?? null,
          reason: error,
          stage: "poll",
        });
        return failedResult(this, error);
      });
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch interaction ${interactionId}: ${response.status}`);
    }

    const data = (await response.json()) as InteractionResponse;
    const status = normalizeInteractionStatus(data.status);
    if (status === "in_progress") {
      return null;
    }

    if (status === "failed") {
      const error = data.error?.trim() || `Interaction ${interactionId} failed`;
      return this.withDb((db) => {
        updateAuditStatus(db, interactionId, "failed", {
          errorMessage: error,
          resultJson: JSON.stringify(data),
          completedAt: this.now(),
        });
        const audit = getDeepAudit(db, interactionId);
        emitAuditFailedEvent({
          provider: "gemini-deep-research",
          interactionId,
          auditId: audit?.id ?? null,
          parentType: audit?.parentType ?? null,
          parentKey: audit?.parentKey ?? null,
          reason: error,
          stage: "poll",
        });
        return failedResult(this, error);
      });
    }

    const text = extractText(data);
    return this.withDb((db) => {
      updateAuditStatus(db, interactionId, "completed", {
        resultText: text,
        resultJson: JSON.stringify(data),
        errorMessage: null,
        completedAt: this.now(),
      });
      const audit = getDeepAudit(db, interactionId);
      emitAuditCompletedEvent({
        provider: "gemini-deep-research",
        interactionId,
        auditId: audit?.id ?? null,
        parentType: audit?.parentType ?? null,
        parentKey: audit?.parentKey ?? null,
      });
      return completedResult(this, text);
    });
  }

  private async withDb<T>(work: (db: DB) => Promise<T> | T): Promise<T> {
    const db = this.db ?? openDb(this.dbPath);
    const shouldClose = this.db === undefined;
    try {
      return await work(db);
    } finally {
      if (shouldClose) {
        db.close();
      }
    }
  }
}

function buildDeepResearchPrompt(text: string): string {
  return `Fact-check the following article. Produce a rigorous, structured verification report.

## Output Format

### 1. Executive Summary
One paragraph assessing the article's overall factual accuracy and any pattern of issues (misattributions, date errors, fabricated statistics).

### 2. Claim-by-Claim Verification
A Markdown table with columns: | Exact Claim | Verdict | Evidence | Primary Sources (URLs) |

Extract every specific factual claim containing: statistics, percentages, named studies, dates, named entities, dollar amounts, or scientific findings.

### 3. Key Findings
Bullet list of the most material factual issues, ordered by severity.

## Verdict Scale

- **Supported** — evidence confirms the exact claim including specific figures
- **Partially Supported** — core claim is correct but one or more specifics (date, author, figure) are wrong
- **Misattributed** — figure or finding is real but source is wrong (different paper / year / journal / author)
- **Unsupported** — no credible evidence found after thorough search
- **Fabricated** — specific claim appears to be invented (cannot be located anywhere)

## Guidelines

1. Cite primary sources (original papers, government data, official reports) with full URLs
2. If a statistic cannot be verified, state what searches were performed and mark "Unsupported"
3. For misattributed claims, identify the TRUE source (author, year, journal, URL)
4. For partial truths, specify exactly which part is accurate and which part is off
5. Do not rely on secondary summaries when primary sources are available

## Article to fact-check

${text.slice(0, 4000)}`;
}

function normalizeInteractionStatus(status: string | undefined): "in_progress" | "completed" | "failed" {
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  return "in_progress";
}

function requireGeminiApiKey(config: Config): string {
  if (!config.geminiApiKey) {
    throw new Error("geminiApiKey is required for deep research");
  }
  return config.geminiApiKey;
}

function completedResult(skill: FactCheckDeepResearchSkill, text: string): SkillResult {
  return {
    skillId: skill.id,
    name: skill.name,
    score: 100,
    verdict: "pass",
    summary: "Deep Audit completed",
    findings: [{ severity: "info", text }],
    costUsd: DEFAULT_COST_USD,
    provider: "gemini-deep-research",
  };
}

function failedResult(skill: FactCheckDeepResearchSkill, error: string): SkillResult {
  return {
    skillId: skill.id,
    name: skill.name,
    score: 0,
    verdict: "fail",
    summary: `Deep Audit failed: ${error}`,
    findings: [{ severity: "error", text: error }],
    costUsd: 0,
    provider: "gemini-deep-research",
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
