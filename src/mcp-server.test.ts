import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { Database } from "bun:sqlite";
import type { Config } from "./config.ts";
import { createSchema, insertCheck, insertDeepAudit } from "./db.ts";
import { __resetMcpServerTestOverrides, __setMcpServerTestOverrides, getToolDefinitions, handleToolCall, startMcpServer } from "./mcp-server.ts";
import type { SkillResult } from "./skills/types.ts";

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
    grammar: false,
    academic: false,
    selfPlagiarism: false,
  },
};

let db: Database;

beforeEach(() => {
  db = new Database(":memory:");
  createSchema(db);
  const dbHandle = {
    run: db.run.bind(db),
    query: db.query.bind(db),
    prepare: db.prepare.bind(db),
    exec: db.exec.bind(db),
    close: () => undefined,
  } as unknown as Database;
  __setMcpServerTestOverrides({
    openDb: () => dbHandle,
    readConfig: () => baseConfig,
    writeConfig: async () => undefined,
  });
});

afterEach(() => {
  __resetMcpServerTestOverrides();
  mock.restore();
  db.close();
});

describe("MCP tool definitions", () => {
  it("defines check_article tool", () => {
    const tools = getToolDefinitions();
    const check = tools.find(t => t.name === "check_article");
    expect(check).toBeDefined();
    expect(check!.inputSchema.properties).toHaveProperty("text");
  });
  it("defines upload_context tool", () => {
    const tools = getToolDefinitions();
    expect(tools.find(t => t.name === "upload_context")).toBeDefined();
  });
  it("defines list_reports tool", () => {
    const tools = getToolDefinitions();
    expect(tools.find(t => t.name === "list_reports")).toBeDefined();
  });
  it("defines deep audit tools with the expected schemas", () => {
    const tools = getToolDefinitions();
    const deepAudit = tools.find(t => t.name === "deep_audit_article");
    const getResult = tools.find(t => t.name === "get_deep_audit_result");

    expect(deepAudit).toBeDefined();
    expect(deepAudit?.inputSchema.properties).toHaveProperty("checkId");
    expect(deepAudit?.inputSchema.properties).toHaveProperty("article");
    expect(deepAudit?.inputSchema.oneOf).toEqual([
      { required: ["checkId"] },
      { required: ["article"] },
    ]);

    expect(getResult).toBeDefined();
    expect(getResult?.inputSchema.properties).toHaveProperty("interactionId");
  });
  it("has 10 tools", () => {
    expect(getToolDefinitions()).toHaveLength(10);
  });
  it("all tools have name and description", () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
  });
});

describe("startMcpServer", () => {
  it("primes Gemini capability health and warns when endpoints are unavailable", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => undefined);
    const connectSpy = mock(async () => undefined);

    __setMcpServerTestOverrides({
      primeGeminiCapabilityHealthCheck: async () => ({
        pro: true,
        grounding: false,
        deepResearch: false,
        checkedAt: 1,
      }),
      createServer: () => ({
        setRequestHandler() {},
        connect: connectSpy,
      }) as unknown as Server,
      createTransport: () => ({}) as unknown as StdioServerTransport,
    });

    await startMcpServer();

    expect(connectSpy).toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      "Warning: Gemini capability probe reported unavailable endpoints at startup: grounding, deepResearch",
    );
  });
});

describe("get_skills", () => {
  it("lists grammar, academic, selfPlagiarism", async () => {
    const res = await handleToolCall("get_skills", {});
    const text = res.content[0].type === "text" ? res.content[0].text : "";
    const ids = JSON.parse(text).map((s: any) => s.id);
    expect(ids).toEqual(expect.arrayContaining(["grammar", "academic", "selfPlagiarism"]));
  });
});

describe("regenerate_article", () => {
  it("returns structured skip when no LLM provider configured", async () => {
    // Craft a check result with a finding that has a quote
    // This bypasses runCheckHeadless and lets us test the LLM provider check
    const cfg = {
      skills: {},
      providers: {},
    };
    const mockResults = [
      {
        skillId: "test",
        name: "Test",
        score: 50,
        verdict: "warn" as const,
        summary: "Test finding",
        findings: [
          {
            severity: "warn" as const,
            text: "This is a test issue",
            quote: "test sentence",
          },
        ],
        costUsd: 0,
      },
    ];

    // Call regenerateArticle directly through the handler
    // The handler will try to use the LLM provider and should return structured skip
    const { regenerateArticle } = await import("./regenerate.ts");
    const regen = await regenerateArticle("test sentence", mockResults, { config: cfg });
    expect(regen.status).toBe("skipped");
    expect(regen.reason).toMatch(/no llm provider/i);
  });
});

describe("deep_audit_article", () => {
  it("requires exactly one of checkId or article", async () => {
    const missing = await handleToolCall("deep_audit_article", {});
    expect(missing.isError).toBe(true);
    expect(missing.content[0].type === "text" ? missing.content[0].text : "").toContain("exactly one");

    const both = await handleToolCall("deep_audit_article", { checkId: 1, article: "text" });
    expect(both.isError).toBe(true);
    expect(both.content[0].type === "text" ? both.content[0].text : "").toContain("exactly one");
  });

  it("returns a clear error when a historical report has no stored article text", async () => {
    const checkId = insertCheck(db, {
      source: "legacy.md",
      wordCount: 10,
      results: [],
      totalCostUsd: 0,
      articleText: "",
    });

    const res = await handleToolCall("deep_audit_article", { checkId });
    const text = res.content[0].type === "text" ? res.content[0].text : "";

    expect(res.isError).toBe(true);
    expect(text).toContain("does not store article text");
    expect(text).toContain("pass article text directly");
  });

  it("returns an existing active audit without creating a duplicate interaction", async () => {
    const checkId = insertCheck(db, {
      source: "article.md",
      wordCount: 20,
      results: [],
      totalCostUsd: 0,
      articleText: "Existing article text",
    });
    const auditId = insertDeepAudit(db, {
      parentType: "check",
      parentKey: String(checkId),
      requestedBy: "mcp",
      startedAt: 1_000,
    });
    db.run(
      "UPDATE deep_audits SET interaction_id = ?, status = 'in_progress' WHERE id = ?",
      ["int-existing", auditId],
    );

    const fetchSpy = mock(() => {
      throw new Error("should not create a new interaction");
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy as typeof fetch;

    try {
      const res = await handleToolCall("deep_audit_article", { checkId });
      const payload = JSON.parse(res.content[0].type === "text" ? res.content[0].text : "");

      expect(res.isError).toBeUndefined();
      expect(payload).toEqual({
        interactionId: "int-existing",
        status: "in_progress",
        estimatedCompletion: 1_000 + 15 * 60_000,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("initiates a new deep audit for raw article text", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/interactions?key=gemini-key");
      expect(init?.method).toBe("POST");
      return new Response(JSON.stringify({ id: "int-new" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const res = await handleToolCall("deep_audit_article", { article: "Fresh article text" });
      const payload = JSON.parse(res.content[0].type === "text" ? res.content[0].text : "");

      expect(res.isError).toBeUndefined();
      expect(payload.interactionId).toBe("int-new");
      expect(payload.status).toBe("in_progress");
      expect(typeof payload.estimatedCompletion).toBe("number");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("get_deep_audit_result", () => {
  it("returns a clean in-progress response when the interaction is still running", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ id: "int-pending", status: "running" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const res = await handleToolCall("get_deep_audit_result", { interactionId: "int-pending" });
      const payload = JSON.parse(res.content[0].type === "text" ? res.content[0].text : "");

      expect(res.isError).toBeUndefined();
      expect(payload).toEqual({
        interactionId: "int-pending",
        status: "in_progress",
        message: "Deep Audit is still running",
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns completed deep audit results as JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({
        id: "int-complete",
        status: "completed",
        outputs: [{ text: "## Executive Summary\nChecks out." }],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const res = await handleToolCall("get_deep_audit_result", { interactionId: "int-complete" });
      const payload = JSON.parse(res.content[0].type === "text" ? res.content[0].text : "") as {
        interactionId: string;
        status: string;
        result: SkillResult;
      };

      expect(res.isError).toBeUndefined();
      expect(payload.interactionId).toBe("int-complete");
      expect(payload.status).toBe("completed");
      expect(payload.result.summary).toBe("Deep Audit completed");
      expect(payload.result.findings[0]?.text).toContain("Executive Summary");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns failed deep audit results as JSON", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({
        id: "int-failed",
        status: "failed",
        error: "Gemini job failed upstream",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const res = await handleToolCall("get_deep_audit_result", { interactionId: "int-failed" });
      const payload = JSON.parse(res.content[0].type === "text" ? res.content[0].text : "") as {
        interactionId: string;
        status: string;
        result: SkillResult;
      };

      expect(res.isError).toBeUndefined();
      expect(payload.interactionId).toBe("int-failed");
      expect(payload.status).toBe("failed");
      expect(payload.result.verdict).toBe("fail");
      expect(payload.result.summary).toContain("Deep Audit failed");
      expect(payload.result.error).toContain("Gemini job failed upstream");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
