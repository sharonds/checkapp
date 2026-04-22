// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import CheckPage from "@/app/check/page";
import { fetchWithCsrf } from "@/lib/fetch-with-csrf";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === "string" ? href : "#"} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/components/footer-bar", () => ({
  FooterBar: () => <div data-testid="footer-bar" />,
}));

vi.mock("@/components/skill-card", () => ({
  SkillCard: ({ result }: { result: { skillId: string } }) => (
    <div data-testid={`skill-card-${result.skillId}`} />
  ),
}));

vi.mock("@/components/tag-input", () => ({
  TagInput: () => <div data-testid="tag-input" />,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/fetch-with-csrf", () => ({
  fetchWithCsrf: vi.fn(),
}));

const mockFetchWithCsrf = vi.mocked(fetchWithCsrf);

describe("Check Page", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 321 }),
    } as Response);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 321,
        results: [],
        overallScore: 87,
      }),
    }) as typeof fetch;
  });

  test("fetches the created check by id after POST", async () => {
    render(<CheckPage />);

    fireEvent.change(screen.getByPlaceholderText(/paste your article text here/i), {
      target: { value: "Short article text." },
    });
    fireEvent.click(screen.getByRole("button", { name: /run check/i }));

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        "/api/checks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            text: "Short article text.",
            source: "paste",
            tags: [],
          }),
        })
      );
    });

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith("/api/checks/321");
    });

    expect(
      (await screen.findByRole("link", { name: /view full report/i })).getAttribute("href")
    ).toBe("/reports/321");
  });

  test("keeps the URL tab visible but unavailable", async () => {
    render(<CheckPage />);

    const urlTab = screen.getByRole("tab", { name: /paste url/i });
    expect(urlTab.getAttribute("data-disabled")).toBe("");

    expect(
      screen.getByText("URL import is not available yet. Paste the article text directly for now.")
    ).toBeDefined();
    expect(mockFetchWithCsrf).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
