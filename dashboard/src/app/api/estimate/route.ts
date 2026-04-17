import { NextRequest, NextResponse } from "next/server";
import { readAppConfig } from "@/lib/config";
import { guardLocalReadOnly } from "@/lib/guard-local";
import { estimateRunCost, type AppConfigForEstimate } from "@/lib/estimator";

export async function POST(req: NextRequest) {
  const blocked = guardLocalReadOnly(req);
  if (blocked) return blocked;
  try {
    const body = (await req.json()) as { wordCount?: number };
    const wordCount = Math.max(0, Math.floor(Number(body.wordCount) || 0));
    const cfg = readAppConfig() as AppConfigForEstimate;
    return NextResponse.json(estimateRunCost(cfg, wordCount));
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
