import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { runCheckHeadless } from "./checker.ts";
import { openDb, queryRecent, getCheckById, getContext, listContexts, insertContext, updateContext } from "./db.ts";
import { readConfig, writeConfig } from "./config.ts";

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
  ];
}

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "check_article": {
      const text = args.text as string;
      const source = (args.source as string) ?? "mcp-check";
      const result = await runCheckHeadless(source, { text });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    }
    case "list_reports": {
      const db = openDb();
      try {
        const limit = (args.limit as number) ?? 20;
        const checks = queryRecent(db, limit);
        return { content: [{ type: "text", text: JSON.stringify(checks, null, 2) }] };
      } finally {
        db.close();
      }
    }
    case "get_report": {
      const db = openDb();
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
      const db = openDb();
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
      const db = openDb();
      try {
        const contexts = listContexts(db);
        return { content: [{ type: "text", text: JSON.stringify(contexts, null, 2) }] };
      } finally {
        db.close();
      }
    }
    case "get_skills": {
      const config = readConfig();
      const skills = Object.entries(config.skills).map(([id, enabled]) => ({ id, enabled }));
      return { content: [{ type: "text", text: JSON.stringify(skills, null, 2) }] };
    }
    case "toggle_skill": {
      const config = readConfig();
      const skillId = args.skillId as string;
      const enabled = args.enabled as boolean;
      const skills = { ...config.skills, [skillId]: enabled };
      await writeConfig({ skills });
      return { content: [{ type: "text", text: `Skill '${skillId}' ${enabled ? "enabled" : "disabled"}` }] };
    }
    case "regenerate_article": {
      const { regenerateArticle } = await import("./regenerate.ts");
      const text = args.text as string;
      const checkResult = await runCheckHeadless("mcp-regenerate", { text });
      const regen = await regenerateArticle(text, checkResult.results);
      return { content: [{ type: "text", text: JSON.stringify(regen, null, 2) }] };
    }
    default:
      return { content: [{ type: "text", text: `Unknown tool: ${name}` }], isError: true };
  }
}

export async function startMcpServer() {
  const server = new Server(
    { name: "checkapp", version: "1.1.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return handleToolCall(request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
