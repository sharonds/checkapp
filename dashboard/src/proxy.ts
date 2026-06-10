import { NextRequest, NextResponse } from "next/server";

export function proxy(request: NextRequest) {
  if (!isLocalRequest(request)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

function normalizeHost(host: string | null): string {
  if (!host) return "";
  const trimmed = host.trim().toLowerCase();
  const bracketed = trimmed.match(/^\[([^\]]+)\](?::\d+)?$/);
  const value = bracketed ? bracketed[1] ?? "" : trimmed;
  if (value === "::1") return value;
  if (value.startsWith("::ffff:")) return value.slice("::ffff:".length);
  const colonCount = (value.match(/:/g) ?? []).length;
  if (colonCount === 1) return value.split(":")[0] ?? "";
  return value;
}

function isLoopbackHost(host: string | null): boolean {
  return LOOPBACK.has(normalizeHost(host));
}

function isLoopbackUrl(value: string | null): boolean {
  if (!value) return true;
  try {
    return isLoopbackHost(new URL(value).hostname);
  } catch {
    return false;
  }
}

function isLocalRequest(req: NextRequest): boolean {
  if (!isLoopbackHost(req.nextUrl.hostname)) return false;
  const host = req.headers.get("host");
  if (host && !isLoopbackHost(host)) return false;
  if (!isLoopbackUrl(req.headers.get("origin"))) return false;
  if (!isLoopbackUrl(req.headers.get("referer"))) return false;
  return forwardedValuesAreLocal(req);
}

function forwardedValuesAreLocal(req: NextRequest): boolean {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const values = forwardedFor.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length === 0 || values.some((value) => !isLoopbackHost(value))) return false;
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  if (forwardedHost) {
    const values = forwardedHost.split(",").map((value) => value.trim()).filter(Boolean);
    if (values.length === 0 || values.some((value) => !isLoopbackHost(value))) return false;
  }

  const forwarded = req.headers.get("forwarded");
  if (forwarded) {
    const values = forwarded.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
    let sawRelevantValue = false;
    for (const value of values) {
      const [key, raw] = value.split("=");
      if (!key || raw === undefined) continue;
      const name = key.toLowerCase();
      if (name !== "host" && name !== "for") continue;
      sawRelevantValue = true;
      const cleaned = raw.replace(/^"|"$/g, "").replace(/^\[/, "").replace(/\](?::\d+)?$/, "");
      if (!isLoopbackHost(cleaned)) return false;
    }
    // Conservative by design: a Forwarded header that omits host/for can deny
    // a request, but it never makes a request more trusted.
    if (!sawRelevantValue) return false;
  }

  return true;
}
