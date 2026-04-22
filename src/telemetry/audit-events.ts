import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";

export type AuditEventName =
  | "tier.selected"
  | "grounded.call"
  | "audit.requested"
  | "audit.created"
  | "audit.poll"
  | "audit.completed"
  | "audit.failed"
  | "audit.stale";

export interface AuditEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  timestamp: string;
  event: AuditEventName;
  payload: TPayload;
}

const DEFAULT_EVENTS_PATH = join(homedir(), ".checkapp", "audit-events.jsonl");

export function emitAuditEvent<TPayload extends Record<string, unknown>>(
  event: AuditEventName,
  payload: TPayload,
): AuditEvent<TPayload> {
  const entry: AuditEvent<TPayload> = {
    timestamp: new Date().toISOString(),
    event,
    payload,
  };

  const line = JSON.stringify(entry);

  try {
    const path = process.env.CHECKAPP_AUDIT_EVENTS_PATH || DEFAULT_EVENTS_PATH;
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${line}\n`, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to write audit event: ${message}`);
  }

  return entry;
}

export function emitTierSelectedEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("tier.selected", payload);
}

export function emitGroundedCallEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("grounded.call", payload);
}

export function emitAuditRequestedEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("audit.requested", payload);
}

export function emitAuditCreatedEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("audit.created", payload);
}

export function emitAuditPollEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("audit.poll", payload);
}

export function emitAuditCompletedEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("audit.completed", payload);
}

export function emitAuditFailedEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("audit.failed", payload);
}

export function emitAuditStaleEvent(payload: Record<string, unknown>) {
  return emitAuditEvent("audit.stale", payload);
}
