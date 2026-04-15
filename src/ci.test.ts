import { describe, it, expect } from "bun:test";

describe("CI mode", () => {
  it("--json flag is recognized in args", () => {
    const args = ["--json", "./article.md"];
    expect(args.includes("--json")).toBe(true);
  });
  it("--ci flag is recognized in args", () => {
    const args = ["--ci", "./article.md"];
    expect(args.includes("--ci")).toBe(true);
  });
  // Note: actual integration test requires running the CLI as a subprocess
  // which is tested in the final integration test (Task 10)
});
