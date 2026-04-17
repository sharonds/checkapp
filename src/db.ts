import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import type { SkillResult } from "./skills/types.ts";

const DB_DIR = join(homedir(), ".checkapp");
const DB_PATH = join(DB_DIR, "history.db");

export interface CheckRecord {
  id?: number;
  source: string;
  wordCount: number;
  results: SkillResult[];
  totalCostUsd: number;
  createdAt?: string;
}

export function openDb(path = DB_PATH): Database {
  if (path !== ":memory:") {
    mkdirSync(DB_DIR, { recursive: true });
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
      created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `);
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
}

export function insertCheck(db: Database, record: Omit<CheckRecord, "id" | "createdAt">): number {
  const stmt = db.prepare(`
    INSERT INTO checks (source, word_count, results_json, total_cost)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    record.source,
    record.wordCount,
    JSON.stringify(record.results),
    record.totalCostUsd
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
  const row = db.query<{ id: number; source: string; word_count: number; results_json: string; total_cost: number; created_at: string }, [number]>(
    "SELECT * FROM checks WHERE id = ? LIMIT 1"
  ).get(id);
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    wordCount: row.word_count,
    results: JSON.parse(row.results_json) as SkillResult[],
    totalCostUsd: row.total_cost,
    createdAt: row.created_at,
  };
}

export function queryRecent(db: Database, limit: number): CheckRecord[] {
  const rows = db.query<{ id: number; source: string; word_count: number; results_json: string; total_cost: number; created_at: string }, []>(
    "SELECT * FROM checks ORDER BY id DESC LIMIT ?"
  ).all(limit);

  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    wordCount: row.word_count,
    results: JSON.parse(row.results_json) as SkillResult[],
    totalCostUsd: row.total_cost,
    createdAt: row.created_at,
  }));
}
