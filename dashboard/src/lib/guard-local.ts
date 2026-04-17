import { NextRequest, NextResponse } from "next/server";
import { getCsrfToken } from "./csrf";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1"]);

function isLoopback(req: NextRequest): boolean {
  return LOOPBACK.has(req.nextUrl.hostname);
}

export function guardLocalReadOnly(req: NextRequest): NextResponse | null {
  if (!isLoopback(req)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }
  return null;
}

export function guardLocalMutation(req: NextRequest): NextResponse | null {
  if (!isLoopback(req)) {
    return NextResponse.json({ error: "localhost only" }, { status: 403 });
  }
  const csrf = req.headers.get("x-checkapp-csrf");
  if (!csrf || csrf !== getCsrfToken()) {
    return NextResponse.json({ error: "CSRF token missing or invalid" }, { status: 403 });
  }
  return null;
}
