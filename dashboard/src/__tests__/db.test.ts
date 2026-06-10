import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, statSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  getRecentChecks,
  getAllChecks,
  getCheckById,
  getTotalStats,
  getAllTags,
  addTagsToCheck,
  getTagsForCheck,
  searchChecks,
  getContexts,
  getContextByType,
  upsertContext,
  deleteContextByType,
  getDb,
  closeDb,
  buildDashboardSummary,
} from "../lib/db";
import { sql } from "drizzle-orm";
import type { Check } from "../lib/db";

beforeEach(() => {
  process.env.ARTICLE_CHECKER_DB = ":memory:";
  // Create the checks table in memory (since CLI won't have created it)
  const db = getDb();
  db.run(sql`CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    results_json TEXT NOT NULL DEFAULT '[]',
    total_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
});

afterEach(() => {
  closeDb();
  delete process.env.ARTICLE_CHECKER_DB;
});

describe("getRecentChecks", () => {
  it("returns empty array for empty DB", () => {
    expect(getRecentChecks(5)).toEqual([]);
  });

  it("returns inserted checks in reverse order", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, results_json, total_cost) VALUES ('a.md', 100, '[]', 0.01)`
    );
    db.run(
      sql`INSERT INTO checks (source, word_count, results_json, total_cost) VALUES ('b.md', 200, '[]', 0.02)`
    );
    const checks = getRecentChecks(10);
    expect(checks).toHaveLength(2);
    expect(checks[0].source).toBe("b.md"); // most recent first
  });

  it("omits raw article text and audit JSON from list rows", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, results_json, audit_json, total_cost, article_text)
          VALUES ('audit-list.md', 100, '[]', '{"auditId":"secret-audit"}', 0.01, 'private article text')`
    );

    const checks = getRecentChecks(10) as Array<Record<string, unknown>>;

    expect(checks[0].source).toBe("audit-list.md");
    expect(checks[0].articleText).toBeUndefined();
    expect(checks[0].article_text).toBeUndefined();
    expect(checks[0].auditJson).toBeUndefined();
    expect(checks[0].audit_json).toBeUndefined();
    expect(JSON.stringify(checks)).not.toContain("private article text");
    expect(JSON.stringify(checks)).not.toContain("secret-audit");
  });
});

describe("dashboard DB file permissions", () => {
  it("creates owner-only database file when POSIX modes are supported", () => {
    closeDb();
    delete process.env.ARTICLE_CHECKER_DB;
    const tmp = mkdtempSync(join(tmpdir(), "checkapp-dashboard-db-mode-"));
    const dbPath = join(tmp, "history.db");
    process.env.CHECKAPP_DB_PATH = dbPath;
    try {
      getDb();
      closeDb();
      expect(statSync(dbPath).mode & 0o777).toBe(0o600);
    } finally {
      delete process.env.CHECKAPP_DB_PATH;
      process.env.ARTICLE_CHECKER_DB = ":memory:";
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("enables WAL and a busy timeout for file-backed dashboard databases", () => {
    closeDb();
    delete process.env.ARTICLE_CHECKER_DB;
    const tmp = mkdtempSync(join(tmpdir(), "checkapp-dashboard-db-pragma-"));
    const dbPath = join(tmp, "history.db");
    process.env.CHECKAPP_DB_PATH = dbPath;
    try {
      const db = getDb();
      const journal = db.all(sql`PRAGMA journal_mode`) as Array<{ journal_mode: string }>;
      const timeout = db.all(sql`PRAGMA busy_timeout`) as Array<{ timeout: number }>;

      expect(journal[0]?.journal_mode).toBe("wal");
      expect(timeout[0]?.timeout).toBeGreaterThanOrEqual(5000);
    } finally {
      closeDb();
      delete process.env.CHECKAPP_DB_PATH;
      process.env.ARTICLE_CHECKER_DB = ":memory:";
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("getAllChecks", () => {
  it("returns the full history, not just the recent slice", () => {
    const db = getDb();
    for (let i = 1; i <= 12; i++) {
      db.run(
        sql`INSERT INTO checks (source, word_count, results_json, total_cost) VALUES (${`row-${i}.md`}, 100, '[]', 0.01)`
      );
    }
    const checks = getAllChecks();
    expect(checks).toHaveLength(12);
    expect(checks[0].source).toBe("row-12.md");
    expect(checks[11].source).toBe("row-1.md");
  });

  it("omits raw article text and audit JSON from dashboard list rows", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, results_json, audit_json, total_cost, article_text)
          VALUES ('all-audit.md', 100, '[]', '{"auditId":"all-secret-audit"}', 0.01, 'private all article text')`
    );

    const checks = getAllChecks() as Array<Record<string, unknown>>;

    expect(checks[0].source).toBe("all-audit.md");
    expect(checks[0].articleText).toBeUndefined();
    expect(checks[0].article_text).toBeUndefined();
    expect(checks[0].auditJson).toBeUndefined();
    expect(checks[0].audit_json).toBeUndefined();
    expect(JSON.stringify(checks)).not.toContain("private all article text");
    expect(JSON.stringify(checks)).not.toContain("all-secret-audit");
  });
});

describe("checks schema contract", () => {
  it("creates the expected physical checks columns", () => {
    const columns = getDb().all(sql`PRAGMA table_info(checks)`) as Array<{
      name: string;
      type: string;
      notnull: number;
      dflt_value: string | null;
      pk: number;
    }>;
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
});

describe("getCheckById", () => {
  it("returns null for non-existent id", () => {
    expect(getCheckById(999)).toBeNull();
  });

  it("returns the correct check", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, results_json, total_cost) VALUES ('test.md', 100, '[]', 0.05)`
    );
    const check = getCheckById(1);
    expect(check).not.toBeNull();
    expect(check!.source).toBe("test.md");
  });
});

describe("getTotalStats", () => {
  it("returns zeros for empty DB", () => {
    const stats = getTotalStats();
    expect(stats.totalChecks).toBe(0);
    expect(stats.totalCost).toBe(0);
  });

  it("aggregates correctly", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('a.md', 100, 0.05)`
    );
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('b.md', 200, 0.10)`
    );
    const stats = getTotalStats();
    expect(stats.totalChecks).toBe(2);
    expect(stats.totalCost).toBeCloseTo(0.15);
  });
});

describe("buildDashboardSummary", () => {
  it("summarizes all checks, including rows outside the recent 10", () => {
    const now = new Date("2026-04-22T12:00:00.000Z");
    const checks: Check[] = [
      {
        id: 12,
        source: "check-12.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-22T10:00:00.000Z",
      },
      {
        id: 11,
        source: "check-11.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-21T10:00:00.000Z",
      },
      {
        id: 10,
        source: "check-10.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-20T10:00:00.000Z",
      },
      {
        id: 9,
        source: "check-9.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-19T10:00:00.000Z",
      },
      {
        id: 8,
        source: "check-8.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-17T10:00:00.000Z",
      },
      {
        id: 7,
        source: "check-7.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-16T10:00:00.000Z",
      },
      {
        id: 6,
        source: "check-6.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-15T10:00:00.000Z",
      },
      {
        id: 5,
        source: "check-5.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-14T10:00:00.000Z",
      },
      {
        id: 4,
        source: "check-4.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-13T10:00:00.000Z",
      },
      {
        id: 3,
        source: "check-3.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 100, verdict: "pass" }]),
        totalCost: 0.1,
        createdAt: "2026-04-12T10:00:00.000Z",
      },
      {
        id: 2,
        source: "check-2.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 0, verdict: "fail" }]),
        totalCost: 0.77,
        createdAt: "2026-04-18T10:00:00.000Z",
      },
      {
        id: 1,
        source: "check-1.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ verdict: "skipped" }]),
        totalCost: 1.23,
        createdAt: "2026-03-30T10:00:00.000Z",
      },
    ];

    const summary = buildDashboardSummary(checks, now);

    expect(summary.parsedChecks).toHaveLength(12);
    expect(summary.checksThisMonth).toBe(11);
    expect(summary.verdictCounts).toEqual({
      pass: 10,
      warn: 0,
      fail: 1,
      skipped: 1,
    });
    expect(summary.overallAvg).toBe(91);
    expect(summary.days.find((day) => day.shortDate === "Apr 18")?.cost).toBeCloseTo(0.77);
  });

  it("month + day buckets are UTC — not affected by host timezone", () => {
    // "now" is UTC midnight on the 1st. A host timezone east of UTC would
    // previously resolve monthStart to the 30th of the prior month and bucket
    // a check on Apr 1 UTC into the Apr 30 label. Verify both are UTC-pinned.
    const now = new Date("2026-05-01T00:00:00.000Z");
    const checks: Check[] = [
      {
        id: 1,
        source: "apr-30-utc.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 80, verdict: "pass" }]),
        totalCost: 0.5,
        createdAt: "2026-04-30T23:30:00.000Z",
      },
      {
        id: 2,
        source: "may-01-utc.md",
        wordCount: 100,
        resultsJson: JSON.stringify([{ score: 80, verdict: "pass" }]),
        totalCost: 0.25,
        createdAt: "2026-05-01T00:30:00.000Z",
      },
    ];

    const summary = buildDashboardSummary(checks, now);
    expect(summary.checksThisMonth).toBe(1);
    expect(summary.days.find((d) => d.shortDate === "May 1")?.cost).toBeCloseTo(0.25);
    expect(summary.days.find((d) => d.shortDate === "Apr 30")?.cost).toBeCloseTo(0.5);
  });
});

describe("tags", () => {
  it("adds and retrieves tags", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('test.md', 100, 0)`
    );
    addTagsToCheck(1, ["blog", "seo", "q2"]);
    const t = getTagsForCheck(1);
    expect(t).toEqual(["blog", "q2", "seo"]); // sorted
  });

  it("getAllTags returns tags with counts", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('a.md', 100, 0)`
    );
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('b.md', 200, 0)`
    );
    addTagsToCheck(1, ["blog"]);
    addTagsToCheck(2, ["blog", "seo"]);
    const all = getAllTags();
    expect(all.find((t) => t.name === "blog")?.count).toBe(2);
    expect(all.find((t) => t.name === "seo")?.count).toBe(1);
  });
});

describe("searchChecks", () => {
  it("finds checks by source keyword", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('vitamin-d-article.md', 500, 0)`
    );
    db.run(
      sql`INSERT INTO checks (source, word_count, total_cost) VALUES ('react-hooks-guide.md', 300, 0)`
    );
    const results = searchChecks("vitamin");
    expect(results).toHaveLength(1);
    expect(results[0].source).toContain("vitamin");
  });

  it("omits raw audit_json from search results", () => {
    const db = getDb();
    db.run(
      sql`INSERT INTO checks (source, word_count, results_json, audit_json, total_cost) VALUES ('audit-article.md', 500, '[]', '{"auditId":"audit-secret"}', 0)`
    );

    const results = searchChecks("audit");

    expect(results).toHaveLength(1);
    expect(results[0].source).toBe("audit-article.md");
    expect(results[0].auditJson).toBeUndefined();
  });

  it("returns empty for no matches", () => {
    const results = searchChecks("nonexistent");
    expect(results).toEqual([]);
  });
});

describe("contexts (Drizzle)", () => {
  it("upserts and retrieves a context", () => {
    upsertContext("tone-guide", "Brand Voice", "Be warm");
    const ctx = getContextByType("tone-guide");
    expect(ctx).not.toBeNull();
    expect(ctx!.name).toBe("Brand Voice");
    expect(ctx!.content).toBe("Be warm");
  });

  it("updates existing context on upsert", () => {
    upsertContext("tone-guide", "TG", "first");
    upsertContext("tone-guide", "TG Updated", "second");
    const ctx = getContextByType("tone-guide");
    expect(ctx!.name).toBe("TG Updated");
    expect(ctx!.content).toBe("second");
  });

  it("lists all contexts", () => {
    upsertContext("tone-guide", "TG", "...");
    upsertContext("brief", "BR", "...");
    const all = getContexts();
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it("returns null for non-existent type", () => {
    const ctx = getContextByType("nonexistent");
    expect(ctx).toBeNull();
  });

  it("deletes a context by type", () => {
    upsertContext("tone-guide", "TG", "content");
    deleteContextByType("tone-guide");
    const ctx = getContextByType("tone-guide");
    expect(ctx).toBeNull();
  });
});
