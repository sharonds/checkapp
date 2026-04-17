import { readFileSync, existsSync } from "fs";
import { openDb, insertContext, getContext, listContexts, updateContext, deleteContext } from "./db.ts";

export interface ContextArgs {
  action: "add" | "list" | "show" | "remove" | "update";
  type?: string;
  path?: string;
}

export function parseContextArgs(args: string[]): ContextArgs {
  const action = args[0] as ContextArgs["action"];
  if (action === "list") return { action };
  if (action === "show") return { action, type: args[1] };
  if (action === "remove") return { action, type: args[1] };
  if (action === "add" || action === "update") return { action, type: args[1], path: args[2] };
  return { action: "list" }; // fallback
}

export function runContextCommand(args: string[]): void {
  if (args.length === 0 || args[0] === "help") {
    console.log("Usage:");
    console.log("  checkapp context add <type> <file>    Add/update a context document");
    console.log("  checkapp context list                 List all saved contexts");
    console.log("  checkapp context show <type>          Show context content");
    console.log("  checkapp context remove <type>        Remove a context");
    console.log("");
    console.log("Types: tone-guide, legal-policy, brief, style-guide, custom");
    return;
  }

  const parsed = parseContextArgs(args);
  const db = openDb();

  switch (parsed.action) {
    case "add":
    case "update": {
      if (!parsed.type || !parsed.path) {
        console.error("Usage: checkapp context add <type> <file>");
        process.exit(1);
      }
      if (!existsSync(parsed.path)) {
        console.error(`File not found: ${parsed.path}`);
        process.exit(1);
      }
      const content = readFileSync(parsed.path, "utf-8");
      const existing = getContext(db, parsed.type);
      if (existing) {
        updateContext(db, parsed.type, { content });
        console.log(`Updated context: ${parsed.type} (${content.length} chars)`);
      } else {
        insertContext(db, { type: parsed.type, name: parsed.type, content });
        console.log(`Added context: ${parsed.type} (${content.length} chars)`);
      }
      break;
    }
    case "list": {
      const contexts = listContexts(db);
      if (contexts.length === 0) {
        console.log("No contexts saved.");
        console.log("Add one: checkapp context add tone-guide ./brand-voice.md");
        return;
      }
      console.log("\nSaved contexts:\n");
      for (const c of contexts) {
        console.log(`  ${c.type.padEnd(20)} ${c.content.length.toString().padStart(6)} chars  updated ${c.updatedAt ?? "unknown"}`);
      }
      console.log("");
      break;
    }
    case "show": {
      if (!parsed.type) { console.error("Usage: checkapp context show <type>"); process.exit(1); }
      const ctx = getContext(db, parsed.type);
      if (!ctx) { console.log(`No context found for: ${parsed.type}`); return; }
      console.log(`\n--- ${ctx.type} (${ctx.content.length} chars) ---\n`);
      console.log(ctx.content);
      break;
    }
    case "remove": {
      if (!parsed.type) { console.error("Usage: checkapp context remove <type>"); process.exit(1); }
      deleteContext(db, parsed.type);
      console.log(`Removed context: ${parsed.type}`);
      break;
    }
  }
}
