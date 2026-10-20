import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../src/config.ts";
import { runEval } from "./run.ts";

// Synthetic corpus in a temp folder — the real corpus never enters the repo.
let root = "";
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); });

function setup() {
  root = mkdtempSync(join(tmpdir(), "checkapp-eval-"));
  const corpus = join(root, "corpus");
  mkdirSync(corpus);
  writeFileSync(join(corpus, "a.md"), "The kettle holds 1.7 litres. The toaster has 6 slots.");
  const labels = join(root, "labels.json");
  writeFileSync(labels, JSON.stringify([
    { id: "t1", doc: "a.md", class: "article", sentence: "The kettle holds 1.7 litres.", verdict: "supported" },
    { id: "f1", doc: "a.md", class: "article", sentence: "The toaster has 6 slots.", verdict: "partially_supported" },
  ]));
  const variant = join(root, "variant.json");
  writeFileSync(variant, JSON.stringify({ name: "test-variant", config: { factCheckTier: "standard" } }));
  return { corpus, labels, variant, out: join(root, "out") };
}

const baseConfig = (): Config => ({ copyscapeUser: "", copyscapeKey: "", skills: { plagiarism: true, aiDetection: true, seo: true, factCheck: false, tone: false, legal: false, summary: false, brief: false, purpose: false } });

const fakeCore = async (text: string, config: Config) => {
  expect(config.skills.factCheck).toBe(true);
  expect(config.skills.plagiarism).toBe(false);
  expect(config.factCheckTier).toBe("standard");
  await globalThis.fetch("https://h/models/m:generateContent", { method: "POST", body: JSON.stringify({ contents: [{ parts: [{ text }] }] }) });
  return {
    totalCostUsd: 0.2,
    results: [{ skillId: "fact-check-grounded", name: "FC", score: 50, verdict: "warn" as const, summary: "", findings: [], costUsd: 0.2 }],
    audit: {
      claims: [{ id: "claim-1", quote: "The kettle holds 1.7 litres." }, { id: "claim-2", quote: "The toaster has 6 slots." }],
      factAssessments: [{ claimId: "claim-1", status: "supported" }, { claimId: "claim-2", status: "unsupported" }],
    } as any,
  };
};

describe("runEval", () => {
  test("refuses to run live without --yes and prints a cost estimate", async () => {
    const p = setup();
    await expect(runEval({ ...p, mode: "live", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any }))
      .rejects.toThrow(/estimated.*--yes/i);
  });

  test("dry run validates that every gold sentence is in its document, without provider calls", async () => {
    const p = setup();
    writeFileSync(p.labels, JSON.stringify([{ id: "m", doc: "a.md", class: "article", sentence: "Not in the article.", verdict: "supported" }]));
    const report = await runEval({ ...p, mode: "dry-run", yes: false }, { readConfig: baseConfig, runCheckCore: async () => { throw new Error("no calls in dry run"); } });
    expect(report.missingSentences).toEqual(["m"]);
  });

  test("record then replay produces the same metrics, and replay makes no network calls", async () => {
    const p = setup();
    const realFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => { networkCalls++; return new Response('{"ok":1}'); }) as typeof fetch;
    try {
      const recorded = await runEval({ ...p, mode: "record", yes: true }, { readConfig: baseConfig, runCheckCore: fakeCore as any });
      expect(networkCalls).toBe(1);
      expect(recorded.metrics.recallFalseStrict.value).toBe(1);
      expect(recorded.metrics.falseAlarmRate.value).toBe(0);
      expect(recorded.metrics.costPerArticleUsd).toBeCloseTo(0.2);

      const replayed = await runEval({ ...p, mode: "replay", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any });
      expect(networkCalls).toBe(1);
      expect(replayed.metrics.recallFalseStrict).toEqual(recorded.metrics.recallFalseStrict);
      expect(existsSync(join(replayed.runDir, "metrics.json"))).toBe(true);
      expect(readFileSync(join(replayed.runDir, "summary.md"), "utf-8")).toContain("test-variant");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("reads the config inside the variant env (keys and LLM_PROVIDER are read at config time)", async () => {
    const p = setup();
    writeFileSync(p.variant, JSON.stringify({ name: "env-variant", env: { CHECKAPP_EVAL_PROBE: "from-variant" } }));
    let seen: string | undefined;
    await runEval({ ...p, mode: "live", yes: true }, {
      readConfig: () => { seen = process.env.CHECKAPP_EVAL_PROBE; return baseConfig(); },
      runCheckCore: async () => ({ totalCostUsd: 0, results: [], audit: undefined as never }),
    });
    expect(seen).toBe("from-variant");
    expect(process.env.CHECKAPP_EVAL_PROBE).toBeUndefined();
  });

  test("rejects a variant name that would escape the output folder", async () => {
    const p = setup();
    writeFileSync(p.variant, JSON.stringify({ name: "../escape" }));
    await expect(runEval({ ...p, mode: "dry-run", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any }))
      .rejects.toThrow(/variant name/i);
  });

  test("restores global fetch even if loading exa-js fails", async () => {
    const p = setup();
    const realFetch = globalThis.fetch;
    const broken = { get search(): never { throw new Error("exa unavailable"); }, set search(_v: unknown) {} } as never;
    await expect(runEval({ ...p, mode: "record", yes: true }, { readConfig: baseConfig, runCheckCore: fakeCore as any, exaPrototype: broken }))
      .rejects.toThrow(/exa unavailable/);
    expect(globalThis.fetch).toBe(realFetch);
  });

  test("replay reports latency as n/a (cached responses say nothing about speed)", async () => {
    const p = setup();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"ok":1}')) as typeof fetch;
    try {
      await runEval({ ...p, mode: "record", yes: true }, { readConfig: baseConfig, runCheckCore: fakeCore as any });
      const replayed = await runEval({ ...p, mode: "replay", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any });
      expect(replayed.metrics.latencyMs).toEqual({ p50: null, p90: null });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("rejects a label whose doc is not a plain file name (no reading or writing outside the folders)", async () => {
    const p = setup();
    writeFileSync(p.labels, JSON.stringify([{ id: "x", doc: "../a.md", class: "article", sentence: "s", verdict: "supported" }]));
    await expect(runEval({ ...p, mode: "dry-run", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any }))
      .rejects.toThrow(/file name/i);
  });

  test("refuses a variant output folder that is a symlink into a git repository", async () => {
    const { symlinkSync } = await import("node:fs");
    const p = setup();
    mkdirSync(p.out);
    symlinkSync(join(process.cwd(), "scripts"), join(p.out, "test-variant"));
    await expect(runEval({ ...p, mode: "dry-run", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any }))
      .rejects.toThrow(/inside a git repository/i);
  });

  test("replay fails when a request was missing from the cassette, even if the app swallowed the error", async () => {
    const p = setup();
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('{"ok":1}')) as typeof fetch;
    try {
      await runEval({ ...p, mode: "record", yes: true }, { readConfig: baseConfig, runCheckCore: fakeCore as any });
      const swallowing = async (text: string, config: Config) => {
        try { await globalThis.fetch("https://h/models/m:generateContent", { method: "POST", body: '{"changed":"prompt"}' }); } catch { /* the app turns this into a provider error */ }
        return fakeCore(text, config);
      };
      await expect(runEval({ ...p, mode: "replay", yes: false }, { readConfig: baseConfig, runCheckCore: swallowing as any }))
        .rejects.toThrow(/not in the cassette/i);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("refuses an output folder inside a git repository", async () => {
    const p = setup();
    await expect(runEval({ ...p, out: join(process.cwd(), "eval-out"), mode: "dry-run", yes: false }, { readConfig: baseConfig, runCheckCore: fakeCore as any }))
      .rejects.toThrow(/inside a git repository/i);
  });
});
