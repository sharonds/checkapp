import { describe, expect, it } from "vitest";
import { homedir } from "os";
import { join } from "path";

// Dashboard tests must never read or write the developer's real ~/.checkapp files.
describe("dashboard test isolation", () => {
  it("points config and telemetry at temporary paths, not ~/.checkapp", () => {
    const real = join(homedir(), ".checkapp");
    expect(process.env.CHECKAPP_CONFIG_PATH).toBeDefined();
    expect(process.env.CHECKAPP_CONFIG_PATH!.startsWith(real)).toBe(false);
    expect(process.env.CHECKAPP_AUDIT_EVENTS_PATH).toBeDefined();
    expect(process.env.CHECKAPP_AUDIT_EVENTS_PATH!.startsWith(real)).toBe(false);
    expect(process.env.CHECKAPP_TRACE).toBe("0");
  });
});
