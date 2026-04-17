import { afterEach } from "bun:test";

type Handler = (req: Request) => Promise<Response> | Response;

let original: typeof globalThis.fetch | null = null;

/**
 * Install a fetch mock for the current test. Automatically restored after each test
 * via the module-scoped afterEach hook — import anywhere and it's active.
 */
export function mockFetch(handler: Handler): void {
  if (original === null) original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    return handler(req);
  }) as unknown as typeof globalThis.fetch;
}

afterEach(() => {
  if (original) globalThis.fetch = original;
});

/**
 * Dispatch requests to different handlers based on substring match on the URL.
 * First matching entry wins. Throws if no route matches — prefer explicit
 * coverage over silent fallbacks in tests.
 */
export function urlRouter(routes: Record<string, Handler>): Handler {
  return async (req: Request) => {
    for (const [needle, h] of Object.entries(routes)) {
      if (req.url.includes(needle)) return h(req);
    }
    throw new Error(`No mock route for ${req.url}`);
  };
}

/** JSON response helper for mock handlers. */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
