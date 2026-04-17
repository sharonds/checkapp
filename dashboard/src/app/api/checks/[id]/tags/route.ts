import { jsonWithCors } from "@/lib/cors";
import { addTagsToCheck, getTagsForCheck } from "@/lib/db";
import { guardLocalMutation } from "@/lib/guard-local";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    const { tags } = await req.json() as { tags?: string[] };
    if (!tags?.length) return jsonWithCors({ error: "tags array required" }, { status: 400 });
    addTagsToCheck(Number(id), tags);
    return jsonWithCors({ tags: getTagsForCheck(Number(id)) });
  } catch (err) {
    return jsonWithCors({ error: "Failed to add tags" }, { status: 500 });
  }
}
