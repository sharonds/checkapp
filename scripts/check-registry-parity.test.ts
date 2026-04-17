import { describe, test, expect } from "bun:test";
import { assertRegistryParity } from "./check-registry-parity";

describe("assertRegistryParity", () => {
  test("passes when registries have matching providers in same order per skill", () => {
    const a = {
      "fact-check": ["exa-search", "parallel"],
      grammar: ["languagetool"],
    };
    const b = {
      "fact-check": ["exa-search", "parallel"],
      grammar: ["languagetool"],
    };
    expect(() => assertRegistryParity(a, b)).not.toThrow();
  });

  test("fails when per-skill provider IDs are in different order", () => {
    const a = { "fact-check": ["exa-search", "parallel"] };
    const b = { "fact-check": ["parallel", "exa-search"] };
    expect(() => assertRegistryParity(a, b)).toThrow(/fact-check/);
  });

  test("fails when skill missing entirely in dashboard", () => {
    const a = {
      "fact-check": ["exa-search"],
      grammar: ["languagetool"],
    };
    const b = {
      "fact-check": ["exa-search"],
    };
    expect(() => assertRegistryParity(a, b)).toThrow(/grammar/);
  });

  test("fails when a provider is missing in dashboard", () => {
    const a = { "fact-check": ["exa-search", "parallel"] };
    const b = { "fact-check": ["exa-search"] };
    expect(() => assertRegistryParity(a, b)).toThrow();
  });
});
