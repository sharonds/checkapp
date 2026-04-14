import { test, expect } from "bun:test";
import { buildSummaryPrompt } from "./summary.ts";

test("buildSummaryPrompt includes the article text", () => {
  const prompt = buildSummaryPrompt("AI is transforming healthcare delivery.");
  expect(prompt).toContain("AI is transforming healthcare delivery.");
});

test("buildSummaryPrompt truncates text to 4000 chars", () => {
  const longText = "x".repeat(5000);
  const prompt = buildSummaryPrompt(longText);
  // The article section should contain exactly 4000 x's, not 5000
  const articleSection = prompt.split("ARTICLE:\n")[1];
  expect(articleSection).not.toContain("x".repeat(4001));
});

test("buildSummaryPrompt asks for the four expected fields", () => {
  const prompt = buildSummaryPrompt("text");
  expect(prompt).toContain('"topic"');
  expect(prompt).toContain('"argument"');
  expect(prompt).toContain('"audience"');
  expect(prompt).toContain('"tone"');
});

test("buildSummaryPrompt lists valid tone values", () => {
  const prompt = buildSummaryPrompt("text");
  expect(prompt).toContain("informational");
  expect(prompt).toContain("persuasive");
  expect(prompt).toContain("conversational");
  expect(prompt).toContain("technical");
  expect(prompt).toContain("promotional");
});
