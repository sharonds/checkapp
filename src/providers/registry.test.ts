import { describe, test, expect } from "bun:test";
import { getProvider } from "./registry.ts";

describe("getProvider", () => {
  test("returns metadata for academic + openalex", () => {
    const meta = getProvider("academic", "openalex");
    expect(meta).toBeDefined();
    expect(meta?.id).toBe("openalex");
    expect(meta?.freeTier).toBe(true);
    expect(meta?.requiresKey).toBe(false);
    expect(meta?.endpoint).toContain("api.openalex.org");
  });
});
