import { describe, expect, test } from "vitest";
import { generateHtml, generateMarkdown } from "@/components/export-buttons";

const baseReport = {
  source: "https://user:secret@example.com/article?token=abc&utm_source=x#access_token=frag-secret",
  score: 72,
  verdict: "warn",
  wordCount: 1200,
  totalCost: 0.04,
  createdAt: "2026-05-27T12:00:00.000Z",
  results: [{
    skillId: "fact-check-grounded",
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
      confidenceRationale: "Only partial evidence.",
      rewrite: "Use safer wording.",
      searchQueries: ["unsafe claim"],
      location: {
        sectionId: "section-1",
        sectionTitle: "Intro",
        paragraphIndex: 0,
        sentenceIndex: 0,
        startOffset: 4,
        endOffset: 22,
      },
      sources: [
        { title: "Safe Source", url: "https://example.com/source" },
        { title: "Bad](javascript:alert(1)) [ok", url: "https://example.com/injected" },
        { title: "Userinfo Source", url: "https://trusted.com:secret@evil.example/path?api_key=secret&utm_source=x" },
        { title: "Fragment Source", url: "https://example.com/fragment#access_token=frag-secret" },
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
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("https://example.com/article?token=%5Bredacted%5D&amp;utm_source=x#access_token=%5Bredacted%5D");
    expect(html).toContain('href="https://example.com/source"');
    expect(html).toContain('href="https://evil.example/path?api_key=%5Bredacted%5D&amp;utm_source=x"');
    expect(html).toContain('href="https://example.com/fragment#access_token=%5Bredacted%5D"');
    expect(html).not.toContain("trusted.com:secret@evil.example");
    expect(html).not.toContain("api_key=secret");
    expect(html).not.toContain("token=abc");
    expect(html).not.toContain("frag-secret");
    expect(html).not.toContain("user:secret");
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).not.toContain('href="javascript:alert(1)"');
    expect(html).not.toContain('href="data:');
    expect(html).not.toContain('href="vbscript:');
    expect(html).not.toContain('href="file:');
  });

  test("Markdown export renders safe source URLs as links", () => {
    const md = generateMarkdown({
      ...baseReport,
      auditLanguage: "en",
      results: [{
        ...baseReport.results[0],
        findings: [{
          ...baseReport.results[0].findings[0],
          confidence: "high",
        }],
      }],
      auditCoverage: {
        claimsChecked: 1,
        claimsSkipped: 2,
      },
    });

    expect(md).toContain("1 claims checked — 0 unsupported, 0 unverified, 2 skipped");
    expect(md).toContain("Location: Intro · paragraph 1 · sentence 1 · chars 4-22");
    expect(md).toContain("Confidence: high");
    expect(md).toContain("Confidence rationale: Only partial evidence.");
    expect(md).not.toContain("Confidence rationale: high");
    expect(md).toContain("Search: unsafe claim");
    expect(md).toContain("Suggested rewrite: Use safer wording.");
    expect(md).toContain("Source: [Safe Source](https://example.com/source)");
    expect(md).toContain("Source: [Bad\\](javascript:alert(1)) \\[ok](https://example.com/injected)");
    expect(md).toContain("Source: [Userinfo Source](https://evil.example/path?api_key=%5Bredacted%5D&utm_source=x)");
    expect(md).toContain("Source: [Fragment Source](https://example.com/fragment#access_token=%5Bredacted%5D)");
    expect(md).not.toContain("trusted.com:secret@evil.example");
    expect(md).not.toContain("api_key=secret");
    expect(md).not.toContain("token=abc");
    expect(md).not.toContain("frag-secret");
    expect(md).not.toContain("user:secret");
    expect(md).not.toMatch(/[^\\]\]\(javascript:alert\(1\)\)/);
  });

  test("HTML and Markdown exports do not link unsafe source URLs", () => {
    const report = {
      ...baseReport,
      results: [{
        ...baseReport.results[0],
        findings: [{
          ...baseReport.results[0].findings[0],
          sources: [{ title: "Unsafe Source", url: "javascript:alert(1)" }],
        }],
      }],
    };

    expect(generateHtml(report)).not.toContain('href="javascript:alert(1)"');
    expect(generateMarkdown(report)).toContain("Source: Unsafe Source");
  });

  test("exports all-skipped reports with N/A score", () => {
    const md = generateMarkdown({ ...baseReport, score: null, verdict: "skipped" });
    const html = generateHtml({ ...baseReport, score: null, verdict: "skipped" });

    expect(md).toContain("**Score:** N/A (SKIPPED)");
    expect(html).toContain("<strong>Score:</strong> N/A (SKIPPED)");
  });

  test("HTML export localizes Hebrew audit labels and keeps quote direction automatic", () => {
    const html = generateHtml({
      ...baseReport,
      source: "he.md",
      auditLanguage: "he",
      auditDirection: "rtl",
      results: [{
        name: "Fact Check (Grounded)",
        score: 50,
        verdict: "fail",
        summary: "issue",
        provider: "gemini-grounded",
        findings: [{
          severity: "warn",
          text: "בעיה",
          quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
          rewrite: "יש לנסח מחדש.",
          confidence: "high",
          confidenceRationale: "המקור הרשמי סותר את הטענה.",
          location: {
            sectionId: "section-1",
            sectionTitle: "משחקים",
            paragraphIndex: 1,
            sentenceIndex: 0,
            startOffset: 86,
            endOffset: 129,
          },
          sources: [{ title: "Rummikub official rules", url: "https://example.com/rummikub" }],
        }],
        costUsd: 0.04,
      }],
    });

    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain("דוח איכות");
    expect(html).toContain("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 86-129");
    expect(html).toContain("רמת ביטחון: גבוהה");
    expect(html).toContain("נימוק רמת הביטחון: המקור הרשמי סותר את הטענה.");
    expect(html).not.toContain("נימוק רמת הביטחון: high");
    expect(html).toContain("ניסוח מוצע");
    expect(html).toContain('<blockquote dir="auto">');
    expect(html).not.toContain("Article Check Report");
  });

  test("Markdown export localizes Hebrew report labels and issue lead", () => {
    const md = generateMarkdown({
      ...baseReport,
      source: "he.md",
      auditLanguage: "he",
      auditDirection: "rtl",
      results: [{
        skillId: "fact-check-grounded",
        name: "Fact Check (Grounded)",
        score: 50,
        verdict: "fail",
        summary: "issue",
        provider: "gemini-grounded",
        findings: [{
          severity: "error",
          text: "Unsupported (high confidence): \"טענה\" — המקור סותר.",
          status: "unsupported",
          confidence: "high",
          explanation: "המקור סותר.",
          explanationLanguage: "he",
          sources: [{ title: "מקור רשמי", url: "https://example.com/source" }],
        }],
        costUsd: 0.04,
      }],
    });

    expect(md).toContain("# דוח איכות");
    expect(md).toContain("**מקור:** he.md");
    expect(md).toContain("**ציון:** 72/100");
    expect(md).toContain("### ממצאים");
    expect(md).toContain("לא נתמך");
    expect(md).toContain("רמת ביטחון: גבוהה");
    expect(md).not.toContain("Unsupported");
    expect(md).toContain("מקור: [מקור רשמי](https://example.com/source)");
  });

  test("Hebrew Markdown export localizes plagiarism issue leads", () => {
    const md = generateMarkdown({
      ...baseReport,
      source: "he-plagiarism.md",
      auditLanguage: "he",
      auditDirection: "rtl",
      results: [{
        skillId: "plagiarism",
        name: "Plagiarism Check",
        score: 40,
        verdict: "fail",
        summary: "22% grounded similarity",
        provider: "gemini-grounded-plagiarism",
        findings: [{
          severity: "error",
          text: "12 words matched at https://example.com/source",
          status: "plagiarism_match",
          confidence: "high",
          explanation: "התאמה מילולית למקור חיצוני.",
          explanationLanguage: "he",
          sources: [{ title: "מקור", url: "https://example.com/source" }],
        }],
        costUsd: 0.04,
      }],
    });

    expect(md).toContain("חשד להעתקה");
    expect(md).toContain("רמת ביטחון: גבוהה");
    expect(md).not.toContain("words matched");
  });

  test("exports fuzzy locations with approximate labels", () => {
    const report = {
      ...baseReport,
      results: [{
        ...baseReport.results[0],
        findings: [{
          ...baseReport.results[0].findings[0],
          location: {
            sectionId: "section-1",
            sectionTitle: "Games",
            paragraphIndex: 0,
            sentenceIndex: 0,
            matchQuality: "fuzzy",
          } as any,
        }],
      }],
    };

    expect(generateMarkdown(report)).toContain("Approximate location: Games · paragraph 1 · sentence 1");
    expect(generateHtml(report)).toContain("Approximate location: Games · paragraph 1 · sentence 1");
  });

  test("exports tolerate tampered text and numeric fields", () => {
    const tampered = {
      ...baseReport,
      source: null as unknown as string,
      wordCount: null as unknown as number,
      totalCost: null as unknown as number,
      verdict: null as unknown as string,
      results: [{
        ...baseReport.results[0],
        name: 123 as unknown as string,
        score: null as unknown as number,
        summary: null as unknown as string,
        costUsd: null as unknown as number,
        findings: [{
          ...baseReport.results[0].findings[0],
          text: null as unknown as string,
          quote: 123 as unknown as string,
          confidence: null as unknown as string,
          sources: [{ title: null as unknown as string, url: "https://example.com" }],
        }],
      }],
    };

    const html = generateHtml(tampered);
    const md = generateMarkdown(tampered);
    expect(html).toContain("Quality Report");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain("<strong>API cost:</strong> N/A");
    expect(html).toContain("<strong>Cost:</strong> N/A");
    expect(md).toContain("**Total Cost:** N/A");
    expect(md).toContain("- **Cost:** N/A");
    expect(md).toContain("- **Score:** N/A (WARN)");
  });
});
