import { NextRequest, NextResponse } from "next/server";
import { getCsrfToken } from "./csrf";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);
const SIMPLE_FORM_TYPES = new Set([
  "application/x-www-form-urlencoded",
  "multipart/form-data",
  "text/plain",
]);

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
    if (!sawRelevantValue) return false;
  }

  return true;
}

function isLocalRequest(req: NextRequest): boolean {
  if (!isLoopbackHost(req.nextUrl.hostname)) return false;
  const host = req.headers.get("host");
  if (host && !isLoopbackHost(host)) return false;
  if (!isLoopbackUrl(req.headers.get("origin"))) return false;
  if (!isLoopbackUrl(req.headers.get("referer"))) return false;
  return forwardedValuesAreLocal(req);
}

function isSimpleFormContentType(req: NextRequest): boolean {
  const contentType = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  return contentType ? SIMPLE_FORM_TYPES.has(contentType) : false;
}

export function guardLocalReadOnly(req: NextRequest): NextResponse | null {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }
  return null;
}

export function guardLocalMutation(req: NextRequest): NextResponse | null {
  if (!isLocalRequest(req)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }
  if (isSimpleFormContentType(req)) {
    return NextResponse.json({ error: "CSRF token missing or invalid" }, { status: 403 });
  }
  const csrf = req.headers.get("x-checkapp-csrf");
  if (!csrf || csrf !== getCsrfToken()) {
    return NextResponse.json({ error: "CSRF token missing or invalid" }, { status: 403 });
  }
  return null;
}
