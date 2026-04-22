// @vitest-environment jsdom
import type { AnchorHTMLAttributes } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import SettingsPage from "@/app/settings/page";
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

vi.mock("@/components/loading-skeleton", () => ({
  LoadingSkeleton: () => <div data-testid="loading-skeleton" />,
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

describe("Settings Page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        config: {
          llmProvider: "gemini",
          factCheckTier: "basic",
          factCheckTierFlag: false,
          thresholds: {},
        },
        apiKeys: {
          copyscape: false,
          exa: true,
          minimax: true,
          anthropic: false,
          parallel: false,
          openrouter: false,
          gemini: true,
        },
        capabilities: {
          geminiKeyConfigured: true,
        },
      }),
    }) as typeof fetch;

    mockFetchWithCsrf.mockResolvedValue({
      ok: true,
    } as Response);
  });

  test("shows all fact-check tiers and persists tier changes with routing flag", async () => {
    render(<SettingsPage />);

    expect(await screen.findByRole("radio", { name: /basic/i })).toBeDefined();
    expect(screen.getByRole("radio", { name: /standard \(recommended\)/i })).toBeDefined();
    expect(screen.getByRole("radio", { name: /deep audit \(async, ~10 min\)/i })).toBeDefined();

    const deepAudit = screen.getByRole("radio", { name: /deep audit \(async, ~10 min\)/i });
    expect(deepAudit.hasAttribute("disabled")).toBe(false);

    fireEvent.click(deepAudit);

    await waitFor(() => {
      expect(mockFetchWithCsrf).toHaveBeenCalledWith(
        "/api/config",
        expect.objectContaining({
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ factCheckTier: "premium", factCheckTierFlag: true }),
        }),
      );
    });
  });
});
