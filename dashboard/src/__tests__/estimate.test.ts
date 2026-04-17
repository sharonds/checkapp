import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/config", () => ({
  readAppConfig: vi.fn(() => ({
    skills: { factCheck: true, grammar: true },
    providers: {
      "fact-check": { provider: "exa-search", apiKey: "k" },
      grammar: { provider: "languagetool" },
    },
  })),
}));

import { POST } from "@/app/api/estimate/route";

describe("/api/estimate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns cost for given wordCount", async () => {
    const req = new NextRequest(new URL("http://localhost/api/estimate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordCount: 1000 }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.total).toBeCloseTo(0.032, 4); // fact-check × 4 + grammar free
    expect(json.perSkill["fact-check"]).toBeCloseTo(0.032, 4);
  });

  test("emits warning for 20KB-exceeding article", async () => {
    const req = new NextRequest(new URL("http://localhost/api/estimate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wordCount: 5000 }),
    });
    const res = await POST(req);
    const json = await res.json();
    expect(json.warnings.length).toBeGreaterThan(0);
  });

  test("returns 400 on malformed body", async () => {
    const req = new NextRequest(new URL("http://localhost/api/estimate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
