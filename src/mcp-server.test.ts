import { describe, it, expect } from "bun:test";
import { getToolDefinitions, handleToolCall } from "./mcp-server.ts";

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
  it("has 8 tools", () => {
    expect(getToolDefinitions()).toHaveLength(8);
  });
  it("all tools have name and description", () => {
    for (const tool of getToolDefinitions()) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
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
