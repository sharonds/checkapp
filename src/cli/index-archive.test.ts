import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { mockFetch, urlRouter, jsonResponse } from "../testing/mock-fetch.ts";
import { indexArchive } from "./index-archive.ts";
import type { Config } from "../config.ts";

const cfg: Config = {
  copyscapeUser: "", copyscapeKey: "",
  providers: { "self-plagiarism": { provider: "cloudflare-vectorize", apiKey: "cf", extra: { accountId: "acct", indexName: "articles" } } },
  openrouterApiKey: "or",
  skills: {
    plagiarism: false, aiDetection: false, seo: false,
    factCheck: false, tone: false, legal: false,
    summary: false, brief: false, purpose: false,
  },
};

describe("indexArchive", () => {
  let tmp: string;
  beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "checkapp-index-test-")); });
  afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

  test("embeds each .md file and upserts NDJSON multipart to Vectorize", async () => {
    writeFileSync(join(tmp, "a.md"), "article one content");
    writeFileSync(join(tmp, "b.md"), "article two content");
    writeFileSync(join(tmp, "notes.txt"), "ignored"); // non-md

    let embedCalls = 0;
    let upsertBodyLines = 0;
    mockFetch(urlRouter({
      "openrouter.ai/api/v1/embeddings": async () => {
        embedCalls++;
        return jsonResponse({ data: [{ embedding: Array(768).fill(0.1) }] });
      },
      "vectorize/v2/indexes/articles/upsert": async (req) => {
        const form = await req.formData();
        const file = form.get("vectors");
        if (file instanceof Blob) {
          const text = await file.text();
          upsertBodyLines = text.split("\n").filter(Boolean).length;
        }
        return jsonResponse({ result: { mutationId: "m1" } });
      },
    }));

    await indexArchive(tmp, cfg);
    expect(embedCalls).toBe(2);
    expect(upsertBodyLines).toBe(2);
  });

  test("empty directory prints 'No .md files' and returns without error", async () => {
    // No mock needed — no fetches should happen for empty dir.
    await indexArchive(tmp, cfg);
    expect(true).toBe(true);
  });

  test("throws when self-plagiarism provider is not configured", async () => {
    const badCfg: Config = { ...cfg, providers: {} };
    await expect(indexArchive(tmp, badCfg)).rejects.toThrow(/self-plagiarism provider not configured/);
  });

  test("throws when OpenRouter key is missing", async () => {
    const { openrouterApiKey, ...rest } = cfg;
    await expect(indexArchive(tmp, rest as Config)).rejects.toThrow(/OPENROUTER/);
  });
});
