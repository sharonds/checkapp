import { jsonWithCors } from "@/lib/cors";
import { getAllTags } from "@/lib/db";
import { guardLocalReadOnly } from "@/lib/guard-local";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const blocked = guardLocalReadOnly(req);
  if (blocked) return blocked;
  try {
    return jsonWithCors(getAllTags());
  } catch (err) {
    return jsonWithCors({ error: "Failed to fetch tags" }, { status: 500 });
  }
}
