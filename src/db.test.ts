import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { createSchema, insertCheck, queryRecent, openDb, insertContext, getContext, listContexts, updateContext, deleteContext, loadAllContexts, type CheckRecord } from "./db.ts";

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
