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

  test("initiate attaches an interaction id to an existing pending audit", async () => {
    const db = new Database(":memory:");
    createSchema(db);

    const auditId = insertDeepAudit(db, {
      parentType: "content_hash",
      parentKey: "pending-hash",
      requestedBy: "mcp",
      startedAt: 10,
    });

    mockFetch(async () => jsonResponse({ id: "int-created" }));

    const skill = new FactCheckDeepResearchSkill({ db, now: () => 25 });
    const result = await skill.initiate(
      "article text",
      "content_hash",
      "pending-hash",
      baseConfig,
      "mcp",
    );

    expect(result).toEqual({
      interactionId: "int-created",
      status: "in_progress",
      estimatedCompletion: 25 + 15 * 60_000,
    });

    const stored = getDeepAudit(db, "int-created");
    expect(stored?.id).toBe(auditId);
    expect(stored?.status).toBe("in_progress");

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
});
