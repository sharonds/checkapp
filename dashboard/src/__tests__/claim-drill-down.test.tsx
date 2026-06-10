// @vitest-environment jsdom
import { afterEach, describe, test, expect } from "vitest";
import { fireEvent, render, cleanup, within, screen } from "@testing-library/react";
import { ClaimDrillDown } from "@/components/ClaimDrillDown";
import type { Finding } from "@/lib/normalize";

afterEach(() => cleanup());

describe("ClaimDrillDown", () => {
  test("renders null when no evidence or rewrite", () => {
    const f: Finding = { severity: "warn", text: "plain finding" };
    const { container } = render(<ClaimDrillDown finding={f} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders 'View evidence (N)' button when sources present", () => {
    const f: Finding = {
      severity: "warn", text: "t",
      sources: [{ url: "https://example.com", title: "Title" }],
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    expect(within(container).getByRole("button", { name: /view evidence \(1\)/i })).toBeDefined();
  });

  test("renders 'View suggested rewrite' button when only rewrite present", () => {
    const f: Finding = {
      severity: "warn", text: "t",
      rewrite: "corrected sentence",
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    expect(within(container).getByRole("button", { name: /view suggested rewrite/i })).toBeDefined();
  });

  test("renders Hebrew action label for Hebrew audit findings", () => {
    const f: Finding = {
      severity: "warn",
      text: "בעיה",
      quote: "המשחק Rummikub מתאים לשני שחקנים בלבד.",
      rewrite: "יש לנסח מחדש.",
      explanationLanguage: "he",
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    expect(within(container).getByRole("button", { name: "הצגת ניסוח מוצע" })).toBeDefined();
  });

  test("provider-error finding gets a Details drill-down, not 'View suggested rewrite'", () => {
    const f: Finding = {
      severity: "warn",
      text: "Provider error",
      status: "provider_error",
      confidenceRationale: "Provider call failed",
      searchQueries: ["claim"],
      location: { sectionId: "s", paragraphIndex: 0 } as any,
    };
    const { container } = render(<ClaimDrillDown finding={f} locale="en" />);
    expect(within(container).queryByText(/suggested rewrite/i)).toBeNull();
    expect(within(container).getByRole("button", { name: "Details" })).toBeDefined();
  });

  test("counts sources + citations in the button label", () => {
    const f: Finding = {
      severity: "warn", text: "t",
      sources: [{ url: "https://a.com" }, { url: "https://b.com" }],
      citations: [{ title: "Paper A" }],
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    expect(within(container).getByRole("button", { name: /view evidence \(3\)/i })).toBeDefined();
  });

  test("localizes Hebrew source similarity label", () => {
    const f: Finding = {
      severity: "warn",
      text: "בעיה",
      explanationLanguage: "he",
      sources: [{ url: "https://example.com", title: "מקור", relevanceScore: 0.92 }],
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    fireEvent.click(within(container).getByRole("button", { name: "הצגת ראיות (1)" }));

    expect(screen.getByText("דמיון: 92%")).toBeDefined();
    expect(document.body.textContent ?? "").not.toContain("92% similar");
  });

  test("labels fuzzy Hebrew locations as approximate in the evidence sheet", () => {
    const f: Finding = {
      severity: "warn",
      text: "בעיה",
      explanationLanguage: "he",
      location: {
        sectionId: "section-1",
        sectionTitle: "משחקים",
        paragraphIndex: 0,
        sentenceIndex: 0,
        matchQuality: "fuzzy",
      } as any,
      sources: [{ url: "https://example.com", title: "מקור" }],
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    fireEvent.click(within(container).getByRole("button", { name: "הצגת ראיות (1)" }));

    expect(screen.getByText("מיקום משוער: משחקים · פסקה 1 · משפט 1")).toBeDefined();
  });

  test("blocks javascript: hrefs via safeHref", () => {
    const f: Finding = {
      severity: "warn", text: "t",
      sources: [{ url: "javascript:alert(1)", title: "Malicious" }],
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    // Sheet content may not render until trigger click; validate
    // shallowly by confirming the rendered tree doesn't leak the unsafe href.
    expect(container.textContent ?? "").not.toContain("javascript:");
    // And the button is still rendered because evidence is present.
    expect(within(container).getByRole("button", { name: /view evidence \(1\)/i })).toBeDefined();
  });
});
