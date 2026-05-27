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

test("Gemini grounded plagiarism report shows provider and source evidence", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.04,
    results: [{
      skillId: "plagiarism",
      name: "Plagiarism Check",
      score: 56,
      verdict: "warn",
      summary: "22% grounded similarity — 1 source matched",
      findings: [{
        severity: "warn",
        text: "4 words matched at https://example.com/source",
        quote: "[high confidence · exact] Exact copied sentence.",
        sources: [{ url: "https://example.com/source", title: "Source" }],
        confidence: "high",
      }],
      costUsd: 0.04,
      provider: "gemini-grounded-plagiarism",
    }],
  });

  expect(html).toContain("Gemini Grounded Plagiarism");
  expect(html).toContain("Google Gemini");
  expect(html).toContain("https://example.com/source");
  expect(html).toContain("Source");
});

test("Gemini grounded fact-check report shows provider and source evidence", () => {
  const html = generateReport({
    source: "article.md",
    wordCount: 800,
    totalCostUsd: 0.16,
    results: [{
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      score: 90,
      verdict: "warn",
      summary: "1 claims checked — 0 unsupported, 1 unverified (via gemini-grounded)",
      findings: [{
        severity: "warn",
        text: "Unverified (medium confidence): \"Claim\" — Needs more evidence",
        sources: [{ url: "https://example.com/evidence", title: "Evidence" }],
        confidence: "medium",
      }],
      costUsd: 0.04,
      provider: "gemini-grounded",
    }],
  });

  expect(html).toContain("Gemini Grounded");
  expect(html).toContain("Google Gemini");
  expect(html).toContain("https://example.com/evidence");
  expect(html).toContain("Evidence");
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
