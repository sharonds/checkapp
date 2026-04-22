import { jsonWithCors } from "@/lib/cors";
import { addTagsToCheck, getRecentChecks } from "@/lib/db";
import { runCheckCore, loadContextsIntoConfig } from "@/lib/run-check";
import { readAppConfig } from "@/lib/config";
import { guardLocalMutation } from "@/lib/guard-local";
import { emitTierSelectedEvent } from "../../../../../src/telemetry/audit-events";
import { NextRequest } from "next/server";
import Database from "better-sqlite3";
import { homedir } from "os";
import { join } from "path";

const MAX_TEXT_LENGTH = 50_000;
const CONFIG_DIR = join(homedir(), ".checkapp");
// CHECKAPP_DB_PATH lets tests and E2E harnesses redirect the default DB.
const DB_PATH = process.env.CHECKAPP_DB_PATH ?? join(CONFIG_DIR, "history.db");

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const checks = getRecentChecks(limit);
    const parsed = checks.map((c) => ({
      id: c.id,
      source: c.source,
      wordCount: c.wordCount,
      totalCost: c.totalCost,
      createdAt: c.createdAt,
      results: JSON.parse(c.resultsJson),
    }));
    return jsonWithCors(parsed);
  } catch (err) {
    return jsonWithCors({ error: "Failed to fetch checks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  let sqlite: Database.Database | null = null;
  try {
    const body = await req.json();
    const { text, source, tags } = body as { text?: string; source?: string; tags?: string[] };
    if (!text) return jsonWithCors({ error: "text is required" }, { status: 400 });
    if (text.length > MAX_TEXT_LENGTH) return jsonWithCors({ error: `text exceeds ${MAX_TEXT_LENGTH} characters` }, { status: 400 });

    const sourceLabel = source ?? "dashboard-check";
    const wordCount = text.trim().split(/\s+/).length;

    // Read config from ~/.checkapp/config.json
    const configRaw = readAppConfig() as any;
    const config = loadContextsIntoConfig(configRaw);

    // Save to dashboard DB using better-sqlite3
    sqlite = new Database(DB_PATH);
    sqlite.pragma("journal_mode = WAL");

    ensureChecksTable(sqlite);

    const { results, totalCostUsd } = await runCheckCore(text, config, {
      onFactCheckTierSelected(selection) {
        emitTierSelectedEvent({
          source: "dashboard",
          requestedTier: selection.requestedTier ?? null,
          effectiveTier: selection.effectiveTier,
          flagOn: selection.flagOn,
          selectedImplementation: selection.selectedImplementation,
          selectedSkillId: selection.selectedSkillId,
        });
      },
    });

    const stmt = sqlite.prepare(`
      INSERT INTO checks (source, word_count, results_json, total_cost, article_text)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(sourceLabel, wordCount, JSON.stringify(results), totalCostUsd, text);
    const id = info.lastInsertRowid as number;

    // Apply tags
    if (tags?.length && id > 0) {
      addTagsToCheck(id, tags);
    }

    return jsonWithCors({ id }, { status: 201 });
  } catch (err) {
    return jsonWithCors({ error: err instanceof Error ? err.message : "Check failed" }, { status: 500 });
  } finally {
    sqlite?.close();
  }
}

function ensureChecksTable(sqlite: Database.Database) {
  sqlite.prepare(`
    CREATE TABLE IF NOT EXISTS checks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      results_json TEXT NOT NULL DEFAULT '[]',
      total_cost REAL NOT NULL DEFAULT 0,
      article_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `).run();

  const columns = sqlite.prepare("PRAGMA table_info(checks)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "article_text")) {
    sqlite.prepare("ALTER TABLE checks ADD COLUMN article_text TEXT NOT NULL DEFAULT ''").run();
  }
}
