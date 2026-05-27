import { test, expect } from "bun:test";
import { generateReport } from "./report.ts";
import type { SkillResult } from "./skills/types.ts";

const results: SkillResult[] = [
  { skillId: "seo", name: "SEO", score: 85, verdict: "pass", summary: "Good SEO", findings: [], costUsd: 0 },
  { skillId: "plagiarism", name: "Plagiarism", score: 70, verdict: "warn", summary: "33% similarity", findings: [
    { severity: "warn", text: "76 words matched at ynet.co.il", quote: "ויטמין C הוא תרכובת אורגנית..." }
  ], costUsd: 0.09 },
];

test("generateReport returns a string of HTML", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).toContain("<!DOCTYPE html>");
  expect(html).toContain("<html");
});

test("report contains skill names", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).toContain("SEO");
  expect(html).toContain("Plagiarism");
});

test("report contains the source filename", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).toContain("article.md");
});

test("report is self-contained (no external JS scripts)", () => {
  const html = generateReport({ source: "article.md", wordCount: 800, results, totalCostUsd: 0.09 });
  expect(html).not.toMatch(/<script src=/);
});

test("report labels Gemini AI Detection and discloses Google Gemini when used", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.01,
    results: [{
      skillId: "ai-detection",
      name: "AI Detection",
      score: 90,
      verdict: "pass",
      summary: "10% AI probability — human",
      findings: [],
      costUsd: 0.01,
      provider: "gemini-ai-detection",
    }],
  });

  expect(html).toContain("Gemini AI Detection");
  expect(html).toContain("https://ai.google.dev");
  expect(html).toContain("Google Gemini");
  expect(html).not.toContain("https://copyscape.com");
});

test("Copyscape AI Detection report does not disclose Google Gemini", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.03,
    results: [{
      skillId: "ai-detection",
      name: "AI Detection",
      score: 90,
      verdict: "pass",
      summary: "10% AI probability — human",
      findings: [],
      costUsd: 0.03,
      provider: "copyscape",
    }],
  });

  expect(html).toContain("https://copyscape.com");
  expect(html).toContain("Copyscape");
  expect(html).not.toContain("https://ai.google.dev");
  expect(html).not.toContain("Google Gemini");
});

test("SEO-only report does not disclose third-party processors", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [{
      skillId: "seo",
      name: "SEO",
      score: 90,
      verdict: "pass",
      summary: "Good SEO",
      findings: [],
      costUsd: 0,
    }],
  });

  expect(html).not.toContain("https://copyscape.com");
  expect(html).not.toContain("https://exa.ai");
  expect(html).not.toContain("https://platform.minimax.io");
  expect(html).not.toContain("third-party APIs");
});

test("all-skipped report is not marked ready to publish", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [{
      skillId: "ai-detection",
      name: "AI Detection",
      score: 0,
      verdict: "skipped",
      summary: "AI detection skipped",
      findings: [],
      costUsd: 0,
      provider: "copyscape",
    }],
  });

  expect(html).toContain("Not assessed");
  expect(html).toContain("N/A");
  expect(html).not.toContain("0/100");
  expect(html).not.toContain("Ready to publish");
});

test("empty report is not marked ready to publish", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [],
  });

  expect(html).toContain("Not assessed");
  expect(html).toContain("N/A");
  expect(html).not.toContain("Ready to publish");
});

test("passing report is marked ready for review, not guaranteed publishable", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0,
    results: [{
      skillId: "seo",
      name: "SEO",
      score: 90,
      verdict: "pass",
      summary: "Good SEO",
      findings: [],
      costUsd: 0,
    }],
  });

  expect(html).toContain("Ready for review");
  expect(html).not.toContain("Ready to publish");
});
