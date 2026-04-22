import { sql } from "drizzle-orm";
import type { NextRequest } from "next/server";
import { jsonWithCors } from "@/lib/cors";
import { getDb } from "@/lib/db";
import { readConfig } from "../../../../../../../src/config";
import {
  emitAuditCompletedEvent,
  emitAuditCreatedEvent,
  emitAuditFailedEvent,
  emitAuditPollEvent,
  emitAuditRequestedEvent,
  emitAuditStaleEvent,
} from "../../../../../../../src/telemetry/audit-events";
import {
  BASE,
  createInteraction,
  extractText,
  type InteractionResponse,
} from "../../../../../../../src/utils/interactions-api";
import { createGeminiCapability } from "../../../../../../../src/providers/gemini-capability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeepAuditStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "failed"
  | "stale";

interface DeepAuditRow {
  id: number;
  parent_type: "check" | "content_hash";
  parent_key: string;
  interaction_id: string | null;
  status: DeepAuditStatus;
  requested_by: "dashboard" | "mcp" | "cli";
  started_at: number;
  completed_at: number | null;
  result_text: string | null;
  result_json: string | null;
  error_message: string | null;
  cost_estimate_usd: number;
}

interface DeepAuditRecord {
  id: number;
  parentType: "check" | "content_hash";
  parentKey: string;
  interactionId: string | null;
  status: DeepAuditStatus;
  requestedBy: "dashboard" | "mcp" | "cli";
  startedAt: number;
  completedAt: number | null;
  resultText: string | null;
  resultJson: string | null;
  errorMessage: string | null;
  costEstimateUsd: number;
}

interface CheckArticleRow {
  id: number;
  source: string;
  article_text: string;
}

const STALE_THRESHOLD_MS = 90 * 60_000;
const DEFAULT_COST_USD = 1.5;
const STALE_MESSAGE = "Deep Audit exceeded the 90 minute stale threshold.";

let schemaReady = false;
const inFlightReconciliations = new Set<string>();
let runtimeInitPromise: Promise<void> | null = null;
void initializeDeepAuditRuntime().catch((error) => {
  console.error(getErrorMessage(error, "Failed to initialize Deep Audit runtime"));
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDeepAuditSchema();
    await initializeDeepAuditRuntime();

    const reportId = getReportId(await params);
    const parentKey = String(reportId);
    if (!checkExists(reportId)) {
      return jsonWithCors({ error: `Report ${reportId} not found` }, { status: 404 });
    }

    markExpiredAuditsForParent(parentKey);

    const searchParams = request.nextUrl.searchParams;
    const history = searchParams.get("history");
    const auditIdParam = searchParams.get("auditId") ?? searchParams.get("id");

    if (history === "true") {
      return jsonWithCors({
        audits: getAuditsForParent(parentKey).map(serializeAudit),
      });
    }

    if (auditIdParam) {
      const auditId = Number(auditIdParam);
      if (!Number.isInteger(auditId) || auditId <= 0) {
        return jsonWithCors({ error: "auditId must be a positive integer" }, { status: 400 });
      }

      const current = getAuditById(parentKey, auditId);
      if (!current) {
        return jsonWithCors({ error: `Deep Audit ${auditId} not found` }, { status: 404 });
      }

      const refreshed = await refreshAuditIfNeeded(current, { failHard: true });
      if (refreshed.status === "in_progress" && refreshed.interaction_id) {
        triggerBackgroundReconciliation(refreshed);
      }

      return jsonWithCors(serializeAudit(refreshed));
    }

    let audits = getAuditsForParent(parentKey);
    let mostRecent = audits[0] ?? null;

    if (mostRecent?.status === "in_progress") {
      mostRecent = await refreshAuditIfNeeded(mostRecent, { failHard: false });
      audits = [mostRecent, ...audits.filter((audit) => audit.id !== mostRecent.id)];
    } else if (mostRecent?.status === "pending") {
      mostRecent = refreshPendingStaleness(mostRecent);
      audits = [mostRecent, ...audits.filter((audit) => audit.id !== mostRecent.id)];
    }

    if (mostRecent?.status === "in_progress" && mostRecent.interaction_id) {
      triggerBackgroundReconciliation(mostRecent);
    }

    return jsonWithCors({
      mostRecent: mostRecent ? serializeAudit(mostRecent) : null,
      previousCount: Math.max(audits.length - 1, 0),
    });
  } catch (error) {
    return jsonWithCors(
      { error: getErrorMessage(error, "Failed to fetch Deep Audit status") },
      { status: 500 },
    );
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    ensureDeepAuditSchema();
    await initializeDeepAuditRuntime();

    const reportId = getReportId(await params);
    const parentKey = String(reportId);
    if (!checkExists(reportId)) {
      return jsonWithCors({ error: `Report ${reportId} not found` }, { status: 404 });
    }

    if (!hasChecksArticleTextColumn()) {
      return jsonWithCors(
        {
          error:
            `Historical report ${reportId} does not store article text. ` +
            "Deep Audit cannot start for that report until it is re-checked with stored article text.",
        },
        { status: 400 },
      );
    }

    const check = getCheckArticle(reportId);
    if (!check) {
      return jsonWithCors({ error: `Report ${reportId} not found` }, { status: 404 });
    }

    if (!check.article_text.trim()) {
      return jsonWithCors(
        {
          error:
            `Historical report ${reportId} does not store article text. ` +
            "Deep Audit cannot start for that report until it is re-checked with stored article text.",
        },
        { status: 400 },
      );
    }

    markExpiredAuditsForParent(parentKey);

    const active = getActiveAuditForParent(parentKey);
    if (active?.interaction_id) {
      if (active.status === "in_progress" && active.interaction_id) {
        triggerBackgroundReconciliation(active);
      }
      return jsonWithCors({
        audit: serializeAudit(active),
        reused: true,
      });
    }

    const config = readConfig();
    if (!config.geminiApiKey) {
      return jsonWithCors(
        { error: "GEMINI_API_KEY or config.geminiApiKey is required for Deep Audit" },
        { status: 400 },
      );
    }

    const db = getDb();
    const startedAt = Date.now();
    emitAuditRequestedEvent({
      provider: "gemini-deep-research",
      parentType: "check",
      parentKey,
      requestedBy: "dashboard",
    });
    if (!active) {
      db.run(sql`
        INSERT INTO deep_audits (
          parent_type,
          parent_key,
          status,
          requested_by,
          started_at,
          cost_estimate_usd
        )
        VALUES ('check', ${parentKey}, 'pending', 'dashboard', ${startedAt}, ${DEFAULT_COST_USD})
      `);
    }

    const created = active ?? getNewestAuditForParent(parentKey);
    if (!created) {
      throw new Error("Deep Audit row was not created");
    }

    try {
      const { id: interactionId } = await createInteraction(config.geminiApiKey, {
        input: buildDeepResearchPrompt(check.article_text),
        agent: requireDeepResearchAgent(config.geminiApiKey),
        background: true,
        store: true,
        agent_config: {
          type: "deep-research",
          thinking_summaries: "auto",
          visualization: "off",
        },
      });

      db.run(sql`
        UPDATE deep_audits
        SET interaction_id = ${interactionId}, status = 'in_progress'
        WHERE id = ${created.id}
      `);
      emitAuditCreatedEvent({
        provider: "gemini-deep-research",
        auditId: created.id,
        interactionId,
        parentType: "check",
        parentKey,
        requestedBy: "dashboard",
      });

      const started = getAuditById(parentKey, created.id);
      if (!started) {
        throw new Error("Deep Audit row could not be reloaded after start");
      }

      triggerBackgroundReconciliation(started);

      return jsonWithCors({
        audit: serializeAudit(started),
        reused: false,
      });
    } catch (error) {
      db.run(sql`
        UPDATE deep_audits
        SET
          status = 'failed',
          completed_at = ${Date.now()},
          error_message = ${getErrorMessage(error, "Deep Audit could not be started")}
        WHERE id = ${created.id}
      `);
      emitAuditFailedEvent({
        provider: "gemini-deep-research",
        auditId: created.id,
        interactionId: null,
        parentType: "check",
        parentKey,
        requestedBy: "dashboard",
        reason: getErrorMessage(error, "Deep Audit could not be started"),
        stage: "create",
      });

      return jsonWithCors(
        { error: getErrorMessage(error, "Deep Audit could not be started") },
        { status: 502 },
      );
    }
  } catch (error) {
    return jsonWithCors(
      { error: getErrorMessage(error, "Failed to start Deep Audit") },
      { status: 500 },
    );
  }
}

function ensureDeepAuditSchema() {
  if (schemaReady) return;

  const db = getDb();
  db.run(sql`
    CREATE TABLE IF NOT EXISTS deep_audits (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      parent_type       TEXT NOT NULL CHECK (parent_type IN ('check', 'content_hash')),
      parent_key        TEXT NOT NULL,
      interaction_id    TEXT UNIQUE,
      status            TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'stale')),
      requested_by      TEXT NOT NULL CHECK (requested_by IN ('dashboard', 'mcp', 'cli')),
      started_at        INTEGER NOT NULL,
      completed_at      INTEGER,
      result_text       TEXT,
      result_json       TEXT,
      error_message     TEXT,
      cost_estimate_usd REAL NOT NULL DEFAULT 1.5
    )
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_deep_audits_parent
    ON deep_audits (parent_type, parent_key)
  `);
  db.run(sql`
    CREATE INDEX IF NOT EXISTS idx_deep_audits_status_started
    ON deep_audits (status, started_at)
  `);
  schemaReady = true;
}

async function initializeDeepAuditRuntime(): Promise<void> {
  if (runtimeInitPromise) {
    return runtimeInitPromise;
  }

  runtimeInitPromise = (async () => {
    ensureDeepAuditSchema();
    for (const audit of listStartupInProgressAudits()) {
      const refreshed = await refreshAuditIfNeeded(audit, { failHard: false });
      if (refreshed.status === "in_progress" && refreshed.interaction_id) {
        triggerBackgroundReconciliation(refreshed);
      }
    }
  })().catch((error) => {
    runtimeInitPromise = null;
    throw error;
  });

  return runtimeInitPromise;
}

function getReportId(params: { id: string }) {
  const reportId = Number(params.id);
  if (!Number.isInteger(reportId) || reportId <= 0) {
    throw new Error("Report id must be a positive integer");
  }
  return reportId;
}

function checkExists(reportId: number) {
  const db = getDb();
  const rows = db.all(sql`SELECT id FROM checks WHERE id = ${reportId} LIMIT 1`) as Array<{
    id: number;
  }>;
  return rows.length > 0;
}

function hasChecksArticleTextColumn() {
  const db = getDb();
  const rows = db.all(sql`PRAGMA table_info(checks)`) as Array<{ name: string }>;
  return rows.some((row) => row.name === "article_text");
}

function getCheckArticle(reportId: number): CheckArticleRow | null {
  if (!hasChecksArticleTextColumn()) {
    return null;
  }

  const db = getDb();
  const rows = db.all(
    sql`SELECT id, source, article_text FROM checks WHERE id = ${reportId} LIMIT 1`,
  ) as CheckArticleRow[];
  return rows[0] ?? null;
}

function listStartupInProgressAudits(): DeepAuditRow[] {
  const db = getDb();
  return db.all(sql`
    SELECT *
    FROM deep_audits
    WHERE status IN ('pending', 'in_progress')
    ORDER BY started_at ASC, id ASC
  `) as DeepAuditRow[];
}

function getAuditsForParent(parentKey: string): DeepAuditRow[] {
  const db = getDb();
  return db.all(sql`
    SELECT *
    FROM deep_audits
    WHERE parent_type = 'check'
      AND parent_key = ${parentKey}
    ORDER BY started_at DESC, id DESC
  `) as DeepAuditRow[];
}

function getNewestAuditForParent(parentKey: string): DeepAuditRow | null {
  return getAuditsForParent(parentKey)[0] ?? null;
}

function getActiveAuditForParent(parentKey: string): DeepAuditRow | null {
  const db = getDb();
  const rows = db.all(sql`
    SELECT *
    FROM deep_audits
    WHERE parent_type = 'check'
      AND parent_key = ${parentKey}
      AND status IN ('pending', 'in_progress')
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `) as DeepAuditRow[];

  return rows[0] ?? null;
}

function getAuditById(parentKey: string, auditId: number): DeepAuditRow | null {
  const db = getDb();
  const rows = db.all(sql`
    SELECT *
    FROM deep_audits
    WHERE id = ${auditId}
      AND parent_type = 'check'
      AND parent_key = ${parentKey}
    LIMIT 1
  `) as DeepAuditRow[];
  return rows[0] ?? null;
}

function markExpiredAuditsForParent(parentKey: string) {
  const db = getDb();
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  const expired = db.all(sql`
    SELECT *
    FROM deep_audits
    WHERE parent_type = 'check'
      AND parent_key = ${parentKey}
      AND status = 'in_progress'
      AND started_at < ${cutoff}
  `) as DeepAuditRow[];

  if (expired.length === 0) {
    return;
  }

  db.run(sql`
    UPDATE deep_audits
    SET
      status = 'stale',
      completed_at = COALESCE(completed_at, ${Date.now()}),
      error_message = COALESCE(error_message, ${STALE_MESSAGE})
    WHERE parent_type = 'check'
      AND parent_key = ${parentKey}
      AND status = 'in_progress'
      AND started_at < ${cutoff}
  `);
  for (const audit of expired) {
    emitAuditStaleEvent({
      provider: "gemini-deep-research",
      auditId: audit.id,
      interactionId: audit.interaction_id,
      parentType: audit.parent_type,
      parentKey: audit.parent_key,
      requestedBy: audit.requested_by,
      ageMs: Date.now() - audit.started_at,
      reason: audit.error_message ?? STALE_MESSAGE,
    });
  }
}

function refreshPendingStaleness(audit: DeepAuditRow): DeepAuditRow {
  if (audit.status !== "pending") {
    return audit;
  }

  if (Date.now() - audit.started_at <= STALE_THRESHOLD_MS) {
    return audit;
  }

  const db = getDb();
  db.run(sql`
    UPDATE deep_audits
    SET
      status = 'stale',
      completed_at = ${Date.now()},
      error_message = COALESCE(error_message, ${STALE_MESSAGE})
    WHERE id = ${audit.id}
  `);

  const refreshed = getAuditById(audit.parent_key, audit.id) ?? audit;
  emitAuditStaleEvent({
    provider: "gemini-deep-research",
    auditId: refreshed.id,
    interactionId: refreshed.interaction_id,
    parentType: refreshed.parent_type,
    parentKey: refreshed.parent_key,
    requestedBy: refreshed.requested_by,
    ageMs: Date.now() - refreshed.started_at,
    reason: refreshed.error_message ?? STALE_MESSAGE,
  });
  return refreshed;
}

async function refreshAuditIfNeeded(
  audit: DeepAuditRow,
  options: { failHard: boolean },
): Promise<DeepAuditRow> {
  const staleCandidate = refreshPendingStaleness(audit);
  if (staleCandidate.status !== "in_progress") {
    return staleCandidate;
  }

  if (!staleCandidate.interaction_id) {
    return staleCandidate;
  }

  if (Date.now() - staleCandidate.started_at > STALE_THRESHOLD_MS) {
    const db = getDb();
    db.run(sql`
      UPDATE deep_audits
      SET
        status = 'stale',
        completed_at = ${Date.now()},
        error_message = COALESCE(error_message, ${STALE_MESSAGE})
      WHERE id = ${staleCandidate.id}
    `);
    const refreshed = getAuditById(staleCandidate.parent_key, staleCandidate.id) ?? staleCandidate;
    emitAuditStaleEvent({
      provider: "gemini-deep-research",
      auditId: refreshed.id,
      interactionId: refreshed.interaction_id,
      parentType: refreshed.parent_type,
      parentKey: refreshed.parent_key,
      requestedBy: refreshed.requested_by,
      ageMs: Date.now() - refreshed.started_at,
      reason: refreshed.error_message ?? STALE_MESSAGE,
    });
    return refreshed;
  }

  const config = readConfig();
  if (!config.geminiApiKey) {
    return staleCandidate;
  }

  try {
    emitAuditPollEvent({
      provider: "gemini-deep-research",
      auditId: staleCandidate.id,
      interactionId: staleCandidate.interaction_id,
      parentType: staleCandidate.parent_type,
      parentKey: staleCandidate.parent_key,
      requestedBy: staleCandidate.requested_by,
    });
    const response = await fetch(
      `${BASE}/interactions/${encodeURIComponent(
        staleCandidate.interaction_id,
      )}?key=${encodeURIComponent(config.geminiApiKey)}`,
    );

    if (response.status === 404) {
      updateAuditStatus(staleCandidate.id, "failed", {
        errorMessage: `Interaction ${staleCandidate.interaction_id} was not found`,
        completedAt: Date.now(),
      });
      const refreshed = getAuditById(staleCandidate.parent_key, staleCandidate.id) ?? staleCandidate;
      emitAuditFailedEvent({
        provider: "gemini-deep-research",
        auditId: refreshed.id,
        interactionId: staleCandidate.interaction_id,
        parentType: refreshed.parent_type,
        parentKey: refreshed.parent_key,
        requestedBy: refreshed.requested_by,
        reason: refreshed.error_message ?? `Interaction ${staleCandidate.interaction_id} was not found`,
        stage: "poll",
      });
      return refreshed;
    }

    if (!response.ok) {
      throw new Error(
        `Failed to fetch interaction ${staleCandidate.interaction_id}: ${response.status}`,
      );
    }

    const data = (await response.json()) as InteractionResponse;
    const status = normalizeInteractionStatus(data.status);
    if (status === "in_progress") {
      return staleCandidate;
    }

    if (status === "failed") {
      updateAuditStatus(staleCandidate.id, "failed", {
        errorMessage:
          data.error?.trim() ||
          `Interaction ${staleCandidate.interaction_id} failed`,
        resultJson: JSON.stringify(data),
        completedAt: Date.now(),
      });
      const refreshed = getAuditById(staleCandidate.parent_key, staleCandidate.id) ?? staleCandidate;
      emitAuditFailedEvent({
        provider: "gemini-deep-research",
        auditId: refreshed.id,
        interactionId: staleCandidate.interaction_id,
        parentType: refreshed.parent_type,
        parentKey: refreshed.parent_key,
        requestedBy: refreshed.requested_by,
        reason:
          refreshed.error_message ??
          data.error?.trim() ??
          `Interaction ${staleCandidate.interaction_id} failed`,
        stage: "poll",
      });
      return refreshed;
    }

    updateAuditStatus(staleCandidate.id, "completed", {
      resultText: extractText(data),
      resultJson: JSON.stringify(data),
      errorMessage: null,
      completedAt: Date.now(),
    });
    const refreshed = getAuditById(staleCandidate.parent_key, staleCandidate.id) ?? staleCandidate;
    emitAuditCompletedEvent({
      provider: "gemini-deep-research",
      auditId: refreshed.id,
      interactionId: staleCandidate.interaction_id,
      parentType: refreshed.parent_type,
      parentKey: refreshed.parent_key,
      requestedBy: refreshed.requested_by,
    });
    return refreshed;
  } catch (error) {
    if (options.failHard) {
      throw error;
    }
    return staleCandidate;
  }
}

function updateAuditStatus(
  auditId: number,
  status: DeepAuditStatus,
  updates: {
    resultText?: string | null;
    resultJson?: string | null;
    errorMessage?: string | null;
    completedAt?: number | null;
  },
) {
  const db = getDb();
  db.run(sql`
    UPDATE deep_audits
    SET
      status = ${status},
      result_text = ${updates.resultText ?? null},
      result_json = ${updates.resultJson ?? null},
      error_message = ${updates.errorMessage ?? null},
      completed_at = ${updates.completedAt ?? null}
    WHERE id = ${auditId}
  `);
}

function triggerBackgroundReconciliation(audit: DeepAuditRow) {
  const interactionId = audit.interaction_id;
  if (!interactionId || inFlightReconciliations.has(interactionId)) {
    return;
  }

  inFlightReconciliations.add(interactionId);
  void refreshAuditIfNeeded(audit, { failHard: false }).finally(() => {
    inFlightReconciliations.delete(interactionId);
  });
}

function serializeAudit(row: DeepAuditRow): DeepAuditRecord {
  return {
    id: row.id,
    parentType: row.parent_type,
    parentKey: row.parent_key,
    interactionId: row.interaction_id,
    status: row.status,
    requestedBy: row.requested_by,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultText: row.result_text,
    resultJson: row.result_json,
    errorMessage: row.error_message,
    costEstimateUsd: row.cost_estimate_usd,
  };
}

function buildDeepResearchPrompt(text: string) {
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

function normalizeInteractionStatus(
  status: string | undefined,
): "in_progress" | "completed" | "failed" {
  if (status === "completed" || status === "complete") return "completed";
  if (status === "failed") return "failed";
  return "in_progress";
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function requireDeepResearchAgent(apiKey: string): string {
  const capability = createGeminiCapability({ apiKey });
  const model = capability.getModel("deep-research");
  if (model !== capability.models.deepResearch) {
    throw new Error("Gemini Deep Research capability is currently unavailable");
  }
  return model;
}
