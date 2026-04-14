import { describe, it, expect } from "bun:test";
import { applyThreshold } from "./thresholds.ts";

describe("applyThreshold", () => {
  it("returns pass when score >= pass threshold", () => {
    expect(applyThreshold(85, "warn", { pass: 80, warn: 60 })).toBe("pass");
  });
  it("returns warn when score between warn and pass", () => {
    expect(applyThreshold(65, "pass", { pass: 80, warn: 60 })).toBe("warn");
  });
  it("returns fail when score < warn threshold", () => {
    expect(applyThreshold(50, "pass", { pass: 80, warn: 60 })).toBe("fail");
  });
  it("keeps original verdict when no threshold set", () => {
    expect(applyThreshold(65, "pass", undefined)).toBe("pass");
  });
  it("handles exact boundary values", () => {
    expect(applyThreshold(80, "warn", { pass: 80, warn: 60 })).toBe("pass");
    expect(applyThreshold(60, "fail", { pass: 80, warn: 60 })).toBe("warn");
  });
});
