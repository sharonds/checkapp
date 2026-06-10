import { describe, test, expect, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/csrf", () => ({
  getCsrfToken: vi.fn(() => "test-csrf-token"),
}));

import { GET, POST } from "@/app/api/reports/[id]/deep-audit/route";

describe("GET /api/reports/[id]/deep-audit — loopback guard", () => {
  test("rejects GET from non-loopback before exposing audit state", async () => {
    const req = new NextRequest(new URL("http://203.0.113.5:3000/api/reports/1/deep-audit"), {
      method: "GET",
      headers: { host: "localhost" },
    });
    const res = await GET(req, { params: Promise.resolve({ id: "1" }) });
    const text = await res.text();
    expect(res.status).toBe(403);
    expect(text).not.toContain("article");
    expect(text).not.toContain("audit");
    expect(text).not.toContain("provider");
  });
});

describe("POST /api/reports/[id]/deep-audit — loopback + CSRF guard", () => {
  test("rejects POST from spoofed Host header (uses nextUrl.hostname instead)", async () => {
    const req = new NextRequest(new URL("http://203.0.113.5:3000/api/reports/1/deep-audit"), {
      method: "POST",
      headers: { host: "localhost", "x-checkapp-csrf": "test-csrf-token" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });

  test("rejects POST without CSRF token", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/reports/1/deep-audit"), {
      method: "POST",
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });

  test("rejects POST with wrong CSRF token", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/reports/1/deep-audit"), {
      method: "POST",
      headers: { "x-checkapp-csrf": "wrong" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "1" }) });
    expect(res.status).toBe(403);
  });
});
