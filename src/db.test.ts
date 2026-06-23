import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync, existsSync, statSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  createSchema,
  insertCheck,
  queryRecent,
  openDb,
  insertContext,
  getContext,
  listContexts,
  updateContext,
  deleteContext,
  loadAllContexts,
  getCheckArticleText,
  getActiveAuditForParent,
  getAuditsForParent,
  claimDeepAuditStart,
  insertDeepAudit,
  getCheckById,
} from "./db.ts";
import type { AuditRecord } from "./audit/types.ts";
import { serializeAuditRecord } from "./audit/types.ts";

let db: Database;

const auditRecord: AuditRecord = {
  version: 1,
  auditId: "audit-db",
  language: "en",
  direction: "ltr",
  coverage: {
    wordsScanned: 5,
    sectionsDetected: 1,
    paragraphsScanned: 1,
    sentencesScanned: 1,
    claimsExtracted: 1,
    claimsChecked: 1,
    claimsSkipped: 0,
    skipReasons: {},
    plagiarismPassagesChecked: 0,
    plagiarismPassagesSkipped: 0,
    providerFailures: 0,
    providerRetries: 0,
  },
  segments: [],
  claims: [],
  claimDecisions: [],
  factAssessments: [],
  plagiarismFindings: [],
  providerAttempts: [{ id: "p1", provider: "fake", status: "success" }],
  createdAt: "2026-06-09T00:00:00.000Z",
};

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
});

afterEach(() => {
  db.close();
});

describe("openDb", () => {
  test("creates parent directory if missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "checkapp-db-test-"));
    const nested = join(tmp, "nested", "dir", "history.db");
    const db = openDb(nested);
    expect(existsSync(nested)).toBe(true);
    db.close();
    rmSync(tmp, { recursive: true, force: true });
  });

  test("creates owner-only database file when POSIX modes are supported", () => {
    const tmp = mkdtempSync(join(tmpdir(), "checkapp-db-mode-"));
    const path = join(tmp, "history.db");
    const opened = openDb(path);
    opened.close();
    expect(statSync(path).mode & 0o777).toBe(0o600);
    rmSync(tmp, { recursive: true, force: true });
  });

  test("enables WAL and a busy timeout for file-backed databases", () => {
    const tmp = mkdtempSync(join(tmpdir(), "checkapp-db-pragma-"));
    const path = join(tmp, "history.db");
    const opened = openDb(path);

    expect(opened.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode).toBe("wal");
    expect(opened.query<{ timeout: number }, []>("PRAGMA busy_timeout").get()?.timeout).toBeGreaterThanOrEqual(5000);

    opened.close();
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("insertCheck", () => {
  test("inserts a record and returns the id", () => {
    const id = insertCheck(db, {
      source: "./article.md",
      wordCount: 800,
      results: [{ skillId: "seo", name: "SEO", score: 80, verdict: "pass", summary: "ok", findings: [], costUsd: 0 }],
      totalCostUsd: 0.18,
    });
    expect(id).toBeGreaterThan(0);
  });

  test("persists article text for report-backed deep audits", () => {
    const id = insertCheck(db, {
      source: "./article.md",
      wordCount: 5,
      results: [],
      totalCostUsd: 0,
      articleText: "Stored article text",
    });

    expect(getCheckArticleText(db, id)).toBe("Stored article text");
    expect(queryRecent(db, 1)[0]?.articleText).toBeUndefined();
  });

  test("persists audit_json for detail reads but omits full audit from recent lists", () => {
    const id = insertCheck(db, {
      source: "./article.md",
      wordCount: 5,
      results: [],
      totalCostUsd: 0,
      articleText: "Stored article text",
      audit: auditRecord,
    });

    expect(getCheckById(db, id)?.audit?.auditId).toBe("audit-db");
    expect(getCheckById(db, id)?.audit?.providerAttempts).toHaveLength(1);
    expect(queryRecent(db, 1)[0]?.audit).toBeUndefined();
  });

  test("a valid grounded+plagiarism Hebrew audit survives serialize→store→read with language and segments intact", () => {
    const hebrewAudit: AuditRecord = {
      ...auditRecord,
      auditId: "audit-he",
      language: "he",
      direction: "rtl",
      segments: [
        { id: "seg-1", text: "פסקה ראשונה בעברית", paragraphIndex: 0 },
        { id: "seg-2", text: "פסקה שנייה בעברית", paragraphIndex: 1 },
      ],
      claims: [
        { id: "c1", quote: "טענה לא נתמכת", normalizedClaim: "unsupported claim", type: "general" },
      ],
      factAssessments: [
        {
          id: "a1",
          claimId: "c1",
          status: "unsupported",
          sources: [{ url: "https://example.com/source" }],
        },
      ],
      plagiarismFindings: [
        {
          id: "plag-1",
          quote: "טקסט מועתק",
          source: { url: "https://source.example/page" },
          status: "plagiarism_match",
        },
      ],
    };

    // Guard: the realistic audit must serialize without being dropped.
    const serialized = serializeAuditRecord(hebrewAudit);
    expect(serialized.ok).toBe(true);

    const id = insertCheck(db, {
      source: "./article-he.md",
      wordCount: 5,
      results: [],
      totalCostUsd: 0,
      audit: hebrewAudit,
    });

    const readBack = getCheckById(db, id)?.audit;
    expect(readBack?.language).toBe("he");
    expect(readBack?.direction).toBe("rtl");
    expect(readBack?.segments.length).toBeGreaterThan(0);
    expect(readBack?.factAssessments[0]?.status).toBe("unsupported");
    expect(readBack?.plagiarismFindings).toHaveLength(1);
  });
});

describe("createSchema", () => {
  test("creates the expected checks schema contract", () => {
    const columns = db
      .query<{
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }, []>("PRAGMA table_info(checks)")
      .all();
    const byName = new Map(columns.map((column) => [column.name, column]));

    expect(byName.get("id")?.pk).toBe(1);
    expect(byName.get("source")).toMatchObject({ type: "TEXT", notnull: 1 });
    expect(byName.get("word_count")).toMatchObject({ type: "INTEGER", notnull: 1, dflt_value: "0" });
    expect(byName.get("results_json")).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: "'[]'" });
    expect(byName.get("total_cost")).toMatchObject({ type: "REAL", notnull: 1, dflt_value: "0" });
    expect(byName.get("article_text")).toMatchObject({ type: "TEXT", notnull: 1, dflt_value: "''" });
    expect(byName.get("audit_json")).toMatchObject({ type: "TEXT", notnull: 0 });
    expect(byName.get("created_at")?.notnull).toBe(1);
    expect(byName.get("created_at")?.dflt_value).toContain("datetime('now')");
  });

  test("adds article_text to legacy checks tables", () => {
    const legacyDb = new Database(":memory:");
    legacyDb.run(`
      CREATE TABLE checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        word_count INTEGER NOT NULL DEFAULT 0,
        results_json TEXT NOT NULL DEFAULT '[]',
        total_cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    createSchema(legacyDb);

    const columns = legacyDb
      .query<{ name: string }, []>("PRAGMA table_info(checks)")
      .all()
      .map((column) => column.name);

    expect(columns).toContain("article_text");
    expect(columns).toContain("audit_json");
    legacyDb.close();
  });
});

describe("queryRecent", () => {
  test("returns most recent checks in descending order", () => {
    insertCheck(db, { source: "a.md", wordCount: 100, results: [], totalCostUsd: 0 });
    insertCheck(db, { source: "b.md", wordCount: 200, results: [], totalCostUsd: 0 });
    const rows = queryRecent(db, 10);
    expect(rows[0].source).toBe("b.md");
    expect(rows[1].source).toBe("a.md");
  });

  test("respects the limit parameter", () => {
    for (let i = 0; i < 5; i++) {
      insertCheck(db, { source: `${i}.md`, wordCount: 100, results: [], totalCostUsd: 0 });
    }
    expect(queryRecent(db, 3)).toHaveLength(3);
  });

  test("tolerates malformed legacy results_json in history lists", () => {
    db.run(`
      INSERT INTO checks (source, word_count, results_json, total_cost)
      VALUES ('bad-history.md', 10, '{not json', 0)
    `);

    const rows = queryRecent(db, 1);
    expect(rows[0].source).toBe("bad-history.md");
    expect(rows[0].results).toEqual([]);
  });
});

describe("contexts", () => {
  test("inserts and retrieves a context", () => {
    const db = openDb(":memory:");
    insertContext(db, { type: "tone-guide", name: "Brand Voice", content: "Write in second person" });
    const ctx = getContext(db, "tone-guide");
    expect(ctx).not.toBeNull();
    expect(ctx!.name).toBe("Brand Voice");
    expect(ctx!.content).toContain("second person");
  });

  test("lists all contexts", () => {
    const db = openDb(":memory:");
    insertContext(db, { type: "tone-guide", name: "Brand Voice", content: "..." });
    insertContext(db, { type: "brief", name: "Q2 Launch", content: "500 words" });
    expect(listContexts(db)).toHaveLength(2);
  });

  test("updates a context", () => {
    const db = openDb(":memory:");
    insertContext(db, { type: "tone-guide", name: "Brand Voice", content: "v1" });
    updateContext(db, "tone-guide", { content: "v2 updated" });
    expect(getContext(db, "tone-guide")!.content).toBe("v2 updated");
  });

  test("deletes a context", () => {
    const db = openDb(":memory:");
    insertContext(db, { type: "brief", name: "Q2", content: "..." });
    deleteContext(db, "brief");
    expect(getContext(db, "brief")).toBeNull();
  });

  test("returns null for missing type", () => {
    const db = openDb(":memory:");
    expect(getContext(db, "nonexistent")).toBeNull();
  });

  test("loadAllContexts returns a map", () => {
    const db = openDb(":memory:");
    insertContext(db, { type: "tone-guide", name: "TG", content: "be warm" });
    insertContext(db, { type: "brief", name: "BR", content: "500 words" });
    const map = loadAllContexts(db);
    expect(map["tone-guide"]).toBe("be warm");
    expect(map["brief"]).toBe("500 words");
  });
});

describe("deep_audits", () => {
  test("returns the active audit for a parent and ignores terminal audits", () => {
    const olderId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "hash-1",
      requestedBy: "mcp",
      startedAt: 100,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'failed', completed_at = ? WHERE id = ?",
      ["int-failed", 150, olderId],
    );
    const completedId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "hash-1",
      requestedBy: "cli",
      startedAt: 180,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'completed', completed_at = ? WHERE id = ?",
      ["int-completed", 190, completedId],
    );
    const activeId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "hash-1",
      requestedBy: "dashboard",
      startedAt: 200,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'in_progress' WHERE id = ?",
      ["int-active", activeId],
    );

    const active = getActiveAuditForParent(db, "content_hash", "hash-1");

    expect(active).not.toBeNull();
    expect(active?.interactionId).toBe("int-active");
    expect(active?.status).toBe("in_progress");
    expect(getAuditsForParent(db, "content_hash", "hash-1")).toHaveLength(3);
  });

  test("claimDeepAuditStart creates only one active audit for a parent", () => {
    const first = claimDeepAuditStart(db, {
      parentType: "content_hash",
      parentKey: "claim-hash",
      requestedBy: "mcp",
      startedAt: 100,
    });
    const second = claimDeepAuditStart(db, {
      parentType: "content_hash",
      parentKey: "claim-hash",
      requestedBy: "cli",
      startedAt: 200,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.record.id).toBe(first.record.id);
    expect(second.record.requestedBy).toBe("mcp");
    expect(getAuditsForParent(db, "content_hash", "claim-hash")).toHaveLength(1);
  });

  test("claimDeepAuditStart retires stale pending rows before creating a new active audit", () => {
    const stale = claimDeepAuditStart(db, {
      parentType: "content_hash",
      parentKey: "stale-hash",
      requestedBy: "mcp",
      startedAt: 100,
    });
    const fresh = claimDeepAuditStart(
      db,
      {
        parentType: "content_hash",
        parentKey: "stale-hash",
        requestedBy: "dashboard",
        startedAt: 10_000,
      },
      {
        staleBeforeMs: 1_000,
        completedAt: 10_000,
        staleMessage: "stale pending test",
      },
    );

    const audits = getAuditsForParent(db, "content_hash", "stale-hash");
    expect(stale.created).toBe(true);
    expect(fresh.created).toBe(true);
    expect(fresh.record.id).not.toBe(stale.record.id);
    expect(audits).toEqual([
      expect.objectContaining({ id: fresh.record.id, status: "pending", requestedBy: "dashboard" }),
      expect.objectContaining({ id: stale.record.id, status: "stale", errorMessage: "stale pending test" }),
    ]);
  });
});
