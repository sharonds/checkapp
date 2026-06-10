import { jsonWithCors } from "@/lib/cors";
import { getRecentChecks, insertCheckWithTags } from "@/lib/db";
import { runCheckCore, loadContextsIntoConfig } from "@/lib/run-check";
import { readAppConfig } from "@/lib/config";
import { guardLocalMutation, guardLocalReadOnly } from "@/lib/guard-local";
import { emitTierSelectedEvent } from "../../../../../src/telemetry/audit-events";
import { publicCheckSummary } from "../../../../../shared/check-summary";
import { NextRequest } from "next/server";
import { sanitizeProviderError, serializeAuditRecord } from "../../../../../src/audit/types";

const MAX_TEXT_LENGTH = 50_000;

export async function GET(request: NextRequest) {
  const blocked = guardLocalReadOnly(request);
  if (blocked) return blocked;
  try {
    const url = new URL(request.url);
    const rawLimit = Number(url.searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;
    const checks = getRecentChecks(limit);
    const parsed = checks.map((c) => publicCheckSummary({
      id: c.id,
      source: c.source,
      wordCount: c.wordCount,
      totalCost: c.totalCost,
      createdAt: c.createdAt,
      resultsJson: c.resultsJson,
    }));
    return jsonWithCors(parsed);
  } catch (err) {
    return jsonWithCors({ error: "Failed to fetch checks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const blocked = guardLocalMutation(req);
  if (blocked) return blocked;
  try {
    const body = await req.json();
    const { text, source, tags } = body as { text?: string; source?: string; tags?: string[] };
    if (!text) return jsonWithCors({ error: "text is required" }, { status: 400 });
    if (text.length > MAX_TEXT_LENGTH) return jsonWithCors({ error: `text exceeds ${MAX_TEXT_LENGTH} characters` }, { status: 400 });

    const sourceLabel = source ?? "dashboard-check";
    const wordCount = text.trim().split(/\s+/).length;

    // Read config from ~/.checkapp/config.json
    const configRaw = readAppConfig() as any;
    const config = loadContextsIntoConfig(configRaw);

    const { results, totalCostUsd, audit } = await runCheckCore(text, config, {
      onFactCheckTierSelected(selection) {
        emitTierSelectedEvent({
          source: "dashboard",
          requestedTier: selection.requestedTier ?? null,
          effectiveTier: selection.effectiveTier,
          flagOn: selection.flagOn,
          selectedImplementation: selection.selectedImplementation,
          selectedSkillId: selection.selectedSkillId,
        });
      },
    });

    const id = insertCheckWithTags({
      source: sourceLabel,
      wordCount,
      resultsJson: JSON.stringify(results),
      auditJson: serializeAuditRecord(audit),
      totalCost: totalCostUsd,
      articleText: text,
      tags,
    });

    return jsonWithCors({ id, results, totalCostUsd, audit }, { status: 201 });
  } catch (err) {
    const error = sanitizeProviderError(err instanceof Error ? err.message : String(err)) || "Check failed";
    return jsonWithCors({ error }, { status: 500 });
  }
}
