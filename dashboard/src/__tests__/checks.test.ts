import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: () => "test-csrf-token",
}));

import { POST } from "@/app/api/checks/route";
import { getDb, closeDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

beforeEach(() => {
  // Use memory DB for tests
  process.env.CHECKAPP_DB_PATH = ":memory:";
  // Create the checks table
  const db = getDb();
  db.run(sql`CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    results_json TEXT NOT NULL DEFAULT '[]',
    total_cost REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
  )`);
  db.run(sql`CREATE TABLE IF NOT EXISTS check_tags (
    check_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL
  )`);
});

afterEach(() => {
  closeDb();
  delete process.env.CHECKAPP_DB_PATH;
});

describe("POST /api/checks", () => {
  it("POST /api/checks returns the id of the specific check it just created", async () => {
    // Write a minimal config with SEO enabled
    const configDir = join(homedir(), ".checkapp");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        skills: { seo: true },
        plagiarism: false,
        aiDetection: false,
      })
    );

    const article =
      "Artificial intelligence is transforming industries around the world today. " +
      "Machine learning models solve previously intractable problems.";
    const req = new NextRequest("http://localhost/api/checks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ text: article, source: "test-fixture" }),
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(typeof body.id).toBe("number");
    expect(body.id).toBeGreaterThan(0);
  });

  it("two concurrent POSTs do NOT return the same id", async () => {
    // Write a minimal config with SEO enabled
    const configDir = join(homedir(), ".checkapp");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({
        skills: { seo: true },
        plagiarism: false,
        aiDetection: false,
      })
    );

    const makeReq = (text: string) =>
      new NextRequest("http://localhost/api/checks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-checkapp-csrf": "test-csrf-token",
        },
        body: JSON.stringify({ text, source: `test-${text}` }),
      });

    const [a, b] = await Promise.all([
      POST(makeReq("one")),
      POST(makeReq("two")),
    ]);
    const [ja, jb] = await Promise.all([a.json(), b.json()]);
    expect(ja.id).not.toBe(jb.id);
  });
});
