// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SkillCard } from "../../components/skill-card";
import type { SkillResult } from "../../components/skill-card";

describe("SkillCard", () => {
  it("renders 'info' severity findings distinctly from 'warn'", () => {
    const result: SkillResult = {
      skillId: "tone",
      name: "Tone",
      verdict: "warn",
      score: 50,
      summary: "Test",
      costUsd: 0.01,
      findings: [
        { severity: "info", text: "hint" },
        { severity: "warn", text: "issue" },
      ],
    };

    const { container } = render(<SkillCard result={result} />);
    const infoFinding = container.querySelector('[data-severity="info"]');
    const warnFinding = container.querySelector('[data-severity="warn"]');
    expect(infoFinding).toBeDefined();
    expect(warnFinding).toBeDefined();
    expect(infoFinding?.textContent).toContain("hint");
    expect(warnFinding?.textContent).toContain("issue");
  });

  it("renders the stored provider label when available", () => {
    const result: SkillResult = {
      skillId: "ai-detection",
      name: "AI Detection",
      verdict: "pass",
      score: 95,
      summary: "5% AI probability",
      costUsd: 0.01,
      provider: "gemini-ai-detection",
      findings: [],
    };

    const { getByText, queryByText } = render(<SkillCard result={result} />);
    expect(getByText("Gemini 3 Pro Preview (multilingual)")).toBeDefined();
    expect(queryByText("Copyscape")).toBeNull();
  });

  it("renders Gemini grounded label for standard fact-check results", () => {
    const result: SkillResult = {
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      verdict: "pass",
      score: 100,
      summary: "1 claims checked",
      costUsd: 0.04,
      provider: "gemini-grounded",
      findings: [],
    };

    const { getByText, queryByText } = render(<SkillCard result={result} />);
    expect(getByText("Gemini 3.1 Pro + Google Search")).toBeDefined();
    expect(queryByText("gemini-grounded")).toBeNull();
  });

  it("localizes audit skill name, location, and rewrite for Hebrew findings", () => {
    const result: SkillResult = {
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      verdict: "fail",
      score: 50,
      summary: "issue",
      costUsd: 0.04,
      provider: "gemini-grounded",
      findings: [{
        severity: "error",
        text: "בעיה",
        quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
        rewrite: "יש לכתוב: המשחק Rummikub מתאים ל-2 עד 4 שחקנים.",
        explanationLanguage: "he",
        location: {
          sectionId: "section-1",
          sectionTitle: "משחקים",
          paragraphIndex: 1,
          sentenceIndex: 0,
          startOffset: 86,
          endOffset: 129,
        },
      }],
    };

    const { getByText } = render(<SkillCard result={result} coverage={{ claimsChecked: 1, claimsSkipped: 2 }} />);
    expect(getByText("בדיקת עובדות מבוססת מקורות")).toBeDefined();
    expect(getByText("1 טענות נבדקו — 0 לא נתמכו, 0 לא אומתו, 2 דולגו (באמצעות gemini-grounded)")).toBeDefined();
    expect(getByText("מיקום: משחקים · פסקה 2 · משפט 1 · תווים 86-129")).toBeDefined();
    expect(getByText("ניסוח מוצע")).toBeDefined();
    expect(getByText("יש לכתוב: המשחק Rummikub מתאים ל-2 עד 4 שחקנים.")).toBeDefined();
  });

  it("localizes Hebrew audit issue lead instead of showing raw English producer text", () => {
    const result: SkillResult = {
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      verdict: "fail",
      score: 50,
      summary: "issue",
      costUsd: 0.04,
      findings: [{
        severity: "error",
        text: "Unsupported (high confidence): \"טענה\" — המקור סותר.",
        status: "unsupported",
        confidence: "high",
        explanation: "המקור סותר.",
        explanationLanguage: "he",
      }],
    };

    const { getByText, queryByText } = render(<SkillCard result={result} locale="he" />);
    expect(getByText(/לא נתמך/)).toBeDefined();
    expect(queryByText(/Unsupported/)).toBeNull();
  });

  it("uses logical quote border and padding classes for RTL report cards", () => {
    const result: SkillResult = {
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      verdict: "fail",
      score: 50,
      summary: "issue",
      costUsd: 0.04,
      findings: [{
        severity: "error",
        text: "בעיה",
        quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
        explanationLanguage: "he",
      }],
    };

    const { container } = render(<SkillCard result={result} />);
    const quote = container.querySelector("blockquote");
    expect(quote?.className).toContain("border-s-2");
    expect(quote?.className).toContain("ps-2");
    expect(quote?.className).not.toContain("border-l-2");
    expect(quote?.className).not.toContain("pl-2");
  });

  it("labels fuzzy locations as approximate", () => {
    const result: SkillResult = {
      skillId: "fact-check-grounded",
      name: "Fact Check (Grounded)",
      verdict: "fail",
      score: 50,
      summary: "issue",
      costUsd: 0.04,
      findings: [{
        severity: "error",
        text: "Issue",
        location: {
          sectionId: "section-1",
          sectionTitle: "Games",
          paragraphIndex: 0,
          sentenceIndex: 0,
          matchQuality: "fuzzy",
        } as any,
      }],
    };

    const { getByText } = render(<SkillCard result={result} locale="en" />);
    expect(getByText("Approximate location: Games · paragraph 1 · sentence 1")).toBeDefined();
  });
});
