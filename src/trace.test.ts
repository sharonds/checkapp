import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "./config.ts";
import { jsonResponse, mockFetch } from "./testing/mock-fetch.ts";
import { resolveTraceDir, traceProviderCall, withTraceRun, type TraceRecord } from "./telemetry/trace.ts";
import { FactCheckGroundedSkill } from "./skills/factcheck-grounded.ts";
import { checkPlagiarismGeminiGrounded } from "./plagiarism-gemini.ts";
import { checkAiDetectorGemini } from "./aidetector.ts";
import { runCheckCore } from "./checker-core.ts";
import { createInteraction, traceInteractionPoll } from "./utils/interactions-api.ts";

const ENV_KEYS = ["CHECKAPP_TRACE_DIR", "CHECKAPP_TRACE", "CHECKAPP_TRACE_GROUNDED_CONTENT"] as const;
let saved: Record<string, string | undefined> = {};
let dir = "";

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  dir = mkdtempSync(join(tmpdir(), "checkapp-trace-"));
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

function readRun(root: string): TraceRecord[] {
  const days = readdirSync(root);
  expect(days).toHaveLength(1);
  const files = readdirSync(join(root, days[0]!));
  expect(files).toHaveLength(1);
  return readFileSync(join(root, days[0]!, files[0]!), "utf-8").trim().split("\n").map((l) => JSON.parse(l));
}

describe("per-run trace log", () => {
  test("is off under the test runner unless CHECKAPP_TRACE_DIR is set", () => {
    expect(resolveTraceDir()).toBeNull();
    process.env.CHECKAPP_TRACE_DIR = dir;
    expect(resolveTraceDir()).toBe(dir);
  });

  test("is off in E2E mock mode", () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    const savedE2E = process.env.CHECKAPP_E2E;
    process.env.CHECKAPP_E2E = "1";
    try {
      expect(resolveTraceDir()).toBeNull();
    } finally {
      if (savedE2E === undefined) delete process.env.CHECKAPP_E2E;
      else process.env.CHECKAPP_E2E = savedE2E;
    }
  });

  test("starting a run deletes date folders older than the 30-day retention window", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    process.env.CHECKAPP_TRACE_DIR = dir;
    const old = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);
    for (const d of [old, recent, "not-a-date"]) {
      mkdirSync(join(dir, d));
      writeFileSync(join(dir, d, "x.jsonl"), "{}\n");
    }
    await withTraceRun({}, async () => undefined);
    const left = readdirSync(dir);
    expect(left).not.toContain(old);
    expect(left).toContain(recent);
    expect(left).toContain("not-a-date");
  });

  test("CHECKAPP_TRACE=0 disables tracing even with a directory", () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    process.env.CHECKAPP_TRACE = "0";
    expect(resolveTraceDir()).toBeNull();
  });

  test("writes run.start, each provider call, and run.end to one file per run", async () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    const runId = await withTraceRun({ source: "article.md" }, async (id) => {
      traceProviderCall({ stage: "llm", provider: "gemini", model: "m", prompt: "p", response: "r", latencyMs: 5 });
      return id;
    });
    const records = readRun(dir);
    expect(records.map((r) => r.stage)).toEqual(["run.start", "llm", "run.end"]);
    expect(records.every((r) => r.runId === runId)).toBe(true);
    expect(records[0]!.meta).toMatchObject({ source: "article.md" });
    expect(records[1]).toMatchObject({ provider: "gemini", model: "m", prompt: "p", response: "r", latencyMs: 5 });
  });

  test("omits Google grounded content by default (grounding ToS), keeps our params and queries", () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    traceProviderCall({
      stage: "gemini.grounded", provider: "gemini-grounded", grounded: true,
      prompt: "our prompt", response: "grounded text", sources: [{ url: "https://x" }], searchQueries: ["q"],
    });
    const [rec] = readRun(dir);
    expect(rec!.prompt).toBe("our prompt");
    expect(rec!.searchQueries).toEqual(["q"]);
    expect(rec!.response).toBeUndefined();
    expect(rec!.sources).toBeUndefined();
    expect(rec!.groundedContentOmitted).toBe(true);
  });

  test("keeps grounded content when CHECKAPP_TRACE_GROUNDED_CONTENT=1", () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    process.env.CHECKAPP_TRACE_GROUNDED_CONTENT = "1";
    traceProviderCall({ stage: "gemini.grounded", provider: "gemini-grounded", grounded: true, response: "grounded text" });
    expect(readRun(dir)[0]!.response).toBe("grounded text");
  });

  test("trace files are owner-only (they contain prompts with article text)", async () => {
    const { statSync } = await import("node:fs");
    process.env.CHECKAPP_TRACE_DIR = join(dir, "nested");
    traceProviderCall({ stage: "llm", provider: "gemini", prompt: "article text" });
    const day = readdirSync(join(dir, "nested"))[0]!;
    const file = readdirSync(join(dir, "nested", day))[0]!;
    expect(statSync(join(dir, "nested", day, file)).mode & 0o777).toBe(0o600);
    expect(statSync(join(dir, "nested", day)).mode & 0o777).toBe(0o700);
  });

  test("redacts API keys from error strings", () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    // Built at runtime so secret scanners don't flag a literal key-shaped string.
    const fakeKey = ["AI", "za", "SyB", "1234567890abcdefghijklmn"].join("");
    traceProviderCall({ stage: "llm", provider: "gemini", error: `failed https://h/x?key=${fakeKey}` });
    const raw = readFileSync(join(dir, readdirSync(dir)[0]!, readdirSync(join(dir, readdirSync(dir)[0]!))[0]!), "utf-8");
    expect(raw).not.toContain(fakeKey);
  });

  test("a grounded fact-check run traces extraction and each grounded call", async () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    mockFetch(async (req) => {
      const body = await req.json() as { tools?: unknown };
      if (!body.tools) {
        return jsonResponse({ candidates: [{ content: { parts: [{ text: '[{"assertion":"A is B","source":"A is B."}]' }] } }] });
      }
      return jsonResponse({
        candidates: [{
          content: { parts: [{ text: '{"supported":true,"note":"ok"}' }] },
          groundingMetadata: { webSearchQueries: ["a is b"], groundingChunks: [{ web: { uri: "https://s", title: "S" } }] },
        }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      });
    });
    const config: Config = {
      copyscapeUser: "", copyscapeKey: "", geminiApiKey: "gemini-key",
      skills: { plagiarism: false, aiDetection: false, seo: false, factCheck: true, tone: false, legal: false, summary: false, brief: false, purpose: false },
      providers: { "fact-check": { provider: "gemini-grounded" } },
    };
    await withTraceRun({ source: "t" }, () => new FactCheckGroundedSkill().run("A is B.", config));
    const records = readRun(dir);
    const extraction = records.find((r) => r.stage === "llm");
    const grounded = records.find((r) => r.stage === "gemini.grounded");
    expect(extraction?.prompt).toContain("A is B.");
    expect(extraction?.response).toContain("assertion");
    expect(grounded).toMatchObject({ provider: "gemini-grounded", httpStatus: 200, searchQueries: ["a is b"] });
    expect((grounded?.params as any)?.generationConfig?.thinkingConfig?.thinkingLevel).toBe("high");
    expect(grounded?.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
    expect(typeof grounded?.latencyMs).toBe("number");
    expect(existsSync(join(tmpdir(), "should-not-exist"))).toBe(false);
  });

  test("Gemini plagiarism (grounded) and AI detection calls are traced", async () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    mockFetch(async (req) => {
      const body = await req.json() as { tools?: unknown };
      return jsonResponse({
        candidates: [{ content: { parts: [{ text: body.tools
          ? '{"verdict":"publish","similarity":0,"confidence":"low","matches":[]}'
          : '{"aiScore":0.2,"segments":[]}' }] } }],
        usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 },
      });
    });
    const config: Config = {
      copyscapeUser: "", copyscapeKey: "", geminiApiKey: "gemini-key",
      skills: { plagiarism: true, aiDetection: true, seo: false, factCheck: false, tone: false, legal: false, summary: false, brief: false, purpose: false },
      providers: { plagiarism: { provider: "gemini-grounded-plagiarism", apiKey: "gemini-key" } },
    };
    await withTraceRun({ source: "t" }, async () => {
      await checkPlagiarismGeminiGrounded("Some article text.", config);
      await checkAiDetectorGemini("Some article text.", config);
    });
    const records = readRun(dir);
    const plag = records.find((r) => r.stage === "gemini.plagiarism");
    const ai = records.find((r) => r.stage === "gemini.ai-detection");
    expect(plag).toMatchObject({ provider: "gemini-grounded-plagiarism", httpStatus: 200, groundedContentOmitted: true });
    expect(plag?.prompt).toContain("Some article text.");
    expect(ai).toMatchObject({ provider: "gemini-ai-detection", httpStatus: 200 });
    expect(ai?.response).toContain("aiScore");
  });

  test("Deep Research create is traced", async () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    mockFetch(async () => jsonResponse({ id: "int-1" }));
    await withTraceRun({ source: "t" }, () => createInteraction("gemini-key", { agent: "deep-research-preview-04-2026", input: "article" }));
    const rec = readRun(dir).find((r) => r.stage === "deep-research.create");
    expect(rec).toMatchObject({ provider: "gemini-deep-research", model: "deep-research-preview-04-2026", httpStatus: 200 });
    expect(rec?.prompt).toBe("article");
  });

  test("grounded HTTP errors keep the error text in the trace", async () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS = "0";
    mockFetch(async (req) => {
      const body = await req.json() as { tools?: unknown };
      if (!body.tools) return jsonResponse({ candidates: [{ content: { parts: [{ text: '[{"assertion":"A is B","source":"A is B."}]' }] } }] });
      return jsonResponse({ error: "bad" }, 400);
    });
    const config: Config = {
      copyscapeUser: "", copyscapeKey: "", geminiApiKey: "gemini-key",
      skills: { plagiarism: false, aiDetection: false, seo: false, factCheck: true, tone: false, legal: false, summary: false, brief: false, purpose: false },
      providers: { "fact-check": { provider: "gemini-grounded" } },
    };
    try {
      await withTraceRun({}, () => new FactCheckGroundedSkill().run("A is B.", config));
    } finally {
      delete process.env.CHECKAPP_GROUNDED_RETRY_DELAY_MS;
    }
    const failed = readRun(dir).find((r) => r.stage === "gemini.grounded" && r.httpStatus === 400);
    expect(failed?.error).toContain("HTTP 400");
  });

  test("Deep Research polls record status; report text is grounded content", () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    traceInteractionPoll("int-1", 200, {
      id: "int-1", status: "completed",
      steps: [{ type: "model_output", content: [{ type: "text", text: "Report" }] }],
    }, 12);
    const [rec] = readRun(dir);
    expect(rec).toMatchObject({ stage: "deep-research.poll", httpStatus: 200, latencyMs: 12, groundedContentOmitted: true });
    expect(rec!.meta).toMatchObject({ interactionId: "int-1", status: "completed", textLength: 6 });
  });

  test("a full check is one traced run whose run.end summarises skill verdicts", async () => {
    process.env.CHECKAPP_TRACE_DIR = dir;
    const config: Config = {
      copyscapeUser: "", copyscapeKey: "",
      skills: { plagiarism: false, aiDetection: false, seo: true, factCheck: false, tone: false, legal: false, summary: false, brief: false, purpose: false },
    };
    await runCheckCore("# Title\n\nA short article about tracing.", config);
    const records = readRun(dir);
    expect(records[0]!.stage).toBe("run.start");
    expect(records[0]!.meta).toMatchObject({ wordCount: expect.any(Number) });
    const end = records.at(-1)!;
    expect(end.stage).toBe("run.end");
    expect((end.meta as any).skills.map((s: any) => s.skillId)).toContain("seo");
  });
});
