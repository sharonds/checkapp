import { emitAuditFailedEvent } from "../telemetry/audit-events.ts";
import { serializeAuditRecord } from "./types.ts";
import type { AuditRecord } from "./types.ts";

/**
 * Serialize an audit for DB storage. A validation failure is NEVER silent: it
 * emits a durable audit.failed event (queryable in ~/.checkapp/audit-events.jsonl)
 * and logs to stderr, returning failed:true so callers can surface "audit
 * unavailable" instead of rendering a dropped audit as a clean report. A
 * null/undefined audit is not a failure (nothing to store).
 */
export function serializeAuditForStorage(
  audit: AuditRecord | null | undefined,
  context: { source: string },
): { json: string | null; failed: boolean } {
  const result = serializeAuditRecord(audit);
  if (!result.ok) {
    emitAuditFailedEvent({ stage: "serialize", source: context.source, error: result.error });
    console.error(`[audit] failed to serialize audit for persistence (${context.source}): ${result.error}`);
    return { json: null, failed: true };
  }
  return { json: result.json, failed: false };
}
