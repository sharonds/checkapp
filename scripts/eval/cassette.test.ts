import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
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
  test("grounded detection reads the request's tools, not the article text in the prompt", () => {
    const extraction = JSON.stringify({ contents: [{ parts: [{ text: "An article that mentions google_search and googleSearch." }] }] });
    expect(isGroundedRequest("https://h/models/m:generateContent", extraction)).toBe(false);
    expect(isGroundedRequest("https://h/models/m:generateContent", JSON.stringify({ tools: [{ googleSearch: {} }] }))).toBe(true);
  });

  test("error responses (429, 5xx) are never recorded, so a later run retries the provider", async () => {
    const dir = tmp();
    const path = join(dir, "c.json");
    const rec = new Cassette(path, "record", { allowGrounded: false, reuseRecorded: true, innerFetch: async () => new Response("{}", { status: 429 }) });
    await rec.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"contents":["x"]}' });
    rec.save();
    let live = 0;
    const again = new Cassette(path, "record", { allowGrounded: false, reuseRecorded: true, innerFetch: async () => { live++; return new Response('{"ok":1}'); } });
    expect(await (await again.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"contents":["x"]}' })).json()).toEqual({ ok: 1 });
    expect(live).toBe(1);
  });

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

  test("record mode can reuse recorded responses, so one stage can be changed while the rest is held fixed", async () => {
    // E.g. a verdict-prompt A/B: reuse the recorded claim extraction, call grounded verification live.
    const dir = tmp();
    const path = join(dir, "c.json");
    const first = new Cassette(path, "record", { allowGrounded: false, innerFetch: async () => new Response('{"v":1}') });
    await first.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"contents":["extract"]}' });
    first.save();

    let live = 0;
    const second = new Cassette(path, "record", { allowGrounded: false, reuseRecorded: true, innerFetch: async () => { live++; return new Response('{"v":2}'); } });
    const reused = await second.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"contents":["extract"]}' });
    expect(await reused.json()).toEqual({ v: 1 });
    const grounded = await second.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"tools":[{"google_search":{}}]}' });
    expect(await grounded.json()).toEqual({ v: 2 });
    expect(live).toBe(1);
  });

  test("identical requests keep every recorded response and replay them in order", async () => {
    // A union of several extraction calls sends the same request several times; replaying one
    // response for all of them would collapse the union into a single sample.
    const dir = tmp();
    const path = join(dir, "c.json");
    let n = 0;
    const rec = new Cassette(path, "record", { allowGrounded: false, innerFetch: async () => new Response(`{"n":${++n}}`) });
    const req = () => ["https://h/models/m:generateContent", { method: "POST", body: '{"contents":["same"]}' }] as const;
    await Promise.all([rec.fetch(...req()), rec.fetch(...req()), rec.fetch(...req())]);
    rec.save();

    for (const mode of ["replay", "record"] as const) {
      const again = new Cassette(path, mode, { allowGrounded: false, reuseRecorded: true, innerFetch: async () => { throw new Error("network"); } });
      const bodies = [];
      for (let i = 0; i < 3; i++) bodies.push(await (await again.fetch(...req())).json());
      expect(bodies.map((b: any) => b.n).sort()).toEqual([1, 2, 3]);
    }
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

  test("follows symlinks: a link outside the repo that points into it is refused", () => {
    const link = join(tmp(), "link-into-repo");
    symlinkSync(join(process.cwd(), "scripts"), link);
    expect(() => assertOutsideGitRepo(join(link, "eval-out", "new"))).toThrow(/inside a git repository/i);
  });
});
