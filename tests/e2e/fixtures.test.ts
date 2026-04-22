import { describe, it, expect } from "bun:test";
import { loadScenario, type Scenario } from "../../src/e2e/fixtures.ts";

const SCENARIO_NAMES = [
  "basic-happy",
  "standard-happy",
  "premium-pending",
  "premium-completed",
  "premium-failed",
  "settings-default-off",
] as const;

describe("scenario fixtures", () => {
  for (const name of SCENARIO_NAMES) {
    it(`${name} loads and validates`, () => {
      const s = loadScenario(name);
      expect(s.name).toBe(name);
      expect(["basic", "standard", "premium"]).toContain(s.tier);
      expect(typeof s.flagOn).toBe("boolean");
      expect(typeof s.article).toBe("string");
      expect(s.providers).toBeDefined();
      expect(s.expect).toBeDefined();
    });
  }

  it("basic-happy provides minimax + exa + geminiChat stubs", () => {
    const s = loadScenario("basic-happy");
    expect(s.providers.minimax?.text).toBeTruthy();
    expect(s.providers.exa?.results.length).toBeGreaterThan(0);
    expect(s.providers.geminiChat?.text).toBeTruthy();
  });

  it("standard-happy provides grounded claims with sources", () => {
    const s = loadScenario("standard-happy");
    expect(s.providers.geminiGrounded?.claims.length).toBeGreaterThan(0);
    for (const c of s.providers.geminiGrounded!.claims) {
      expect(c.sources.length).toBeGreaterThan(0);
    }
  });

  it("premium-pending returns exactly one in_progress poll state", () => {
    const s = loadScenario("premium-pending");
    expect(s.providers.deepResearch?.pollStates).toEqual([{ status: "in_progress" }]);
  });

  it("premium-completed has an in_progress then completed transition", () => {
    const s = loadScenario("premium-completed");
    const states = s.providers.deepResearch!.pollStates;
    expect(states[0]?.status).toBe("in_progress");
    expect(states[states.length - 1]?.status).toBe("completed");
    expect(states[states.length - 1]?.outputs?.[0]?.text).toContain("Deep Audit Report");
  });

  it("premium-failed first poll returns failed with error message", () => {
    const s = loadScenario("premium-failed");
    const first = s.providers.deepResearch!.pollStates[0];
    expect(first?.status).toBe("failed");
    expect(first?.error).toBeTruthy();
  });

  it("settings-default-off carries tier=basic and flagOn=false", () => {
    const s = loadScenario("settings-default-off");
    expect(s.tier).toBe("basic");
    expect(s.flagOn).toBe(false);
  });

  it("fixture typing round-trips", () => {
    const s: Scenario = loadScenario("basic-happy");
    // Narrowing only — ensures Scenario type exports stay compatible.
    expect(s.tier).toBeDefined();
  });
});
