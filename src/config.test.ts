import { describe, expect, it } from "bun:test";
import { readConfig } from "./config.ts";

describe("readConfig", () => {
  it("DEFAULT_SKILLS lists grammar, academic, and selfPlagiarism (disabled by default)", () => {
    const cfg = readConfig();
    expect(cfg.skills).toHaveProperty("grammar", false);
    expect(cfg.skills).toHaveProperty("academic", false);
    expect(cfg.skills).toHaveProperty("selfPlagiarism", false);
  });
});
