import { jsonWithCors } from "@/lib/cors";
import { getContexts, upsertContext } from "@/lib/db";
import { guardLocalMutation } from "@/lib/guard-local";
import { NextRequest } from "next/server";

export async function GET() {
  try {
    const all = getContexts();
    return jsonWithCors(all);
  } catch {
    return jsonWithCors({ error: "Failed to fetch contexts" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const { type, name, content } = (await req.json()) as {
      type: string;
      name?: string;
      content: string;
    };
    if (!type) {
      return jsonWithCors(
        { error: "type is required" },
        { status: 400 }
      );
    }
    upsertContext(type, name ?? type, content ?? "");
    return jsonWithCors({ ok: true });
  } catch {
    return jsonWithCors({ error: "Failed to save context" }, { status: 500 });
  }
}
