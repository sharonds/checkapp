import { test, expect } from "bun:test";
import { buildLegalPrompt } from "./legal.ts";

test("buildLegalPrompt includes the article text", () => {
  const prompt = buildLegalPrompt("We guarantee 100% results.");
  expect(prompt).toContain("We guarantee 100% results");
});

test("buildLegalPrompt includes suggestion field in schema", () => {
  const prompt = buildLegalPrompt("text");
  expect(prompt).toContain('"suggestion"');
});

test("buildLegalPrompt mentions key risk categories", () => {
  const prompt = buildLegalPrompt("text");
  expect(prompt).toContain("health claim");
  expect(prompt).toContain("defamat");
});

test("includes legal policy in prompt when provided", () => {
  const prompt = buildLegalPrompt("test article", "Never make health claims without FDA approval");
  expect(prompt).toContain("COMPANY LEGAL POLICY");
  expect(prompt).toContain("FDA approval");
});

test("omits legal policy section when not provided", () => {
  const prompt = buildLegalPrompt("test article");
  expect(prompt).not.toContain("COMPANY LEGAL POLICY");
});
