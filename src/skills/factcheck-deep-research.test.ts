import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import type { Config } from "../config.ts";
import {
  createSchema,
  getAuditsForParent,
  getDeepAudit,
  insertDeepAudit,
} from "../db.ts";
import { jsonResponse, mockFetch } from "../testing/mock-fetch.ts";
import { FactCheckDeepResearchSkill } from "./factcheck-deep-research.ts";

describe("FactCheckDeepResearchSkill", () => {
  const baseConfig: Config = {
    copyscapeUser: "",
    copyscapeKey: "",
    geminiApiKey: "gemini-key",
    skills: {
      plagiarism: false,
      aiDetection: false,
      seo: false,
      factCheck: true,
      tone: false,
      legal: false,
      summary: false,
      brief: false,
      purpose: false,
    },
  };

  test("initiate returns the active audit instead of creating a duplicate", async () => {
    const db = new Database(":memory:");
    createSchema(db);

    const auditId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "abc123def4567890",
      requestedBy: "mcp",
      startedAt: 10,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'in_progress' WHERE id = ?",
      ["int-existing", auditId],
    );

    let createCalls = 0;
    mockFetch(async () => {
      createCalls++;
      return jsonResponse({ id: "int-new" });
    });

    const skill = new FactCheckDeepResearchSkill({ db, now: () => 10 });
    const result = await skill.initiate(
      "article text",
      "content_hash",
      "abc123def4567890",
      baseConfig,
      "mcp",
    );

    expect(result).toEqual({
      interactionId: "int-existing",
      status: "in_progress",
      estimatedCompletion: 10 + 15 * 60_000,
    });
    expect(createCalls).toBe(0);
    expect(getAuditsForParent(db, "content_hash", "abc123def4567890")).toHaveLength(1);

    db.close();
  });

  test("initiate reuses an existing pending audit without starting a duplicate provider interaction", async () => {
    const db = new Database(":memory:");
    createSchema(db);

    const auditId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "pending-hash",
      requestedBy: "mcp",
      startedAt: 10,
    });

    let createCalls = 0;
    mockFetch(async () => {
      createCalls++;
      return jsonResponse({ id: "int-created" });
    });

    const skill = new FactCheckDeepResearchSkill({ db, now: () => 25 });
    const result = await skill.initiate(
      "article text",
      "content_hash",
      "pending-hash",
      baseConfig,
      "mcp",
    );

    expect(result).toEqual({
      interactionId: null,
      status: "pending",
      estimatedCompletion: 10 + 15 * 60_000,
    });

    expect(createCalls).toBe(0);
    expect(getDeepAudit(db, "int-created")).toBeNull();
    expect(getAuditsForParent(db, "content_hash", "pending-hash")).toEqual([
      expect.objectContaining({ id: auditId, status: "pending", interactionId: null }),
    ]);

    db.close();
  });

  test("initiate retires stale pending audits and starts a new provider interaction", async () => {
    const db = new Database(":memory:");
    createSchema(db);

    const staleId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "stale-pending-hash",
      requestedBy: "mcp",
      startedAt: 10,
    });

    let createCalls = 0;
    mockFetch(async () => {
      createCalls++;
      return jsonResponse({ id: "int-created-after-stale" });
    });

    const now = 100 * 60_000;
    const skill = new FactCheckDeepResearchSkill({ db, now: () => now });
    const result = await skill.initiate(
      "article text",
      "content_hash",
      "stale-pending-hash",
      baseConfig,
      "mcp",
    );

    const audits = getAuditsForParent(db, "content_hash", "stale-pending-hash");
    expect(createCalls).toBe(1);
    expect(result).toEqual({
      interactionId: "int-created-after-stale",
      status: "in_progress",
      estimatedCompletion: now + 15 * 60_000,
    });
    expect(audits).toEqual([
      expect.objectContaining({ interactionId: "int-created-after-stale", status: "in_progress" }),
      expect.objectContaining({ id: staleId, interactionId: null, status: "stale" }),
    ]);

    db.close();
  });

  test("fetchResult stores completed output and returns a SkillResult", async () => {
    const db = new Database(":memory:");
    createSchema(db);

    const auditId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "hash-2",
      requestedBy: "dashboard",
      startedAt: 100,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'in_progress' WHERE id = ?",
      ["int-complete", auditId],
    );

    mockFetch(async (req) => {
      expect(req.method).toBe("GET");
      expect(req.url).toContain("/interactions/int-complete?key=gemini-key");
      return jsonResponse({
        id: "int-complete",
        status: "completed",
        outputs: [{ text: "## Executive Summary\nEverything checks out." }],
      });
    });

    const skill = new FactCheckDeepResearchSkill({ db, now: () => 1_000 });
    const result = await skill.fetchResult("int-complete", baseConfig);

    expect(result).not.toBeNull();
    expect(result?.verdict).toBe("pass");
    expect(result?.summary).toBe("Deep Audit completed");
    expect(result?.findings[0]?.text).toContain("Executive Summary");
    expect(result?.costUsd).toBe(1.5);

    const stored = getDeepAudit(db, "int-complete");
    expect(stored?.status).toBe("completed");
    expect(stored?.completedAt).toBe(1_000);
    expect(stored?.resultText).toContain("Everything checks out.");
    expect(stored?.resultJson).toContain("\"status\":\"completed\"");

    db.close();
  });

  test("fetchResult sanitizes failed provider errors before persistence and output", async () => {
    const db = new Database(":memory:");
    createSchema(db);

    const auditId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "hash-failed",
      requestedBy: "mcp",
      startedAt: 100,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'in_progress' WHERE id = ?",
      ["int-failed", auditId],
    );

    mockFetch(async () => jsonResponse({
      id: "int-failed",
      status: "failed",
      error: "Bearer sk-live-secret failed token=abc123",
    }));

    const skill = new FactCheckDeepResearchSkill({ db, now: () => 1_000 });
    const result = await skill.fetchResult("int-failed", baseConfig);
    const body = JSON.stringify(result);
    const stored = getDeepAudit(db, "int-failed");
    const storedBody = JSON.stringify(stored);

    expect(result?.verdict).toBe("fail");
    expect(body).not.toContain("sk-live-secret");
    expect(body).not.toContain("abc123");
    expect(stored?.status).toBe("failed");
    expect(storedBody).not.toContain("sk-live-secret");
    expect(storedBody).not.toContain("abc123");
    expect(storedBody).toContain("[redacted]");

    db.close();
  });
});
