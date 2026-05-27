import { describe, expect, test } from "vitest";
import { generateHtml, generateMarkdown } from "@/components/export-buttons";

const baseReport = {
  source: "<img src=x onerror=alert(1)>",
  score: 72,
  verdict: "warn",
  wordCount: 1200,
  totalCost: 0.04,
  createdAt: "2026-05-27T12:00:00.000Z",
  results: [{
    name: "Fact Check",
    score: 72,
    verdict: "warn",
    summary: "<script>alert(1)</script>",
    provider: "gemini-grounded",
    findings: [{
      severity: "warn",
      text: "Potential issue <img src=x onerror=alert(1)>",
      quote: "<b>unsafe quote</b>",
      confidence: "medium",
      sources: [
        { title: "Safe Source", url: "https://example.com/source" },
        { title: "Bad](javascript:alert(1)) [ok", url: "https://example.com/injected" },
        { title: "Unsafe Source", url: "javascript:alert(1)" },
      ],
    }],
    costUsd: 0.04,
  }],
};

describe("dashboard report exports", () => {
  test("HTML export escapes report content and links only safe source URLs", () => {
    const html = generateHtml(baseReport);

    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:alert(1)"');
  });

  test("Markdown export renders safe source URLs as links", () => {
    const md = generateMarkdown(baseReport);

    expect(md).toContain("Source: [Safe Source](https://example.com/source)");
    expect(md).toContain("Source: [Bad\\](javascript:alert(1)) \\[ok](https://example.com/injected)");
    expect(md).toContain("Source: Unsafe Source");
    expect(md).not.toMatch(/[^\\]\]\(javascript:alert\(1\)\)/);
  });

  test("exports all-skipped reports with N/A score", () => {
    const md = generateMarkdown({ ...baseReport, score: null, verdict: "skipped" });
    const html = generateHtml({ ...baseReport, score: null, verdict: "skipped" });

    expect(md).toContain("**Score:** N/A (SKIPPED)");
    expect(html).toContain("<strong>Score:</strong> N/A (SKIPPED)");
  });
});
