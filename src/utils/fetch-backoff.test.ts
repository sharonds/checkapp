import { describe, test, expect, beforeEach } from "bun:test";
import { fetchWithBackoff, parseRetryAfterMs } from "./fetch-backoff.ts";
import { mockFetch, jsonResponse } from "../testing/mock-fetch.ts";

describe("fetchWithBackoff", () => {
  test("retries on 429 with exponential backoff", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls < 3) return new Response("rate limited", { status: 429, headers: { "Retry-After": "0" } });
      return jsonResponse({ ok: true });
    });
    const res = await fetchWithBackoff("https://x.example", { maxRetries: 3, baseDelayMs: 1 });
    expect(res.status).toBe(200);
    expect(calls).toBe(3);
  });
  test("gives up after maxRetries and returns last response", async () => {
    mockFetch(async () => new Response("still limited", { status: 429 }));
    const res = await fetchWithBackoff("https://x.example", { maxRetries: 2, baseDelayMs: 1 });
    expect(res.status).toBe(429);
  });
  test("does not retry on 2xx", async () => {
    let calls = 0;
    mockFetch(async () => { calls++; return jsonResponse({ ok: true }); });
    const res = await fetchWithBackoff("https://x.example", { maxRetries: 3, baseDelayMs: 1 });
    expect(calls).toBe(1);
    expect(res.status).toBe(200);
  });
  test("does not retry on 4xx other than 429", async () => {
    let calls = 0;
    mockFetch(async () => { calls++; return new Response("bad", { status: 400 }); });
    const res = await fetchWithBackoff("https://x.example", { maxRetries: 3, baseDelayMs: 1 });
    expect(calls).toBe(1);
    expect(res.status).toBe(400);
  });
  test("retries on 5xx", async () => {
    let calls = 0;
    mockFetch(async () => {
      calls++;
      if (calls < 2) return new Response("server down", { status: 503 });
      return jsonResponse({ ok: true });
    });
    const res = await fetchWithBackoff("https://x.example", { maxRetries: 3, baseDelayMs: 1 });
    expect(calls).toBe(2);
    expect(res.status).toBe(200);
  });

  test("throws on maxRetries < 0 instead of silently returning null", async () => {
    try {
      await fetchWithBackoff("http://x", { maxRetries: -1 });
      throw new Error("should have thrown");
    } catch (e) {
      expect((e as Error).message).toMatch(/maxRetries/);
    }
  });

  test("retries on network error (not only HTTP 429/5xx)", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      if (calls < 2) throw new TypeError("fetch failed");
      return jsonResponse({ ok: true });
    };
    const res = await fetchWithBackoff("http://x", { maxRetries: 2, baseDelayMs: 1, fetchImpl });
    expect(await res.text()).toBe(JSON.stringify({ ok: true }));
    expect(calls).toBe(2);
  });

  test("parses HTTP-date Retry-After into milliseconds", () => {
    const futureDate = new Date(Date.now() + 2500).toUTCString();
    const ms = parseRetryAfterMs(futureDate);
    expect(ms).toBeGreaterThan(2000);
    expect(ms).toBeLessThanOrEqual(3000);
  });

  test("parses numeric Retry-After in seconds", () => {
    const ms = parseRetryAfterMs("5");
    expect(ms).toBe(5000);
  });

  test("returns null for invalid Retry-After", () => {
    expect(parseRetryAfterMs(null)).toBeNull();
    expect(parseRetryAfterMs("")).toBeNull();
    expect(parseRetryAfterMs("invalid")).toBeNull();
  });
});
