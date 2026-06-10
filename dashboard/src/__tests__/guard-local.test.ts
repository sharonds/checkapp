import { NextRequest } from "next/server";
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { guardLocalMutation, guardLocalReadOnly } from "@/lib/guard-local";
import { getCsrfToken } from "@/lib/csrf";
import { proxy } from "../proxy";

describe("guardLocalMutation", () => {
  describe("loopback check", () => {
    it("allows localhost", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-checkapp-csrf": getCsrfToken() },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("allows 127.0.0.1", async () => {
      const req = new NextRequest(new URL("http://127.0.0.1:3000/api/test"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-checkapp-csrf": getCsrfToken() },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("allows ::1 (IPv6 loopback)", async () => {
      const req = new NextRequest(new URL("http://[::1]:3000/api/test"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-checkapp-csrf": getCsrfToken() },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it.each([
      ["x-forwarded-for", "::ffff:127.0.0.1"],
      ["x-forwarded-for", "::1"],
      ["x-forwarded-host", "[::1]:3000"],
      ["forwarded", "for=\"[::ffff:127.0.0.1]:54321\";host=\"127.0.0.1:3000\""],
    ])("allows loopback forwarded header %s=%s", async (header, value) => {
      const req = new NextRequest(new URL("http://127.0.0.1:3000/api/test"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-checkapp-csrf": getCsrfToken(),
          [header]: value,
        },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("rejects non-loopback host", async () => {
      const req = new NextRequest(new URL("http://203.0.113.5:3000/api/test"), {
        method: "POST",
        headers: { "content-type": "application/json", "x-checkapp-csrf": getCsrfToken() },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("rejects public host even when forwarded-for claims loopback", async () => {
      const req = new NextRequest(new URL("http://203.0.113.5:3000/api/test"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-checkapp-csrf": getCsrfToken(),
          "x-forwarded-for": "127.0.0.1",
        },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it.each([
      ["x-forwarded-for", "198.51.100.2"],
      ["x-forwarded-host", "public.example"],
      ["forwarded", "for=198.51.100.2;host=localhost"],
      ["forwarded", "host=public.example"],
    ])("rejects public forwarded header %s", async (header, value) => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-checkapp-csrf": getCsrfToken(),
          [header]: value,
        },
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
        headers: { "content-type": "application/json", "x-checkapp-csrf": getCsrfToken() },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).toBeNull();
    });

    it("rejects cross-site origin even with correct CSRF header", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: {
          origin: "https://evil.example",
          "content-type": "application/json",
          "x-checkapp-csrf": getCsrfToken(),
        },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it("rejects cross-site referer even with correct CSRF header", async () => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: {
          referer: "https://evil.example/form",
          "content-type": "application/json",
          "x-checkapp-csrf": getCsrfToken(),
        },
        body: "{}",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
    });

    it.each([
      "application/x-www-form-urlencoded",
      "multipart/form-data",
      "text/plain",
    ])("rejects simple form content type %s", async (contentType) => {
      const req = new NextRequest(new URL("http://localhost:3000/api/test"), {
        method: "POST",
        headers: {
          "content-type": contentType,
          "x-checkapp-csrf": getCsrfToken(),
        },
        body: "a=b",
      });
      const result = guardLocalMutation(req);
      expect(result).not.toBeNull();
      expect(result?.status).toBe(403);
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

  it("rejects public forwarded headers for local URLs", async () => {
    const req = new NextRequest(new URL("http://localhost:3000/api/estimate"), {
      method: "GET",
      headers: { "x-forwarded-host": "public.example" },
    });
    const result = guardLocalReadOnly(req);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(403);
  });
});

describe("dashboard proxy guard", () => {
  it("rejects non-loopback requests through the Next proxy entrypoint", async () => {
    const req = new NextRequest(new URL("http://203.0.113.5:3000/reports"));
    const result = proxy(req);
    expect(result?.status).toBe(403);
  });

  it("uses proxy.ts, not deprecated middleware.ts", () => {
    expect(existsSync(join(process.cwd(), "src/proxy.ts"))).toBe(true);
    expect(existsSync(join(process.cwd(), "src/middleware.ts"))).toBe(false);
  });
});

describe("dashboard mutation route guard contract", () => {
  it.each([
    "src/app/api/checks/route.ts",
    "src/app/api/checks/[id]/tags/route.ts",
    "src/app/api/config/route.ts",
    "src/app/api/contexts/route.ts",
    "src/app/api/contexts/[type]/route.ts",
    "src/app/api/providers/route.ts",
    "src/app/api/reports/[id]/deep-audit/route.ts",
    "src/app/api/skills/route.ts",
  ])("%s uses guardLocalMutation", (routePath) => {
    const source = readFileSync(join(process.cwd(), routePath), "utf8");
    expect(source).toContain("guardLocalMutation");
  });
});
