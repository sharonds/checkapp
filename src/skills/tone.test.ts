import { test, expect } from "bun:test";
import { buildTonePrompt } from "./tone.ts";

test("buildTonePrompt includes both the article and tone guide", () => {
  const prompt = buildTonePrompt("Article text here.", "Be conversational and warm.");
  expect(prompt).toContain("Article text here");
  expect(prompt).toContain("Be conversational and warm");
});

test("buildTonePrompt requests JSON output", () => {
  const prompt = buildTonePrompt("text", "guide");
  expect(prompt.toLowerCase()).toContain("json");
});
