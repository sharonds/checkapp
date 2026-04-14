import { Database } from "bun:sqlite";
import { homedir } from "os";
import { join } from "path";
import { mkdirSync } from "fs";
import type { SkillResult } from "./skills/types.ts";

const DB_DIR = join(homedir(), ".article-checker");
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
  mkdirSync(DB_DIR, { recursive: true });
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
