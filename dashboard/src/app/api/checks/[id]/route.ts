import { jsonWithCors } from "@/lib/cors";
import { getCheckById, getTagsForCheck } from "@/lib/db";
import { guardLocalReadOnly } from "@/lib/guard-local";
import { parseStoredAuditRecord } from "../../../../../../src/audit/types";
import { NextRequest } from "next/server";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = guardLocalReadOnly(request);
  if (blocked) return blocked;
  try {
    const { id } = await params;
    const check = getCheckById(Number(id));
    if (!check) return jsonWithCors({ error: "Not found" }, { status: 404 });
    const tags = getTagsForCheck(check.id!);
    return jsonWithCors({
      id: check.id,
      source: check.source,
      wordCount: check.wordCount,
      totalCost: check.totalCost,
      createdAt: check.createdAt,
      results: parseResultsJson(check.resultsJson),
      audit: parseStoredAuditRecord(check.auditJson),
      tags,
    });
  } catch (err) {
    return jsonWithCors({ error: "Failed to fetch check" }, { status: 500 });
  }
}

function parseResultsJson(raw: string) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
