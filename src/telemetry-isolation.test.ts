import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveAuditEventsPath } from "./telemetry/audit-events.ts";

describe("audit telemetry isolation", () => {
  test("under a test runner with no explicit path, events never go to the real ~/.checkapp log", () => {
    const saved = process.env.CHECKAPP_AUDIT_EVENTS_PATH;
    delete process.env.CHECKAPP_AUDIT_EVENTS_PATH;
    try {
      expect(process.env.NODE_ENV).toBe("test");
      expect(resolveAuditEventsPath()).not.toBe(join(homedir(), ".checkapp", "audit-events.jsonl"));
    } finally {
      if (saved !== undefined) process.env.CHECKAPP_AUDIT_EVENTS_PATH = saved;
    }
  });

  test("E2E fixture runs (dashboard dev server, NODE_ENV != test) never write the real log", () => {
    const saved = { path: process.env.CHECKAPP_AUDIT_EVENTS_PATH, env: process.env.NODE_ENV, e2e: process.env.CHECKAPP_E2E };
    delete process.env.CHECKAPP_AUDIT_EVENTS_PATH;
    process.env.NODE_ENV = "development";
    process.env.CHECKAPP_E2E = "1";
    try {
      expect(resolveAuditEventsPath()).not.toBe(join(homedir(), ".checkapp", "audit-events.jsonl"));
    } finally {
      if (saved.path !== undefined) process.env.CHECKAPP_AUDIT_EVENTS_PATH = saved.path;
      process.env.NODE_ENV = saved.env;
      if (saved.e2e === undefined) delete process.env.CHECKAPP_E2E;
      else process.env.CHECKAPP_E2E = saved.e2e;
    }
  });

  test("an explicit CHECKAPP_AUDIT_EVENTS_PATH always wins", () => {
    const saved = process.env.CHECKAPP_AUDIT_EVENTS_PATH;
    process.env.CHECKAPP_AUDIT_EVENTS_PATH = "/tmp/explicit-events.jsonl";
    try {
      expect(resolveAuditEventsPath()).toBe("/tmp/explicit-events.jsonl");
    } finally {
      if (saved === undefined) delete process.env.CHECKAPP_AUDIT_EVENTS_PATH;
      else process.env.CHECKAPP_AUDIT_EVENTS_PATH = saved;
    }
  });
});
