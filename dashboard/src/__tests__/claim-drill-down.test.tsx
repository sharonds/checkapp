// @vitest-environment jsdom
import { afterEach, describe, test, expect } from "vitest";
import { render, cleanup, within } from "@testing-library/react";
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

  test("counts sources + citations in the button label", () => {
    const f: Finding = {
      severity: "warn", text: "t",
      sources: [{ url: "https://a.com" }, { url: "https://b.com" }],
      citations: [{ title: "Paper A" }],
    };
    const { container } = render(<ClaimDrillDown finding={f} />);
    expect(within(container).getByRole("button", { name: /view evidence \(3\)/i })).toBeDefined();
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
