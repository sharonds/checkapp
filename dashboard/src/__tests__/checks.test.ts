import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

const runCheckCoreMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: () => "test-csrf-token",
}));

vi.mock("@/lib/run-check", () => ({
  loadContextsIntoConfig: (config: unknown) => config,
  runCheckCore: runCheckCoreMock,
}));

import { GET as GET_CHECKS, POST } from "@/app/api/checks/route";
import { GET as GET_CHECK } from "@/app/api/checks/[id]/route";
import { GET as GET_SEARCH } from "@/app/api/search/route";
import { getDb, closeDb } from "@/lib/db";
import { sql } from "drizzle-orm";
import { writeFileSync, mkdirSync } from "fs";
import { homedir, tmpdir } from "os";
import { join } from "path";

beforeEach(() => {
  // Use memory DB for tests
  process.env.CHECKAPP_DB_PATH = ":memory:";
  runCheckCoreMock.mockResolvedValue({
    results: [{ skillId: "seo", name: "SEO", score: 100, verdict: "pass", summary: "ok", findings: [], costUsd: 0 }],
    totalCostUsd: 0,
    audit: undefined,
  });
  // Create the checks table
  const db = getDb();
  db.run(sql`CREATE TABLE IF NOT EXISTS checks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    word_count INTEGER NOT NULL DEFAULT 0,
    results_json TEXT NOT NULL DEFAULT '[]',
    audit_json TEXT,
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

describe("GET /api/checks/:id", () => {
  it("returns parsed audit without raw auditJson", async () => {
    const db = getDb();
    db.run(sql`INSERT INTO checks (
      source,
      word_count,
      results_json,
      audit_json,
      total_cost
    ) VALUES (
      'audit-detail.md',
      10,
      '[]',
      '{"version":1,"auditId":"audit-detail","language":"en","direction":"ltr","coverage":{"wordsScanned":10,"sectionsDetected":1,"paragraphsScanned":1,"sentencesScanned":1,"claimsExtracted":0,"claimsChecked":0,"claimsSkipped":0,"skipReasons":{},"plagiarismPassagesChecked":0,"plagiarismPassagesSkipped":0,"providerFailures":0,"providerRetries":0},"segments":[],"claims":[],"claimDecisions":[],"factAssessments":[],"plagiarismFindings":[],"providerAttempts":[],"createdAt":"2026-06-09T00:00:00.000Z"}',
      0
    )`);

    const res = await GET_CHECK(new NextRequest("http://localhost/api/checks/1"), { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(body.audit.auditId).toBe("audit-detail");
    expect(body.auditJson).toBeUndefined();
    expect(body.resultsJson).toBeUndefined();
  });

  it("tolerates malformed legacy results_json", async () => {
    const db = getDb();
    db.run(sql`INSERT INTO checks (
      source,
      word_count,
      results_json,
      audit_json,
      total_cost
    ) VALUES (
      'legacy-bad-results.md',
      10,
      '{bad json',
      null,
      0
    )`);

    const res = await GET_CHECK(new NextRequest("http://localhost/api/checks/1"), { params: Promise.resolve({ id: "1" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.results).toEqual([]);
  });
});

describe("GET /api/checks", () => {
  it("returns public summaries without full result findings", async () => {
    const db = getDb();
    db.run(sql`INSERT INTO checks (
      source,
      word_count,
      results_json,
      audit_json,
      total_cost
    ) VALUES (
      'https://user:secret@example.com/list-audit.md?token=abc&utm_source=x',
      12,
      ${JSON.stringify([{ skillId: "fact", score: 50, verdict: "fail", findings: [{ quote: "private list quote", sources: [{ url: "https://example.com/path?api_key=secret", quote: "source snippet" }] }] }])},
      '{"version":1,"auditId":"audit-list","language":"en","direction":"ltr","coverage":{"wordsScanned":12,"sectionsDetected":1,"paragraphsScanned":1,"sentencesScanned":1,"claimsExtracted":0,"claimsChecked":0,"claimsSkipped":0,"skipReasons":{},"plagiarismPassagesChecked":0,"plagiarismPassagesSkipped":0,"providerFailures":0,"providerRetries":0},"segments":[],"claims":[],"claimDecisions":[],"factAssessments":[],"plagiarismFindings":[],"providerAttempts":[],"createdAt":"2026-06-09T00:00:00.000Z"}',
      0.25
    )`);

    const res = await GET_CHECKS(new NextRequest("http://localhost/api/checks?limit=10"));
    const body = await res.json();

    expect(body[0].source).toBe("https://example.com/list-audit.md?token=%5Bredacted%5D&utm_source=x");
    expect(body[0].verdict).toBe("fail");
    expect(body[0].score).toBe(50);
    expect(body[0].resultCount).toBe(1);
    expect(body[0].results).toBeUndefined();
    expect(body[0].audit).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("private list quote");
    expect(JSON.stringify(body)).not.toContain("source snippet");
    expect(JSON.stringify(body)).not.toContain("api_key=secret");
    expect(JSON.stringify(body)).not.toContain("user:secret");
    expect(JSON.stringify(body)).not.toContain("token=abc");
  });
});

describe("GET /api/search", () => {
  it("returns public search results without raw storage fields", async () => {
    const db = getDb();
    db.run(sql`INSERT INTO checks (
      source,
      word_count,
      results_json,
      audit_json,
      total_cost
    ) VALUES (
      'search-audit.md',
      12,
      ${JSON.stringify([{ skillId: "fact", verdict: "fail", findings: [{ quote: "detail quote" }] }])},
      '{"version":1,"auditId":"audit-search","language":"en","direction":"ltr","coverage":{"wordsScanned":12,"sectionsDetected":1,"paragraphsScanned":1,"sentencesScanned":1,"claimsExtracted":0,"claimsChecked":0,"claimsSkipped":0,"skipReasons":{},"plagiarismPassagesChecked":0,"plagiarismPassagesSkipped":0,"providerFailures":0,"providerRetries":0},"segments":[],"claims":[],"claimDecisions":[],"factAssessments":[],"plagiarismFindings":[],"providerAttempts":[],"createdAt":"2026-06-09T00:00:00.000Z"}',
      0.25
    )`);

    const res = await GET_SEARCH(new NextRequest("http://localhost/api/search?q=search-audit"));
    const body = await res.json();

    expect(body[0].source).toBe("search-audit.md");
    expect(body[0].verdict).toBe("fail");
    expect(body[0].score).toBe(0);
    expect(body[0].resultCount).toBe(1);
    expect(body[0].results).toBeUndefined();
    expect(body[0].resultsJson).toBeUndefined();
    expect(body[0].results_json).toBeUndefined();
    expect(body[0].auditJson).toBeUndefined();
    expect(body[0].audit_json).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("detail quote");
  });
});

afterEach(() => {
  runCheckCoreMock.mockReset();
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

  it("rolls back check and tag rows when tag insertion fails after the check completes", async () => {
    const db = getDb();
    db.run(sql`CREATE TRIGGER fail_tags_insert BEFORE INSERT ON tags BEGIN SELECT RAISE(ABORT, 'tag insert failed'); END`);

    const req = new NextRequest("http://localhost/api/checks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({
        text: "A short article with enough words.",
        source: "rollback-test",
        tags: ["release"],
      }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("tag insert failed");
    expect((db.all(sql`SELECT COUNT(*) AS count FROM checks`) as Array<{ count: number }>)[0]?.count).toBe(0);
    expect((db.all(sql`SELECT COUNT(*) AS count FROM tags`) as Array<{ count: number }>)[0]?.count).toBe(0);
    expect((db.all(sql`SELECT COUNT(*) AS count FROM check_tags`) as Array<{ count: number }>)[0]?.count).toBe(0);
  });

  it("sanitizes token-like provider errors before returning JSON", async () => {
    runCheckCoreMock.mockRejectedValueOnce(new Error("Provider failed with Bearer sk-live-secret-123 and api_key=abc123"));

    const req = new NextRequest("http://localhost/api/checks", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ text: "A short article with enough words.", source: "error-redaction" }),
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toContain("[redacted]");
    expect(body.error).not.toContain("sk-live-secret");
    expect(body.error).not.toContain("abc123");
  });
});
