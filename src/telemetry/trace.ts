/**
 * Per-run trace log: one JSONL file per check under ~/.checkapp/traces/<date>/<runId>.jsonl,
 * with one record per provider call (prompt, params, response, queries, tokens, latency).
 * It exists so runs can be inspected, compared and replayed when tuning prompts and models.
 *
 * - Off under test runners (NODE_ENV=test) unless CHECKAPP_TRACE_DIR is set; CHECKAPP_TRACE=0 disables it.
 * - Google Search grounded content (model text and grounding sources) is omitted unless
 *   CHECKAPP_TRACE_GROUNDED_CONTENT=1: the Gemini grounding terms restrict caching and
 *   analysing Grounded Results. Our own prompts, params, search queries and verdicts are kept.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { sanitizeProviderError } from "../audit/types.ts";
import type { Config } from "../config.ts";
import { isE2E } from "../e2e/mode.ts";

export interface TraceRecord {
  ts: string;
  runId: string;
  stage: string;
  provider?: string;
  model?: string;
  params?: unknown;
  prompt?: string;
  response?: string;
  searchQueries?: string[];
  sources?: unknown[];
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  latencyMs?: number;
  httpStatus?: number;
  error?: string;
  meta?: Record<string, unknown>;
  groundedContentOmitted?: boolean;
}

export type TraceInput = Omit<TraceRecord, "ts" | "runId" | "groundedContentOmitted"> & {
  /** True when the response comes from Google Search grounding. */
  grounded?: boolean;
};

interface RunContext {
  runId: string;
  file: string;
}

const runStore = new AsyncLocalStorage<RunContext>();

export function resolveTraceDir(): string | null {
  if (process.env.CHECKAPP_TRACE === "0") return null;
  // E2E runs replay fixtures; tracing them would fill the user's trace folder with mock calls.
  if (isE2E()) return null;
  if (process.env.CHECKAPP_TRACE_DIR) return process.env.CHECKAPP_TRACE_DIR;
  if (process.env.NODE_ENV === "test") return null;
  return join(homedir(), ".checkapp", "traces");
}

function runFile(dir: string, runId: string): string {
  return join(dir, new Date().toISOString().slice(0, 10), `${runId}.jsonl`);
}

function write(file: string, record: TraceRecord): void {
  try {
    // Owner-only, like history.db: records contain prompts that include article text.
    mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
    appendFileSync(file, `${JSON.stringify(record)}\n`, { encoding: "utf-8", mode: 0o600 });
  } catch (error) {
    // Tracing must never break a check.
    console.error(`Failed to write trace: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Runs `fn` as one traced check; every traceProviderCall inside it lands in the same file. */
export async function withTraceRun<T>(meta: Record<string, unknown>, fn: (runId: string) => Promise<T>): Promise<T> {
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const dir = resolveTraceDir();
  if (!dir) return fn(runId);
  pruneOldTraces(dir);
  const ctx: RunContext = { runId, file: runFile(dir, runId) };
  const startedAt = Date.now();
  write(ctx.file, { ts: new Date().toISOString(), runId, stage: "run.start", meta });
  try {
    const result = await runStore.run(ctx, () => fn(runId));
    write(ctx.file, { ts: new Date().toISOString(), runId, stage: "run.end", latencyMs: Date.now() - startedAt, meta: summarize(result) });
    return result;
  } catch (error) {
    write(ctx.file, {
      ts: new Date().toISOString(), runId, stage: "run.end", latencyMs: Date.now() - startedAt,
      error: sanitizeProviderError(error instanceof Error ? error.message : String(error)),
    });
    throw error;
  }
}

const DEFAULT_RETENTION_DAYS = 30;

/** Deletes <date> folders older than CHECKAPP_TRACE_RETENTION_DAYS (default 30). Never throws. */
function pruneOldTraces(dir: string): void {
  const configured = Number(process.env.CHECKAPP_TRACE_RETENTION_DAYS);
  const days = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_RETENTION_DAYS;
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  try {
    for (const name of readdirSync(dir)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(name) && name < cutoff) {
        rmSync(join(dir, name), { recursive: true, force: true });
      }
    }
  } catch {
    // Missing folder or permission issue: retention is best effort.
  }
}

/** Records one provider call. Outside a run it goes to <date>/adhoc.jsonl. */
export function traceProviderCall(input: TraceInput): void {
  const dir = resolveTraceDir();
  if (!dir) return;
  const ctx = runStore.getStore() ?? { runId: "adhoc", file: runFile(dir, "adhoc") };
  const { grounded, ...rest } = input;
  const record: TraceRecord = { ts: new Date().toISOString(), runId: ctx.runId, ...rest };
  if (record.error) record.error = sanitizeProviderError(record.error);
  if (grounded && process.env.CHECKAPP_TRACE_GROUNDED_CONTENT !== "1") {
    delete record.response;
    delete record.sources;
    record.groundedContentOmitted = true;
  }
  write(ctx.file, record);
}

function summarize(result: unknown): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const r = result as { results?: Array<{ skillId?: string; verdict?: string; score?: number; costUsd?: number }>; totalCostUsd?: number };
  if (!Array.isArray(r.results)) return undefined;
  return {
    totalCostUsd: r.totalCostUsd,
    skills: r.results.map((s) => ({ skillId: s.skillId, verdict: s.verdict, score: s.score, costUsd: s.costUsd })),
  };
}

/** run.start metadata: enough to identify a run without copying the article or any API key. */
export function traceRunMeta(text: string, config: Config): Record<string, unknown> {
  return {
    wordCount: text.split(/\s+/).filter(Boolean).length,
    articleSha256: createHash("sha256").update(text).digest("hex").slice(0, 16),
    skills: config.skills,
    providers: Object.fromEntries(Object.entries(config.providers ?? {}).map(([k, v]) => [k, v?.provider])),
    llmProvider: config.llmProvider,
    factCheckTier: config.factCheckTier,
  };
}
