import { test, expect, mock, beforeAll, afterEach } from "bun:test";
import { extractPages } from "./parallel.ts";

const FAKE_KEY = "pk_test_abc123";

// Save and restore Bun's native fetch so other test files aren't affected
let originalFetch: typeof global.fetch;
beforeAll(() => { originalFetch = global.fetch; });
afterEach(() => { global.fetch = originalFetch; });

test("extractPages returns url and full_content from response", async () => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          extract_id: "extract_abc",
          results: [
            {
              url: "https://healthline.com/article",
              title: "Vitamin D Benefits",
              publish_date: "2024-01-01",
              excerpts: null,
              full_content:
                "Vitamin D is essential for bone health and immune function in adults.",
            },
          ],
          errors: [],
          warnings: null,
          usage: [{ name: "sku_extract_full_content", count: 1 }],
        }),
    } as any)
  );

  const result = await extractPages(
    ["https://healthline.com/article"],
    FAKE_KEY
  );

  expect(result).toHaveLength(1);
  expect(result[0].url).toBe("https://healthline.com/article");
  expect(result[0].content).toBe(
    "Vitamin D is essential for bone health and immune function in adults."
  );
});

test("extractPages maps null full_content to empty string", async () => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          extract_id: "extract_xyz",
          results: [{ url: "https://example.com", full_content: null }],
          errors: [],
          warnings: null,
          usage: [],
        }),
    } as any)
  );

  const result = await extractPages(["https://example.com"], FAKE_KEY);
  expect(result[0].content).toBe("");
});

test("extractPages sends correct request headers and body", async () => {
  let capturedRequest: { url: string; options: RequestInit } | null = null;

  global.fetch = mock((url: string, options: RequestInit) => {
    capturedRequest = { url, options };
    return Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({ extract_id: "x", results: [], errors: [], warnings: null, usage: [] }),
    } as any);
  });

  await extractPages(["https://example.com"], FAKE_KEY);

  expect(capturedRequest!.url).toBe(
    "https://api.parallel.ai/v1beta/extract"
  );
  expect(capturedRequest!.options.headers).toMatchObject({
    "Content-Type": "application/json",
    "x-api-key": FAKE_KEY,
  });

  const body = JSON.parse(capturedRequest!.options.body as string);
  expect(body.urls).toEqual(["https://example.com"]);
  expect(body.full_content).toBe(true);
  expect(body.excerpts).toBe(false);
});

test("extractPages throws on non-2xx response", async () => {
  global.fetch = mock(() =>
    Promise.resolve({ ok: false, status: 401 } as any)
  );

  await expect(
    extractPages(["https://example.com"], "bad-key")
  ).rejects.toThrow("Parallel Extract API error: HTTP 401");
});

test("extractPages handles multiple URLs in one call", async () => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          extract_id: "extract_multi",
          results: [
            { url: "https://a.com", full_content: "Content from A." },
            { url: "https://b.com", full_content: "Content from B." },
          ],
          errors: [],
          warnings: null,
          usage: [],
        }),
    } as any)
  );

  const result = await extractPages(["https://a.com", "https://b.com"], FAKE_KEY);
  expect(result).toHaveLength(2);
  expect(result[1].url).toBe("https://b.com");
  expect(result[1].content).toBe("Content from B.");
});

test("extractPages surfaces per-URL errors (e.g. paywalled pages)", async () => {
  global.fetch = mock(() =>
    Promise.resolve({
      ok: true,
      json: () =>
        Promise.resolve({
          extract_id: "extract_partial",
          results: [
            { url: "https://open.com", full_content: "Open content here." },
          ],
          errors: [
            { url: "https://nytimes.com/article", message: "Access denied — page may be paywalled" },
          ],
          warnings: null,
          usage: [],
        }),
    } as any)
  );

  const result = await extractPages(
    ["https://open.com", "https://nytimes.com/article"],
    FAKE_KEY
  );
  expect(result).toHaveLength(2);
  expect(result[0].content).toBe("Open content here.");
  expect(result[0].error).toBeUndefined();
  expect(result[1].url).toBe("https://nytimes.com/article");
  expect(result[1].content).toBe("");
  expect(result[1].error).toBe("Access denied — page may be paywalled");
});
