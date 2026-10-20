import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Cassette, isGroundedRequest, requestKey } from "./cassette.ts";
import { assertOutsideGitRepo } from "./paths.ts";

let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "checkapp-cassette-"));
  dirs.push(d);
  return d;
}

describe("request keys", () => {
  test("ignore the API key in the query string, depend on url + body", () => {
    const a = requestKey("fetch", "https://h/v1/models/m:generateContent?key=SECRET1", '{"a":1}');
    const b = requestKey("fetch", "https://h/v1/models/m:generateContent?key=SECRET2", '{"a":1}');
    const c = requestKey("fetch", "https://h/v1/models/m:generateContent", '{"a":2}');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  test("detects Google Search grounded and Deep Research requests", () => {
    expect(isGroundedRequest("https://h/models/m:generateContent", '{"tools":[{"google_search":{}}]}')).toBe(true);
    expect(isGroundedRequest("https://h/interactions", '{"agent":"deep-research-preview-04-2026"}')).toBe(true);
    expect(isGroundedRequest("https://h/models/m:generateContent", '{"contents":[]}')).toBe(false);
  });
});

describe("cassette record/replay", () => {
  test("records non-grounded responses without request secrets, then replays them offline", async () => {
    const dir = tmp();
    const path = join(dir, "c.json");
    const realFetch = async () => new Response('{"ok":1}', { status: 200, headers: { "content-type": "application/json" } });

    const rec = new Cassette(path, "record", { allowGrounded: false, innerFetch: realFetch });
    const recFetch = rec.fetch;
    const r1 = await recFetch("https://h/models/m:generateContent?key=SECRET", { method: "POST", body: '{"contents":[]}', headers: { "x-goog-api-key": "SECRET" } });
    expect(await r1.json()).toEqual({ ok: 1 });
    rec.save();
    expect(readFileSync(path, "utf-8")).not.toContain("SECRET");

    const rep = new Cassette(path, "replay", { allowGrounded: false, innerFetch: async () => { throw new Error("network used in replay"); } });
    const r2 = await rep.fetch("https://h/models/m:generateContent?key=OTHER", { method: "POST", body: '{"contents":[]}' });
    expect(await r2.json()).toEqual({ ok: 1 });
  });

  test("does not record grounded responses unless allowed, and says why on replay", async () => {
    const dir = tmp();
    const path = join(dir, "c.json");
    const rec = new Cassette(path, "record", { allowGrounded: false, innerFetch: async () => new Response('{"grounded":1}') });
    await rec.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"tools":[{"google_search":{}}]}' });
    rec.save();
    expect(readFileSync(path, "utf-8")).not.toContain("grounded\":1");

    const rep = new Cassette(path, "replay", { allowGrounded: false, innerFetch: async () => new Response("x") });
    await expect(rep.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"tools":[{"google_search":{}}]}' }))
      .rejects.toThrow(/grounded.*not recorded/i);
  });

  test("records and replays Exa search results keyed by query + options", async () => {
    const dir = tmp();
    const path = join(dir, "c.json");
    class FakeExa { async search(q: string, _o: unknown) { return { results: [{ url: `https://x/${q}` }] }; } }
    const rec = new Cassette(path, "record", { allowGrounded: false });
    const restore = rec.wrapExa(FakeExa.prototype as any);
    expect(await new FakeExa().search("q1", { type: "auto" })).toEqual({ results: [{ url: "https://x/q1" }] });
    restore();
    rec.save();

    class OfflineExa { async search(): Promise<unknown> { throw new Error("network used in replay"); } }
    const rep = new Cassette(path, "replay", { allowGrounded: false });
    const restore2 = rep.wrapExa(OfflineExa.prototype as any);
    expect(await new OfflineExa().search("q1" as never, { type: "auto" } as never)).toEqual({ results: [{ url: "https://x/q1" }] });
    restore2();
  });
});

describe("output path guard", () => {
  test("refuses output inside a git working tree (client data must stay out of repos)", () => {
    expect(() => assertOutsideGitRepo(join(process.cwd(), "eval-out"))).toThrow(/inside a git repository/i);
    expect(() => assertOutsideGitRepo(tmp())).not.toThrow();
  });
});
