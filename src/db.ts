import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join, dirname } from "path";
import { mkdirSync } from "fs";
import type { SkillResult } from "./skills/types.ts";

const DB_DIR = join(homedir(), ".checkapp");
// CHECKAPP_DB_PATH lets tests and E2E harnesses redirect the default DB to a
// temp file. Callers that pass an explicit path still override this.
const DB_PATH = process.env.CHECKAPP_DB_PATH ?? join(DB_DIR, "history.db");

export type DB = Database;

export interface CheckRecord {
  id?: number;
  source: string;
  wordCount: number;
  results: SkillResult[];
  totalCostUsd: number;
  articleText?: string;
  createdAt?: string;
}

export type DeepAuditParentType = "check" | "content_hash";
export type DeepAuditStatus = "pending" | "in_progress" | "completed" | "failed" | "stale";
export type DeepAuditRequestedBy = "dashboard" | "mcp" | "cli";

export interface DeepAuditRecord {
  id: number;
  parentType: DeepAuditParentType;
  parentKey: string;
  interactionId: string | null;
  status: DeepAuditStatus;
  requestedBy: DeepAuditRequestedBy;
  startedAt: number;
  completedAt: number | null;
  resultText: string | null;
  resultJson: string | null;
  errorMessage: string | null;
  costEstimateUsd: number;
}

export interface InsertDeepAuditInput {
  parentType: DeepAuditParentType;
  parentKey: string;
  requestedBy: DeepAuditRequestedBy;
  startedAt: number;
  costEstimateUsd?: number;
}

export function openDb(path = DB_PATH): DB {
  if (path !== ":memory:") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  createSchema(db);
  return db;
}

export function createSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS checks (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      source      TEXT    NOT NULL,
      word_count  INTEGER NOT NULL DEFAULT 0,
      results_json TEXT   NOT NULL DEFAULT '[]',
      total_cost  REAL    NOT NULL DEFAULT 0,
      article_text TEXT   NOT NULL DEFAULT '',
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
  ensureChecksArticleTextColumn(db);
  db.run(`
    CREATE TABLE IF NOT EXISTS contexts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      type       TEXT NOT NULL UNIQUE,
      name       TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);
  db.run(`
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
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_deep_audits_parent
    ON deep_audits (parent_type, parent_key)
  `);
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_deep_audits_status_started
    ON deep_audits (status, started_at)
  `);
}

export function insertCheck(
  db: Database,
  record: Omit<CheckRecord, "id" | "createdAt"> & { articleText?: string },
): number {
  const stmt = db.prepare(`
    INSERT INTO checks (source, word_count, results_json, total_cost, article_text)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    record.source,
    record.wordCount,
    JSON.stringify(record.results),
    record.totalCostUsd,
    record.articleText ?? "",
  );
  return result.lastInsertRowid as number;
}

export interface ContextRecord {
  id?: number;
  type: string;
  name: string;
  content: string;
  createdAt?: string;
  updatedAt?: string;
}

export function insertContext(db: Database, ctx: Omit<ContextRecord, "id" | "createdAt" | "updatedAt">): number {
  const stmt = db.prepare("INSERT INTO contexts (type, name, content) VALUES (?, ?, ?)");
  return stmt.run(ctx.type, ctx.name, ctx.content).lastInsertRowid as number;
}

export function getContext(db: Database, type: string): ContextRecord | null {
  const row = db.query<{id: number; type: string; name: string; content: string; created_at: string; updated_at: string}, [string]>(
    "SELECT * FROM contexts WHERE type = ? LIMIT 1"
  ).get(type);
  if (!row) return null;
  return { id: row.id, type: row.type, name: row.name, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listContexts(db: Database): ContextRecord[] {
  const rows = db.query<{id: number; type: string; name: string; content: string; created_at: string; updated_at: string}, []>(
    "SELECT * FROM contexts ORDER BY type"
  ).all();
  return rows.map(row => ({ id: row.id, type: row.type, name: row.name, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function updateContext(db: Database, type: string, updates: Partial<Pick<ContextRecord, "name" | "content">>): void {
  const sets: string[] = [];
  const vals: string[] = [];
  if (updates.name !== undefined) { sets.push("name = ?"); vals.push(updates.name); }
  if (updates.content !== undefined) { sets.push("content = ?"); vals.push(updates.content); }
  sets.push("updated_at = datetime('now')");
  vals.push(type);
  db.run(`UPDATE contexts SET ${sets.join(", ")} WHERE type = ?`, vals);
}

export function deleteContext(db: Database, type: string): void {
  db.run("DELETE FROM contexts WHERE type = ?", [type]);
}

export function loadAllContexts(db: Database): Record<string, string> {
  const rows = listContexts(db);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.type] = r.content;
  return map;
}

export function getCheckById(db: Database, id: number): CheckRecord | null {
  const row = db.query<{
    id: number;
    source: string;
    word_count: number;
    results_json: string;
    total_cost: number;
    article_text: string;
    created_at: string;
  }, [number]>(
    "SELECT * FROM checks WHERE id = ? LIMIT 1"
  ).get(id);
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    wordCount: row.word_count,
    results: JSON.parse(row.results_json) as SkillResult[],
    totalCostUsd: row.total_cost,
    articleText: row.article_text,
    createdAt: row.created_at,
  };
}

export function queryRecent(db: Database, limit: number): CheckRecord[] {
  const rows = db.query<{
    id: number;
    source: string;
    word_count: number;
    results_json: string;
    total_cost: number;
    article_text: string;
    created_at: string;
  }, []>(
    "SELECT * FROM checks ORDER BY id DESC LIMIT ?"
  ).all(limit);

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    wordCount: row.word_count,
    results: JSON.parse(row.results_json) as SkillResult[],
    totalCostUsd: row.total_cost,
    articleText: row.article_text,
    createdAt: row.created_at,
  }));
}

export function insertDeepAudit(db: Database, row: InsertDeepAuditInput): number {
  const stmt = db.prepare(`
    INSERT INTO deep_audits (
      parent_type,
      parent_key,
      status,
      requested_by,
      started_at,
      cost_estimate_usd
    )
    VALUES (?, ?, 'pending', ?, ?, ?)
  `);
  const result = stmt.run(
    row.parentType,
    row.parentKey,
    row.requestedBy,
    row.startedAt,
    row.costEstimateUsd ?? 1.5,
  );
  return result.lastInsertRowid as number;
}

export function getDeepAudit(db: Database, interactionId: string): DeepAuditRecord | null {
  const row = db.query<DeepAuditRow, [string]>(
    "SELECT * FROM deep_audits WHERE interaction_id = ? LIMIT 1"
  ).get(interactionId);
  return row ? mapDeepAuditRow(row) : null;
}

export function getActiveAuditForParent(
  db: Database,
  parentType: DeepAuditParentType,
  parentKey: string,
): DeepAuditRecord | null {
  const row = db.query<DeepAuditRow, [DeepAuditParentType, string]>(`
    SELECT *
    FROM deep_audits
    WHERE parent_type = ?
      AND parent_key = ?
      AND status IN ('pending', 'in_progress')
    ORDER BY started_at DESC, id DESC
    LIMIT 1
  `).get(parentType, parentKey);
  return row ? mapDeepAuditRow(row) : null;
}

export function getAuditsForParent(
  db: Database,
  parentType: DeepAuditParentType,
  parentKey: string,
): DeepAuditRecord[] {
  const rows = db.query<DeepAuditRow, [DeepAuditParentType, string]>(`
    SELECT *
    FROM deep_audits
    WHERE parent_type = ?
      AND parent_key = ?
    ORDER BY started_at DESC, id DESC
  `).all(parentType, parentKey);
  return rows.map(mapDeepAuditRow);
}

export function updateAuditStatus(
  db: Database,
  interactionId: string,
  status: DeepAuditStatus,
  updates: {
    resultText?: string | null;
    resultJson?: string | null;
    errorMessage?: string | null;
    completedAt?: number | null;
  } = {},
): void {
  const sets = ["status = ?"];
  const values: Array<string | number | null> = [status];

  if (updates.resultText !== undefined) {
    sets.push("result_text = ?");
    values.push(updates.resultText);
  }
  if (updates.resultJson !== undefined) {
    sets.push("result_json = ?");
    values.push(updates.resultJson);
  }
  if (updates.errorMessage !== undefined) {
    sets.push("error_message = ?");
    values.push(updates.errorMessage);
  }
  if (updates.completedAt !== undefined) {
    sets.push("completed_at = ?");
    values.push(updates.completedAt);
  } else if (status === "completed" || status === "failed" || status === "stale") {
    sets.push("completed_at = ?");
    values.push(Date.now());
  }

  values.push(interactionId);
  db.run(`UPDATE deep_audits SET ${sets.join(", ")} WHERE interaction_id = ?`, values);
}

export function listStaleAudits(db: Database, olderThanMs: number): DeepAuditRecord[] {
  const rows = db.query<DeepAuditRow, [number]>(`
    SELECT *
    FROM deep_audits
    WHERE status = 'in_progress'
      AND started_at < ?
    ORDER BY started_at ASC, id ASC
  `).all(olderThanMs);
  return rows.map(mapDeepAuditRow);
}

export function getCheckArticleText(db: Database, checkId: number): string | null {
  const row = db.query<{ article_text: string }, [number]>(
    "SELECT article_text FROM checks WHERE id = ? LIMIT 1"
  ).get(checkId);
  return row ? row.article_text : null;
}

interface DeepAuditRow {
  id: number;
  parent_type: DeepAuditParentType;
  parent_key: string;
  interaction_id: string | null;
  status: DeepAuditStatus;
  requested_by: DeepAuditRequestedBy;
  started_at: number;
  completed_at: number | null;
  result_text: string | null;
  result_json: string | null;
  error_message: string | null;
  cost_estimate_usd: number;
}

function ensureChecksArticleTextColumn(db: Database): void {
  const columns = db.query<{ name: string }, []>("PRAGMA table_info(checks)").all();
  const hasArticleText = columns.some((column) => column.name === "article_text");
  if (!hasArticleText) {
    db.run("ALTER TABLE checks ADD COLUMN article_text TEXT NOT NULL DEFAULT ''");
  }
}

function mapDeepAuditRow(row: DeepAuditRow): DeepAuditRecord {
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
