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

function localReq() {
  return new NextRequest(new URL("http://localhost:3000/api/skills"));
}

function remoteReq() {
  return new NextRequest(new URL("http://evil.example.com/api/skills"));
}

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

  test("GET rejects non-loopback dashboard reads", async () => {
    const res = await GET(remoteReq());
    expect(res.status).toBe(403);
  });

  test("GET returns skills with provider-aware readiness (tone ready w/ anthropic)", async () => {
    const res = await GET(localReq());
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

    const res = await GET(localReq());
    const json = await res.json();
    const toneSkill = json.find((s: any) => s.id === "tone");
    expect(toneSkill.ready).toBe(false);
  });

  test("GET marks LLM skills ready with Gemini-only configuration", async () => {
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: false,
      gemini: true,
    });

    const res = await GET(localReq());
    const json = await res.json();
    const toneSkill = json.find((s: any) => s.id === "tone");

    expect(toneSkill.supportedProviders).toContain("gemini");
    expect(toneSkill.ready).toBe(true);
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

    const res = await GET(localReq());
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

    const res = await GET(localReq());
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

    const res = await GET(localReq());
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

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "aiDetection");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["copyscape"]);
  });

  test("Plagiarism is ready with explicit Gemini grounded provider and top-level Gemini key", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { plagiarism: true },
      providers: {
        plagiarism: { provider: "gemini-grounded-plagiarism" },
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

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "plagiarism");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["gemini"]);
    expect(skill.missingProviders).toEqual([]);
  });

  test("Plagiarism exposes Gemini fallback provider readiness", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { plagiarism: true },
      providers: {
        plagiarism: { provider: "copyscape", extra: { fallbackProvider: "gemini-grounded-plagiarism" } },
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

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "plagiarism");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["copyscape", "gemini"]);
    expect(skill.missingProviders).toEqual([]);
  });

  test("Plagiarism fallback requires Gemini even when Copyscape is configured", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { plagiarism: true },
      providers: {
        plagiarism: { provider: "copyscape", extra: { fallbackProvider: "gemini-grounded-plagiarism" } },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: true,
      exa: false,
      gemini: false,
    });

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "plagiarism");

    expect(skill.ready).toBe(false);
    expect(skill.supportedProviders).toEqual(["copyscape", "gemini"]);
    expect(skill.missingProviders).toEqual(["gemini"]);
  });

  test("Fact Check standard tier requires Gemini instead of Exa", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { factCheck: true },
      factCheckTierFlag: true,
      factCheckTier: "standard",
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "EXA_KEY_SHOULD_NOT_MATTER" },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: true,
      gemini: false,
    });

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "factCheck");

    expect(skill.engine).toBe("Exa AI + LLM / Gemini Grounded");
    expect(skill.ready).toBe(false);
    expect(skill.supportedProviders).toEqual(["gemini"]);
    expect(skill.missingProviders).toEqual(["gemini"]);
  });

  test("Fact Check standard tier is ready with Gemini key", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { factCheck: true },
      factCheckTierFlag: true,
      factCheckTier: "standard",
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

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "factCheck");

    expect(skill.ready).toBe(true);
    expect(skill.supportedProviders).toEqual(["gemini"]);
    expect(skill.missingProviders).toEqual([]);
  });

  test("Fact Check basic tier requires Exa and an LLM provider", async () => {
    mockReadAppConfig.mockReturnValue({
      skills: { factCheck: true },
      factCheckTierFlag: false,
      providers: {
        "fact-check": { provider: "exa-search", apiKey: "EXA_KEY" },
      },
    });
    mockGetApiKeyStatus.mockReturnValue({
      anthropic: false,
      minimax: false,
      openrouter: false,
      copyscape: false,
      exa: true,
      gemini: false,
    });

    const res = await GET(localReq());
    const json = await res.json();
    const skill = json.find((s: any) => s.id === "factCheck");

    expect(skill.ready).toBe(false);
    expect(skill.supportedProviders).toEqual(["exa", "minimax", "anthropic", "openrouter", "gemini"]);
    expect(skill.missingProviders).toEqual(["minimax"]);
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
