import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const { mockReadAppConfig, mockGetApiKeyStatus } = vi.hoisted(() => ({
  mockReadAppConfig: vi.fn(),
  mockGetApiKeyStatus: vi.fn(),
}));

vi.mock("@/lib/config", () => ({
  readAppConfig: mockReadAppConfig,
  writeAppConfig: vi.fn(() => {}),
  getApiKeyStatus: mockGetApiKeyStatus,
}));

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(() => "test-csrf-token"),
}));

import { GET, POST } from "@/app/api/skills/route";

describe("/api/skills", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default mock: tone with anthropic, seo enabled
    mockReadAppConfig.mockReturnValue({
      skills: { tone: true, seo: true },
      providers: {
        tone: { provider: "anthropic", apiKey: "k" },
        seo: { provider: "seo-analyzer", apiKey: "" },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: true,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: false,
      gemini: false,
    });
  });

  test("GET returns skills with provider-aware readiness (tone ready w/ anthropic)", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await res.json();

    // tone should be ready because anthropic is one of its supported providers and key is configured
    const toneSkill = json.find((s: any) => s.id === "tone");
    expect(toneSkill).toBeDefined();
    expect(toneSkill.enabled).toBe(true);
    expect(toneSkill.ready).toBe(true); // Ready because anthropic is supported and configured

    // seo should be ready (no keys required)
    const seoSkill = json.find((s: any) => s.id === "seo");
    expect(seoSkill.enabled).toBe(true);
    expect(seoSkill.ready).toBe(true);
  });

  test("GET marks tone NOT ready if no LLM providers configured", async () => {
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: false,
      gemini: false,
    });

    const res = await GET();
    const json = await res.json();
    const toneSkill = json.find((s: any) => s.id === "tone");
    expect(toneSkill.ready).toBe(false);
  });

  test("AI Detection is ready with explicit Gemini provider-scoped key", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { aiDetection: true },
      providers: {
        "ai-detection": { provider: "gemini-ai-detection", apiKey: "SECRET_KEY_SHOULD_NOT_LEAK" },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: false,
      gemini: false,
    });

    const res = await GET();
    const body = await res.text();
    const json = JSON.parse(body);
    const skill = json.find((s: any) => s.id === "aiDetection");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["gemini"]);
    expect(skill.missingProviders).toEqual([]);
    expect(body).not.toContain("SECRET_KEY_SHOULD_NOT_LEAK");
    expect(body).not.toContain("apiKey");
  });

  test("AI Detection is ready with explicit Gemini provider and top-level Gemini key", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { aiDetection: true },
      providers: {
        "ai-detection": { provider: "gemini-ai-detection" },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: false,
      gemini: true,
    });

    const res = await GET();
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "aiDetection");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["gemini"]);
  });

  test("AI Detection is not ready from Gemini key alone when Copyscape remains selected", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { aiDetection: true },
      providers: {},
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: false,
      gemini: true,
    });

    const res = await GET();
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "aiDetection");

    expect(skill.ready).toBe(false);
    expect(skill.supportedProviders).toEqual(["copyscape"]);
    expect(skill.missingProviders).toEqual(["copyscape"]);
  });

  test("AI Detection is ready from Copyscape credentials when no Gemini provider is selected", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { aiDetection: true },
      providers: {},
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: true,
      exa: false,
      gemini: false,
    });

    const res = await GET();
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "aiDetection");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["copyscape"]);
  });

  test("POST toggles skill enabled state", async () => {
    const req = new NextRequest(new URL("http://localhost/api/skills"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-checkapp-csrf": "test-csrf-token",
      },
      body: JSON.stringify({ skillId: "tone", enabled: false }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });

  test("POST rejects missing CSRF token", async () => {
    const req = new NextRequest(new URL("http://localhost/api/skills"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ skillId: "tone", enabled: false }),
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
