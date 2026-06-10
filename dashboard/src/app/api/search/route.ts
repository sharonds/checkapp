import { jsonWithCors } from "@/lib/cors";
import { searchChecks } from "@/lib/db";
import { guardLocalReadOnly } from "@/lib/guard-local";
import { publicCheckSummary } from "../../../../../shared/check-summary";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const blocked = guardLocalReadOnly(request);
  if (blocked) return blocked;
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q") ?? "";
    const tag = url.searchParams.get("tag") ?? undefined;
    const results = searchChecks(q, tag);
    const parsed = results.map((c) => publicCheckSummary({
      id: c.id,
      source: c.source,
      wordCount: c.wordCount,
      totalCost: c.totalCost,
      createdAt: c.createdAt,
      resultsJson: c.resultsJson,
    }));
    return jsonWithCors(parsed);
  } catch (err) {
    return jsonWithCors({ error: "Search failed" }, { status: 500 });
  }
}
