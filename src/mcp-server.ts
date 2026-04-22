import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { createHash } from "node:crypto";
import { runCheckHeadless } from "./checker.ts";
import {
  openDb,
  queryRecent,
  getCheckById,
  getContext,
  listContexts,
  insertContext,
  updateContext,
  getCheckArticleText,
  getActiveAuditForParent,
} from "./db.ts";
import type { Config } from "./config.ts";
import { readConfig, writeConfig } from "./config.ts";
import { primeGeminiCapabilityHealthCheck } from "./providers/gemini-capability.ts";
import { FactCheckDeepResearchSkill } from "./skills/factcheck-deep-research.ts";

const ESTIMATED_COMPLETION_MS = 15 * 60_000;

const mcpServerDeps = {
  openDb,
  readConfig,
  writeConfig,
  createDeepResearchSkill: () => new FactCheckDeepResearchSkill(),
  primeGeminiCapabilityHealthCheck,
  createServer: () => new Server(
    { name: "checkapp", version: "1.2.0" },
    { capabilities: { tools: {} } }
  ),
  createTransport: () => new StdioServerTransport(),
};

export function __setMcpServerTestOverrides(overrides: Partial<typeof mcpServerDeps>) {
  Object.assign(mcpServerDeps, overrides);
}

export function __resetMcpServerTestOverrides() {
  mcpServerDeps.openDb = openDb;
  mcpServerDeps.readConfig = readConfig;
  mcpServerDeps.writeConfig = writeConfig;
  mcpServerDeps.createDeepResearchSkill = () => new FactCheckDeepResearchSkill();
  mcpServerDeps.primeGeminiCapabilityHealthCheck = primeGeminiCapabilityHealthCheck;
  mcpServerDeps.createServer = () => new Server(
    { name: "checkapp", version: "1.2.0" },
    { capabilities: { tools: {} } }
  );
  mcpServerDeps.createTransport = () => new StdioServerTransport();
}

export function getToolDefinitions() {
  return [
    {
      name: "check_article",
      description: "Run CheckApp's quality checks on an article. Phase 7+ findings include optional fields: sources[] (evidence), rewrite (correction), citations[] (academic papers), claimType, confidence. MCP output is JSON.stringify(runCheckHeadlessResult) — parse and handle absent fields gracefully.",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "The article text to check" },
          source: { type: "string", description: "Source label (filename or URL)" },
          tags: { type: "array", items: { type: "string" }, description: "Optional tags for the check" },
        },
        required: ["text"],
      },
    },
    {
      name: "list_reports",
      description: "List recent article check reports",
      inputSchema: {
        type: "object" as const,
        properties: {
          limit: { type: "number", description: "Max reports to return (default 20)" },
        },
      },
    },
    {
      name: "get_report",
      description: "Get a specific check report by ID",
      inputSchema: {
        type: "object" as const,
        properties: {
          id: { type: "number", description: "Check ID" },
        },
        required: ["id"],
      },
    },
    {
      name: "upload_context",
      description: "Upload a context document (tone guide, brief, legal policy, style guide)",
      inputSchema: {
        type: "object" as const,
        properties: {
          type: { type: "string", description: "Context type: tone-guide, legal-policy, brief, style-guide, custom" },
          name: { type: "string", description: "Display name" },
          content: { type: "string", description: "The context content (markdown)" },
        },
        required: ["type", "content"],
      },
    },
    {
      name: "list_contexts",
      description: "List all saved context documents",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "get_skills",
      description: "List all available skills with their enabled status",
      inputSchema: { type: "object" as const, properties: {} },
    },
    {
      name: "toggle_skill",
      description: "Enable or disable a skill",
      inputSchema: {
        type: "object" as const,
        properties: {
          skillId: { type: "string", description: "Skill ID (e.g., 'seo', 'factCheck')" },
          enabled: { type: "boolean", description: "Whether to enable the skill" },
        },
        required: ["skillId", "enabled"],
      },
    },
    {
      name: "regenerate_article",
      description: "Get AI-suggested rewrites for flagged sentences in an article",
      inputSchema: {
        type: "object" as const,
        properties: {
          text: { type: "string", description: "The article text" },
        },
        required: ["text"],
      },
    },
    {
      name: "deep_audit_article",
      description: "Start or reuse an asynchronous deep fact-check audit for a stored report or raw article text",
      inputSchema: {
        type: "object" as const,
        properties: {
          checkId: { type: "number", description: "Existing check ID whose stored article text should be audited" },
          article: { type: "string", description: "Raw article text to audit" },
        },
        oneOf: [
          { required: ["checkId"] },
          { required: ["article"] },
        ],
      },
    },
    {
      name: "get_deep_audit_result",
      description: "Fetch the current result for a deep audit interaction",
      inputSchema: {
        type: "object" as const,
        properties: {
          interactionId: { type: "string", description: "Deep audit interaction ID" },
        },
        required: ["interactionId"],
      },
    },
  ];
}

export async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "check_article": {
      const text = args.text as string;
      const source = (args.source as string) ?? "mcp-check";
      const result = await runCheckHeadless(source, { text, telemetrySource: "mcp" });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "list_reports": {
      const db = mcpServerDeps.openDb();
      try {
        const limit = (args.limit as number) ?? 20;
        const checks = queryRecent(db, limit);
        return { content: [{ type: "text", text: JSON.stringify(checks, null, 2) }] };
      } finally {
        db.close();
      }
    }
    case "get_report": {
      const db = mcpServerDeps.openDb();
      try {
        const id = args.id as number;
        const check = getCheckById(db, id);
        if (!check) return { content: [{ type: "text", text: `Report ${id} not found` }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(check, null, 2) }] };
      } finally {
        db.close();
      }
    }
    case "upload_context": {
      const db = mcpServerDeps.openDb();
      try {
        const type = args.type as string;
        const ctxName = (args.name as string) ?? type;
        const content = args.content as string;
        const existing = getContext(db, type);
        if (existing) {
          updateContext(db, type, { name: ctxName, content });
        } else {
          insertContext(db, { type, name: ctxName, content });
        }
        return { content: [{ type: "text", text: `Context '${type}' saved (${content.length} chars)` }] };
      } finally {
        db.close();
      }
    }
    case "list_contexts": {
      const db = mcpServerDeps.openDb();
      try {
        const contexts = listContexts(db);
        return { content: [{ type: "text", text: JSON.stringify(contexts, null, 2) }] };
      } finally {
        db.close();
      }
    }
    case "get_skills": {
      const config = mcpServerDeps.readConfig();
      const skills = Object.entries(config.skills).map(([id, enabled]) => ({ id, enabled }));
      return { content: [{ type: "text", text: JSON.stringify(skills, null, 2) }] };
    }
    case "toggle_skill": {
      const config = mcpServerDeps.readConfig();
      const skillId = args.skillId as string;
      const enabled = args.enabled as boolean;
      const skills = { ...config.skills, [skillId]: enabled };
      await mcpServerDeps.writeConfig({ skills });
      return { content: [{ type: "text", text: `Skill '${skillId}' ${enabled ? "enabled" : "disabled"}` }] };
    }
    case "regenerate_article": {
      const { regenerateArticle } = await import("./regenerate.ts");
      const text = args.text as string;
      const config = args.config as any;
      const checkResult = await runCheckHeadless("mcp-regenerate", { text, config, telemetrySource: "mcp" });
      const regen = await regenerateArticle(text, checkResult.results, { config });
      return { content: [{ type: "text", text: JSON.stringify(regen, null, 2) }] };
    }
    case "deep_audit_article": {
      const checkId = asOptionalFiniteNumber(args.checkId);
      const article = asOptionalString(args.article);
      const selectionError = getExclusiveArgError(checkId !== undefined, article !== undefined, "checkId", "article");
      if (selectionError) {
        return errorResponse(selectionError);
      }

      const db = mcpServerDeps.openDb();
      try {
        const config = mcpServerDeps.readConfig();
        const skill = mcpServerDeps.createDeepResearchSkill();

        let text: string;
        let parentType: "check" | "content_hash";
        let parentKey: string;

        if (checkId !== undefined) {
          const storedArticle = getCheckArticleText(db, checkId);
          if (storedArticle === null) {
            return errorResponse(`Report ${checkId} not found`);
          }
          if (!storedArticle.trim()) {
            return errorResponse(
              `Historical report ${checkId} does not store article text. Deep Audit cannot start from checkId for that report; pass article text directly instead.`,
            );
          }
          text = storedArticle;
          parentType = "check";
          parentKey = String(checkId);
        } else {
          text = article!;
          parentType = "content_hash";
          parentKey = createHash("sha256").update(text).digest("hex").slice(0, 16);
        }

        const activeAudit = getActiveAuditForParent(db, parentType, parentKey);
        if (activeAudit?.interactionId) {
          return jsonResponse({
            interactionId: activeAudit.interactionId,
            status: activeAudit.status,
            estimatedCompletion: activeAudit.startedAt + ESTIMATED_COMPLETION_MS,
          });
        }

        const result = await skill.initiate(text, parentType, parentKey, config, "mcp");
        return jsonResponse(result);
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      } finally {
        db.close();
      }
    }
    case "get_deep_audit_result": {
      const interactionId = asOptionalString(args.interactionId);
      if (!interactionId) {
        return errorResponse("get_deep_audit_result requires interactionId");
      }

      try {
        const config = mcpServerDeps.readConfig();
        const skill = mcpServerDeps.createDeepResearchSkill();
        const result = await skill.fetchResult(interactionId, config as Config);

        if (result === null) {
          return jsonResponse({
            interactionId,
            status: "in_progress",
            message: "Deep Audit is still running",
          });
        }

        return jsonResponse({
          interactionId,
          status: result.verdict === "fail" ? "failed" : "completed",
          result,
        });
      } catch (error) {
        return errorResponse(error instanceof Error ? error.message : String(error));
      }
    }
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asOptionalFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getExclusiveArgError(hasFirst: boolean, hasSecond: boolean, firstName: string, secondName: string): string | null {
  if (hasFirst === hasSecond) {
    return `Provide exactly one of ${firstName} or ${secondName}`;
  }
  return null;
}

function jsonResponse(payload: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}

function errorResponse(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

export async function startMcpServer() {
  await primeGeminiStartupHealth();

  const server = mcpServerDeps.createServer();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
  });

  const transport = mcpServerDeps.createTransport();
  await server.connect(transport);
}

async function primeGeminiStartupHealth() {
  try {
    const health = await mcpServerDeps.primeGeminiCapabilityHealthCheck();
    const unavailable = Object.entries(health)
      .filter(([key, value]) => key !== "checkedAt" && value === false)
      .map(([key]) => key);
    if (unavailable.length > 0) {
      console.error(
        `Warning: Gemini capability probe reported unavailable endpoints at startup: ${unavailable.join(", ")}`,
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Warning: Gemini capability startup probe failed: ${message}`);
  }
}
