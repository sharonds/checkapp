import { describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockReadAppConfig, mockGetMaskedConfig, mockGetApiKeyStatus } = vi.hoisted(() => ({
  mockReadAppConfig: vi.fn(),
  mockGetMaskedConfig: vi.fn(),
  mockGetApiKeyStatus: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  readAppConfig: mockReadAppConfig,
  getMaskedConfig: mockGetMaskedConfig,
  getApiKeyStatus: mockGetApiKeyStatus,
  writeAppConfig: vi.fn(),
}));

import { GET } from "@/app/api/config/route";

describe("GET /api/config", () => {
  test("rejects non-loopback reads", async () => {
    const req = new NextRequest(new URL("http://evil.example/api/config"));
    const res = await GET(req);
    expect(res.status).toBe(403);
  });

  test("does not leak nested provider API keys", async () => {
    mockReadAppConfig.mockReturnValue({ geminiApiKey: "TOP_LEVEL_SECRET" });
    mockGetMaskedConfig.mockReturnValue({
      geminiApiKey: "****CRET",
      providers: {
        "fact-check": { provider: "gemini-grounded", apiKey: "****CRET" },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      copyscape: false,
      exa: false,
      minimax: false,
      anthropic: false,
      parallel: false,
      openrouter: false,
      gemini: true,
    });

    const req = new NextRequest(new URL("http://localhost/api/config"));
    const res = await GET(req);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain("TOP_LEVEL_SECRET");
    expect(text).not.toContain("\"apiKey\":\"SECRET");
    expect(text).toContain("****CRET");
  });
});
