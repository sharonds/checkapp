// Runs before every dashboard test file: keep tests away from the developer's real
// ~/.checkapp config, telemetry and traces. Modules resolve these paths at import time,
// so they must be set here rather than inside individual tests.
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const dir = mkdtempSync(join(tmpdir(), "checkapp-dashboard-test-"));
process.env.CHECKAPP_CONFIG_PATH ??= join(dir, "config.json");
process.env.CHECKAPP_AUDIT_EVENTS_PATH ??= join(dir, "audit-events.jsonl");
process.env.CHECKAPP_TRACE ??= "0";
