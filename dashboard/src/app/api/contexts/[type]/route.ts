import { jsonWithCors } from "@/lib/cors";
import { getContextByType, deleteContextByType } from "@/lib/db";
import { guardLocalMutation } from "@/lib/guard-local";
import { NextRequest } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ type: string }> }
) {
  try {
    const { type } = await params;
    const ctx = getContextByType(type);
    if (!ctx) {
      return jsonWithCors({ error: "Context not found" }, { status: 404 });
    }
    return jsonWithCors(ctx);
  } catch {
    return jsonWithCors({ error: "Failed to fetch context" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ type: string }> }
) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const { type } = await params;
    deleteContextByType(type);
    return jsonWithCors({ ok: true });
  } catch {
    return jsonWithCors(
      { error: "Failed to delete context" },
      { status: 500 }
    );
  }
}
