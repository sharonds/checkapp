/**
 * Record/replay of provider responses so an evaluation can be re-scored without paying again.
 *
 * Gemini and the LLM SDKs go through global fetch; exa-js uses its own cross-fetch, so Exa is
 * captured at Exa.prototype.search instead.
 *
 * Google Search grounded responses (and Deep Research) are NOT recorded unless allowGrounded is
 * set: the Gemini grounding terms restrict caching Grounded Results. Without it, grounded
 * variants have to be run live.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

type FetchFn = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface FetchEntry {
  kind: "fetch";
  url: string;
  status: number;
  contentType: string;
  body: string;
}

interface ExaEntry {
  kind: "exa";
  query: string;
  result: unknown;
}

type Entry = FetchEntry | ExaEntry;

function stripKey(url: string): string {
  return url.replace(/([?&])key=[^&#]*(&?)/, (_m, sep: string, tail: string) => (tail ? sep : "")).replace(/[?&]$/, "");
}

export function requestKey(kind: string, url: string, body: string): string {
  return createHash("sha256").update(`${kind}\n${stripKey(url)}\n${body}`).digest("hex");
}

export function isGroundedRequest(url: string, body: string): boolean {
  return body.includes("google_search") || body.includes("googleSearch") || /\/interactions(\/|$|\?)/.test(url);
}

export interface CassetteOptions {
  allowGrounded: boolean;
  /** Record mode only: serve requests already in the cassette, call live only on a miss. */
  reuseRecorded?: boolean;
  innerFetch?: FetchFn;
}

export class Cassette {
  /** Responses per request key, in the order they were recorded (identical requests can repeat). */
  private entries: Record<string, Entry[]> = {};
  private readonly served = new Map<string, number>();
  /** Captured at construction: once installed, globalThis.fetch is this cassette itself. */
  private readonly inner: FetchFn;
  readonly fetch: FetchFn;

  constructor(
    private readonly path: string,
    private readonly mode: "record" | "replay",
    private readonly options: CassetteOptions,
  ) {
    if (existsSync(path)) {
      const stored = (JSON.parse(readFileSync(path, "utf-8")) as { entries: Record<string, Entry | Entry[]> }).entries;
      // Version 1 cassettes kept one response per key.
      this.entries = Object.fromEntries(Object.entries(stored).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
    } else if (mode === "replay") {
      throw new Error(`No cassette at ${path}; record this variant first.`);
    }
    this.inner = options.innerFetch ?? globalThis.fetch.bind(globalThis);
    this.fetch = (input, init) => this.handleFetch(input, init);
  }

  /** Next recorded response for a key; in replay, the last one repeats once the list runs out. */
  private next(key: string, kind: Entry["kind"], allowRepeat: boolean): Entry | undefined {
    const list = (this.entries[key] ?? []).filter((e) => e.kind === kind);
    const index = this.served.get(key) ?? 0;
    if (index < list.length) {
      this.served.set(key, index + 1);
      return list[index];
    }
    return allowRepeat ? list.at(-1) : undefined;
  }

  private record(key: string, entry: Entry): void {
    (this.entries[key] ??= []).push(entry);
    this.served.set(key, (this.served.get(key) ?? 0) + 1);
  }

  private async handleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = input instanceof Request ? input.url : String(input);
    const body = typeof init?.body === "string" ? init.body : input instanceof Request ? await input.clone().text() : "";
    const key = requestKey("fetch", url, body);
    const grounded = isGroundedRequest(url, body);

    if (this.mode === "replay") {
      const hit = this.next(key, "fetch", true);
      if (hit?.kind === "fetch") {
        return new Response(hit.body, { status: hit.status, headers: { "content-type": hit.contentType } });
      }
      if (grounded && !this.options.allowGrounded) {
        throw new Error(`Grounded Google Search response was not recorded (grounding terms); run this variant live: ${stripKey(url)}`);
      }
      throw new Error(`Cassette miss for ${stripKey(url)}`);
    }

    const recorded = this.options.reuseRecorded ? this.next(key, "fetch", false) : undefined;
    if (recorded?.kind === "fetch") {
      return new Response(recorded.body, { status: recorded.status, headers: { "content-type": recorded.contentType } });
    }
    const res = await this.inner(input, init);
    const text = await res.text();
    const contentType = res.headers.get("content-type") ?? "application/json";
    if (!grounded || this.options.allowGrounded) {
      this.record(key, { kind: "fetch", url: stripKey(url), status: res.status, contentType, body: text });
    }
    return new Response(text, { status: res.status, headers: { "content-type": contentType } });
  }

  /** Wraps an exa-js prototype's search(); returns a function that restores it. */
  wrapExa(proto: { search: (q: string, o?: unknown) => Promise<unknown> }): () => void {
    const original = proto.search;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const cassette = this;
    proto.search = async function (this: unknown, query: string, options?: unknown) {
      const key = requestKey("exa", query, JSON.stringify(options ?? {}));
      if (cassette.mode === "replay" || cassette.options.reuseRecorded) {
        const hit = cassette.next(key, "exa", cassette.mode === "replay");
        if (hit?.kind === "exa") return hit.result;
        if (cassette.mode === "replay") throw new Error(`Cassette miss for Exa query: ${query.slice(0, 80)}`);
      }
      const result = await original.call(this, query, options);
      cassette.record(key, { kind: "exa", query, result });
      return result;
    };
    return () => {
      proto.search = original;
    };
  }

  save(): void {
    // Owner-only: cassettes contain article text and provider responses.
    writeFileSync(this.path, JSON.stringify({ version: 2, entries: this.entries }), { encoding: "utf-8", mode: 0o600 });
  }
}
