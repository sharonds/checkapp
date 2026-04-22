import { describe, it, expect, beforeEach, afterEach } from "vitest";
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
