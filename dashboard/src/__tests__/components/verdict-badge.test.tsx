// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { VerdictBadge } from "../../components/verdict-badge";

describe("VerdictBadge", () => {
  it("renders PASS", () => {
    render(<VerdictBadge verdict="pass" />);
    expect(screen.getByText("PASS")).toBeDefined();
  });
  it("renders FAIL", () => {
    render(<VerdictBadge verdict="fail" />);
    expect(screen.getByText("FAIL")).toBeDefined();
  });
  it("renders WARN", () => {
    render(<VerdictBadge verdict="warn" />);
    expect(screen.getByText("WARN")).toBeDefined();
  });
});
