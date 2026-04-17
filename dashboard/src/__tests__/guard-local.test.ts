import { NextRequest } from "next/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { guardLocalMutation, guardLocalReadOnly } from "@/lib/guard-local";

// Mock getCsrfToken to return a known value for testing
vi.mock("@/lib/csrf", () => ({
  getCsrfToken: () => "test-csrf-token",
}));

describe("guardLocalMutation", () => {
  describe("loopback check", () => {
    it("allows localhost", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: { "x-checkapp-csrf": "test-csrf-token" },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("allows 127.0.0.1", async () => {
      const req = new NextRequest(new URL("http://127.0.0.1:3000/api/test"), {
        method: "POST",
        headers: { "x-checkapp-csrf": "test-csrf-token" },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("allows ::1 (IPv6 loopback)", async () => {
      const req = new NextRequest(new URL("http://[::1]:3000/api/test"), {
        method: "POST",
        headers: { "x-checkapp-csrf": "test-csrf-token" },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("rejects non-loopback host", async () => {
      const req = new NextRequest(new URL("http://203.0.113.5:3000/api/test"), {
        method: "POST",
        headers: { "x-checkapp-csrf": "test-csrf-token" },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });
  });

  describe("CSRF check", () => {
    it("rejects missing CSRF header", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("rejects wrong CSRF token", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: { "x-checkapp-csrf": "wrong-token" },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("allows correct CSRF token", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: { "x-checkapp-csrf": "test-csrf-token" },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });
  });
});

describe("guardLocalReadOnly", () => {
  it("allows localhost (no CSRF required)", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/estimate"), {
      method: "POST",
      body: "{}",
    });
    const result = guardLocalReadOnly(req);
    expect(result).toBeNull();
  });

  it("rejects non-loopback host", async () => {
    const req = new NextRequest(new URL("http://evil.com:3000/api/estimate"), {
      method: "POST",
      body: "{}",
    });
    const result = guardLocalReadOnly(req);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });
});
