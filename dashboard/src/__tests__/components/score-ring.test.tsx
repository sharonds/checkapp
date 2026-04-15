// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ScoreRing } from "../../components/score-ring";

describe("ScoreRing", () => {
  it("renders the score number", () => {
    render(<ScoreRing score={75} verdict="pass" />);
    expect(screen.getByText("75")).toBeDefined();
  });
  it("renders with different verdicts", () => {
    const { rerender } = render(<ScoreRing score={40} verdict="fail" />);
    expect(screen.getByText("40")).toBeDefined();
    rerender(<ScoreRing score={65} verdict="warn" />);
    expect(screen.getByText("65")).toBeDefined();
  });
});
