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
    expect(getByText("Gemini 3 Pro Preview + Google Search")).toBeDefined();
    expect(queryByText("gemini-grounded")).toBeNull();
  });
});
