import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { desc, eq, sql } from "drizzle-orm";
import { homedir } from "os";
import { dirname, join } from "path";
import { existsSync, renameSync, mkdirSync } from "fs";

const CONFIG_DIR = join(homedir(), ".checkapp");
const LEGACY_DIRS = [
  join(homedir(), ".checkit"),
  join(homedir(), ".article-checker"),
];
const DB_PATH = join(CONFIG_DIR, "history.db");

let _legacyMigrationRan = false;

// One-time migration: move legacy config dirs to new location.
// Deferred until getDb() is first called so that Next.js build-time
// module evaluation does not touch the filesystem on fresh CI runners.
function runLegacyMigrationOnce() {
  if (_legacyMigrationRan) return;
  _legacyMigrationRan = true;
  if (existsSync(CONFIG_DIR)) return;
  for (const legacy of LEGACY_DIRS) {
    if (existsSync(legacy)) {
      try {
        renameSync(legacy, CONFIG_DIR);
        console.error(`Migrated config from ${legacy} to ${CONFIG_DIR}`);
        break;
      } catch (err) {
        console.error(`Failed to migrate ${legacy} to ${CONFIG_DIR}: ${(err as Error).message}`);
      }
    }
  }
}

// Schema matching CLI's bun:sqlite schema
export const checks = sqliteTable("checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  source: text("source").notNull(),
  wordCount: integer("word_count").notNull().default(0),
  resultsJson: text("results_json").notNull().default("[]"),
  totalCost: real("total_cost").notNull().default(0),
  createdAt: text("created_at").notNull(),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
});

export const checkTags = sqliteTable("check_tags", {
  checkId: integer("check_id").notNull(),
  tagId: integer("tag_id").notNull(),
});

export const contexts = sqliteTable("contexts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull().unique(),
  name: text("name").notNull(),
  content: text("content").notNull().default(""),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export type Check = typeof checks.$inferSelect;
export type Context = typeof contexts.$inferSelect;

// Singleton connection
let _db: ReturnType<typeof drizzle> | null = null;
let _sqlite: InstanceType<typeof Database> | null = null;

export function getDb() {
  if (!_db) {
    runLegacyMigrationOnce();
    // Accept new, CI/testing, and legacy env var names. First set wins.
    const dbPath =
      process.env.CHECKAPP_DB_PATH ??
      process.env.CHECKAPP_DB ??
      process.env.ARTICLE_CHECKER_DB ??
      DB_PATH;
    // Ensure the parent directory exists for any on-disk path (skip :memory:).
    if (dbPath !== ":memory:") {
      const dir = dirname(dbPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
    _sqlite = new Database(dbPath);
    // Create tags tables if they don't exist (the CLI may not have created them)
    _sqlite.pragma("journal_mode = WAL");
    _sqlite.prepare(
      `CREATE TABLE IF NOT EXISTS tags (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)`
    ).run();
    _sqlite.prepare(
      `CREATE TABLE IF NOT EXISTS check_tags (check_id INTEGER NOT NULL, tag_id INTEGER NOT NULL, PRIMARY KEY (check_id, tag_id))`
    ).run();
    _sqlite.prepare(
      `CREATE TABLE IF NOT EXISTS contexts (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL UNIQUE, name TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
    ).run();
    _db = drizzle(_sqlite);
  }
  return _db;
}

export function closeDb() {
  _sqlite?.close();
  _db = null;
  _sqlite = null;
}

export function getRecentChecks(limit: number) {
  const db = getDb();
  return db.select().from(checks).orderBy(desc(checks.id)).limit(limit).all();
}

export function getAllChecks() {
  const db = getDb();
  return db.select().from(checks).orderBy(desc(checks.id)).all();
}

export function getCheckById(id: number) {
  const db = getDb();
  const rows = db
    .select()
    .from(checks)
    .where(eq(checks.id, id))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export function getTotalStats() {
  const db = getDb();
  const result = db.all(
    sql`SELECT COUNT(*) as total_checks, COALESCE(SUM(total_cost), 0) as total_cost FROM checks`
  );
  const row = result[0] as
    | { total_checks: number; total_cost: number }
    | undefined;
  return {
    totalChecks: row?.total_checks ?? 0,
    totalCost: row?.total_cost ?? 0,
  };
}

interface StoredSkillResult {
  score?: number;
  verdict?: "pass" | "warn" | "fail" | "skipped";
}

export interface DashboardParsedCheck {
  id: number;
  source: string;
  wordCount: number;
  totalCost: number;
  createdAt: string;
  avgScore: number;
  verdict: "pass" | "warn" | "fail" | "skipped";
}

export interface DashboardSummary {
  parsedChecks: DashboardParsedCheck[];
  overallAvg: number;
  verdictCounts: {
    pass: number;
    warn: number;
    fail: number;
    skipped: number;
  };
  checksThisMonth: number;
  days: Array<{ label: string; shortDate: string; cost: number }>;
  maxCost: number;
}

// UTC-pinned so bucket labels match the UTC createdAt timestamps SQLite writes
// via datetime('now'). Without timeZone:"UTC" the label drifts relative to the
// bucket near midnight in non-UTC timezones.
function getDayLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getVerdict(score: number): "pass" | "warn" | "fail" {
  if (score >= 75) return "pass";
  if (score >= 50) return "warn";
  return "fail";
}

export function buildDashboardSummary(checks: Check[], now = new Date()): DashboardSummary {
  const parsedChecks = checks.map((c) => {
    let results: StoredSkillResult[] = [];
    try {
      const raw = JSON.parse(c.resultsJson);
      results = Array.isArray(raw) ? raw : [];
    } catch {
      results = [];
    }

    const scored = results.filter((r) => r.verdict !== "skipped");
    const scores = scored
      .map((r) => r.score)
      .filter((s): s is number => typeof s === "number");
    const allSkipped = results.length > 0 && scored.length === 0;
    const avgScore =
      scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : 0;
    const verdict: "pass" | "warn" | "fail" | "skipped" = allSkipped
      ? "skipped"
      : getVerdict(avgScore);

    return {
      id: c.id,
      source: c.source,
      wordCount: c.wordCount,
      totalCost: c.totalCost,
      createdAt: c.createdAt,
      avgScore,
      verdict,
    };
  });

  const scoredChecks = parsedChecks.filter((p) => p.verdict !== "skipped");
  const scoredAverage = scoredChecks.map((p) => p.avgScore);
  const overallAvg =
    scoredAverage.length > 0
      ? Math.round(scoredAverage.reduce((a, b) => a + b, 0) / scoredAverage.length)
      : 0;

  const verdictCounts = { pass: 0, warn: 0, fail: 0, skipped: 0 };
  for (const p of parsedChecks) {
    verdictCounts[p.verdict]++;
  }

  // UTC-pinned month start so the comparison is UTC vs UTC (createdAt is
  // produced by SQLite datetime('now') which is UTC). Local-time constructors
  // drift by ±1 day for users east of UTC near month boundaries.
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10);
  const checksThisMonth = checks.filter((c) => c.createdAt >= monthStart).length;

  const days: Array<{ label: string; shortDate: string; cost: number }> = [];
  // Walk backwards from today in UTC so day-keys line up with createdAt's UTC
  // timestamps. setUTCDate keeps arithmetic in UTC instead of local time.
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i);
    const dateStr = d.toISOString().slice(0, 10);
    const cost = checks.reduce(
      (sum, c) => (c.createdAt.startsWith(dateStr) ? sum + c.totalCost : sum),
      0
    );
    days.push({
      label: getDayLabel(d),
      shortDate: formatDateShort(d),
      cost,
    });
  }
  const maxCost = Math.max(...days.map((d) => d.cost), 0.001);

  return {
    parsedChecks,
    overallAvg,
    verdictCounts,
    checksThisMonth,
    days,
    maxCost,
  };
}

export function addTagsToCheck(checkId: number, tagNames: string[]) {
  const db = getDb();
  for (const name of tagNames) {
    db.run(sql`INSERT OR IGNORE INTO tags (name) VALUES (${name})`);
    const tag = db
      .select()
      .from(tags)
      .where(eq(tags.name, name))
      .limit(1)
      .all()[0];
    if (tag) {
      db.run(
        sql`INSERT OR IGNORE INTO check_tags (check_id, tag_id) VALUES (${checkId}, ${tag.id})`
      );
    }
  }
}

export function getTagsForCheck(checkId: number): string[] {
  const db = getDb();
  const rows = db.all(
    sql`SELECT t.name FROM tags t JOIN check_tags ct ON t.id = ct.tag_id WHERE ct.check_id = ${checkId} ORDER BY t.name`
  );
  return (rows as Array<{ name: string }>).map((r) => r.name);
}

export function getAllTags(): Array<{ name: string; count: number }> {
  const db = getDb();
  return db.all(
    sql`SELECT t.name, COUNT(ct.check_id) as count FROM tags t JOIN check_tags ct ON t.id = ct.tag_id GROUP BY t.id ORDER BY count DESC`
  ) as Array<{ name: string; count: number }>;
}

export function searchChecks(query: string, tag?: string) {
  const db = getDb();
  if (tag) {
    return db.all(
      sql`SELECT c.* FROM checks c JOIN check_tags ct ON c.id = ct.check_id JOIN tags t ON ct.tag_id = t.id WHERE t.name = ${tag} AND c.source LIKE ${"%" + query + "%"} ORDER BY c.id DESC LIMIT 50`
    ) as Check[];
  }
  return db.all(
    sql`SELECT * FROM checks WHERE source LIKE ${"%" + query + "%"} ORDER BY id DESC LIMIT 50`
  ) as Check[];
}

// --- Context queries ---

export function getContexts(): Context[] {
  const db = getDb();
  return db.select().from(contexts).all();
}

export function getContextByType(type: string): Context | null {
  const db = getDb();
  const rows = db
    .select()
    .from(contexts)
    .where(eq(contexts.type, type))
    .limit(1)
    .all();
  return rows[0] ?? null;
}

export function upsertContext(type: string, name: string, content: string) {
  const db = getDb();
  const now = new Date().toISOString();
  db.run(
    sql`INSERT INTO contexts (type, name, content, created_at, updated_at) VALUES (${type}, ${name}, ${content}, ${now}, ${now}) ON CONFLICT(type) DO UPDATE SET name = ${name}, content = ${content}, updated_at = ${now}`
  );
}

export function deleteContextByType(type: string) {
  const db = getDb();
  db.run(sql`DELETE FROM contexts WHERE type = ${type}`);
}
