import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockReadAppConfig = vi.fn();
const mockWriteAppConfig = vi.fn();

// Mock config + csrf reads
vi.mock("@/lib/config", () => ({
  readAppConfig: mockReadAppConfig,
  writeAppConfig: mockWriteAppConfig,
}));

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(() => "test-csrf-token"),
}));

import { GET, PUT } from "@/app/api/providers/route";

describe("/api/providers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock setup
    mockReadAppConfig.mockReturnValue({
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "SECRET_KEY_SHOULD_NOT_LEAK", extra: { region: "us" } },
        "grammar": { provider: "languagetool" },
      },
    });
    mockWriteAppConfig.mockImplementation(() => {});
  });

  test("GET returns providers map", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.providers["fact-check"].provider).toBe("exa-search");
    expect(json.hasKey["fact-check"]).toBe(true);
    expect(json.hasKey["grammar"]).toBe(false);
  });

  test("GET masks apiKey — returns provider/extra/hasKey only", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();
    // apiKey MUST NOT appear anywhere in the response
    const bodyStr = JSON.stringify(json);
    expect(bodyStr).not.toContain("SECRET_KEY_SHOULD_NOT_LEAK");
    // But provider metadata is present
    expect(json.providers["fact-check"].provider).toBe("exa-search");
    expect(json.providers["fact-check"].extra.region).toBe("us");
    // hasKey flags tracking presence
    expect(json.hasKey["fact-check"]).toBe(true);
    expect(json.hasKey["grammar"]).toBe(false);
  });

  test("PUT accepts valid body with correct CSRF + localhost host", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/providers"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search", apiKey: "k" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
  });

  test("PUT rejects missing CSRF token", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/providers"), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search", apiKey: "k" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  test("PUT rejects wrong CSRF token", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/providers"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "wrong",
      },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search", apiKey: "k" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  test("PUT rejects non-localhost host", async () => {
    const req = new NextRequest(new URL("http://evil.com/api/providers"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search", apiKey: "k" }),
    });
    const res = await PUT(req);
    expect(res.status).toBe(403);
  });

  test("PUT preserves existing apiKey when body omits it", async () => {
    mockReadAppConfig.mockReturnValue({
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "keep-me" },
      },
    });

    const req = new NextRequest(new URL("http://localhost/api/providers"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search" }),
    });

    await PUT(req);

    expect(mockWriteAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          "fact-check": expect.objectContaining({
            apiKey: "keep-me",
          }),
        }),
      })
    );
  });

  test("PUT with empty apiKey string clears the key", async () => {
    mockReadAppConfig.mockReturnValue({
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "old-key" },
      },
    });

    const req = new NextRequest(new URL("http://localhost/api/providers"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search", apiKey: "" }),
    });

    await PUT(req);

    expect(mockWriteAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          "fact-check": expect.objectContaining({
            apiKey: undefined,
          }),
        }),
      })
    );
  });

  test("PUT with new apiKey overwrites existing", async () => {
    mockReadAppConfig.mockReturnValue({
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "old-key" },
      },
    });

    const req = new NextRequest(new URL("http://localhost/api/providers"), {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ skillId: "fact-check", provider: "exa-search", apiKey: "new-key" }),
    });

    await PUT(req);

    expect(mockWriteAppConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        providers: expect.objectContaining({
          "fact-check": expect.objectContaining({
            apiKey: "new-key",
          }),
        }),
      })
    );
  });
});
