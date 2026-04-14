import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, insertCheck, queryRecent, type CheckRecord } from "./db.ts";

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
});

afterEach(() => {
  db.close();
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
});
