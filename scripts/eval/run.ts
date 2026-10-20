/**
 * Fact-check evaluation runner.
 *
 *   bun scripts/eval/run.ts --labels <labels.json> --corpus <dir> --variant <variant.json> \
 *     --out <private dir> --mode dry-run|live|record|replay [--docs a.md,b.md] [--yes] [--allow-grounded-recording]
 *     [--reuse-recorded]   (record mode: serve requests already in the variant's cassette, call live on a miss)
 *
 * labels.json: [{ id, doc, class, sentence, verdict }]; doc is a file name inside --corpus.
 * variant.json: { name, config?: Partial<Config>, env?: Record<string,string> }.
 * Inputs and outputs may hold client content, so --out must be outside every git repository.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../../src/config.ts";
import type { CoreResult } from "../../src/checker-core.ts";
import { Cassette } from "./cassette.ts";
import { assertOutsideGitRepo } from "./paths.ts";
import { appClaimsFromAudit, computeMetrics, normalizeSentence, scoreRows, type AppClaim, type GoldRow, type Metrics, type Rate } from "./scoring.ts";

export type EvalMode = "dry-run" | "live" | "record" | "replay";

export interface EvalOptions {
  labels: string;
  corpus: string;
  variant: string;
  out: string;
  mode: EvalMode;
  yes: boolean;
  docs?: string[];
  allowGroundedRecording?: boolean;
  /** Record mode: reuse responses already in this variant's cassette (e.g. hold extraction fixed). */
  reuseRecorded?: boolean;
}

export interface EvalDeps {
  readConfig: () => Config;
  runCheckCore: (text: string, config: Config) => Promise<CoreResult>;
  exaPrototype?: { search: (q: string, o?: unknown) => Promise<unknown> };
}

interface Variant {
  name: string;
  config?: Partial<Config>;
  env?: Record<string, string>;
}

export interface EvalReport {
  runDir: string;
  missingSentences: string[];
  metrics: Metrics;
}

// Rough per-claim spend for the up-front estimate only (grounded ≈ registry figure; Exa basic much less).
const ROUGH_COST_PER_CLAIM = { grounded: 0.04, basic: 0.01 };

function writePrivate(path: string, content: string): void {
  writeFileSync(path, content, { encoding: "utf-8", mode: 0o600 });
}

function buildConfig(base: Config, variant: Variant): Config {
  const v = variant.config ?? {};
  const skillsOff = Object.fromEntries(Object.keys(base.skills ?? {}).map((k) => [k, false])) as unknown as Config["skills"];
  return {
    ...base,
    ...v,
    // Only fact-check runs: other skills would add cost and noise to the measurement.
    skills: { ...skillsOff, ...(v.skills ?? {}), factCheck: true },
    providers: { ...(base.providers ?? {}), ...(v.providers ?? {}) },
    factAudit: { ...(base.factAudit ?? {}), ...(v.factAudit ?? {}) },
  } as Config;
}

function withEnv<T>(env: Record<string, string>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  return fn().finally(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

function pct(r: Rate): string {
  if (r.value === null) return "n/a (n=0)";
  return `${(r.value * 100).toFixed(1)}% (${r.k}/${r.n}; 95% CI ${(r.ci95[0] * 100).toFixed(0)}–${(r.ci95[1] * 100).toFixed(0)}%)`;
}

function summaryMarkdown(variant: Variant, mode: EvalMode, docs: string[], m: Metrics): string {
  const lines = [
    `# Fact-check eval — ${variant.name}`,
    "",
    `Mode: ${mode} · Documents: ${docs.length} · Scorable claims: ${m.counts.scorable} (true ${m.counts.goldTrue}, false/partial ${m.counts.goldFalse}) · Traceability: ${m.counts.traceability} · Excluded: ${m.counts.excluded}`,
    ...(m.counts.providerErrors ? ["", `**Warning:** ${m.counts.providerErrors} gold claims got only provider errors; they count as not checked. Check the traces before trusting these numbers.`] : []),
    "",
    "| Metric | Value |",
    "|---|---|",
    `| **Recall on false/partial claims (lenient: unsupported or unverified)** | ${pct(m.recallFalseLenient)} |`,
    `| Recall on false/partial claims (strict: unsupported) | ${pct(m.recallFalseStrict)} |`,
    `| Recall on false/partial claims the app checked | ${pct(m.matchedRecallFalseLenient)} |`,
    `| False-alarm rate on true claims it checked (strict: unsupported) | ${pct(m.falseAlarmRate)} |`,
    `| False-alarm rate on true claims it checked (lenient: unsupported or unverified) | ${pct(m.falseAlarmRateLenient)} |`,
    `| Coverage (scorable claims checked at all) | ${pct(m.coverage)} |`,
    `| Traceability claims flagged | ${pct(m.traceabilityFlagRate)} |`,
    `| Cohen's kappa (gold false vs unsupported) | ${m.kappa === null ? "n/a" : m.kappa.toFixed(2)} |`,
    `| Reported cost per article | ${m.costPerArticleUsd === null ? "n/a" : `$${m.costPerArticleUsd.toFixed(3)}`} |`,
    `| Latency per article p50 / p90 | ${m.latencyMs.p50 ?? "n/a"} / ${m.latencyMs.p90 ?? "n/a"} ms |`,
    "",
    "## By class",
    "",
    "| Class | Recall false (lenient) | False alarms | Coverage |",
    "|---|---|---|---|",
    ...Object.entries(m.byClass).map(([c, r]) => `| ${c} | ${pct(r.recallFalseLenient)} | ${pct(r.falseAlarmRate)} | ${pct(r.coverage)} |`),
    "",
    "Reported cost is CheckApp's own estimate, not the provider bill.",
  ];
  return lines.join("\n") + "\n";
}

export async function runEval(opts: EvalOptions, deps: EvalDeps): Promise<EvalReport> {
  assertOutsideGitRepo(opts.out);
  const variant = JSON.parse(readFileSync(opts.variant, "utf-8")) as Variant;
  if (!/^[\w.-]+$/.test(variant.name ?? "") || variant.name.startsWith(".")) {
    throw new Error(`Invalid variant name ${JSON.stringify(variant.name)}: use letters, digits, ".", "_" or "-".`);
  }
  const allGold = JSON.parse(readFileSync(opts.labels, "utf-8")) as GoldRow[];
  const gold = opts.docs?.length ? allGold.filter((g) => opts.docs!.includes(g.doc)) : allGold;
  const docs = [...new Set(gold.map((g) => g.doc))];

  const texts = new Map<string, string>();
  for (const doc of docs) {
    const path = join(opts.corpus, doc);
    if (!existsSync(path)) throw new Error(`Corpus document missing: ${doc}`);
    texts.set(doc, readFileSync(path, "utf-8"));
  }
  const missingSentences = gold
    .filter((g) => !normalizeSentence(texts.get(g.doc)!).includes(normalizeSentence(g.sentence)))
    .map((g) => g.id);

  const runDir = join(opts.out, variant.name, `${new Date().toISOString().replace(/[:.]/g, "-")}-${opts.mode}`);
  mkdirSync(join(runDir, "docs"), { recursive: true, mode: 0o700 });

  // config.ts reads LLM_PROVIDER and the API keys at read time, so read it inside the variant env.
  const variantEnv = { ...(variant.env ?? {}), CHECKAPP_TRACE_DIR: join(runDir, "traces") };
  const config = await withEnv(variantEnv, async () => buildConfig(deps.readConfig(), variant));
  if (opts.mode === "dry-run") {
    const metrics = computeMetrics(scoreRows(gold, []), []);
    writePrivate(join(runDir, "dry-run.json"), JSON.stringify({ docs, missingSentences, labelled: gold.filter((g) => g.verdict).length }, null, 1));
    return { runDir, missingSentences, metrics };
  }

  if (opts.mode !== "replay" && !opts.yes) {
    const grounded = config.factCheckTier === "standard" || config.providers?.["fact-check"]?.provider === "gemini-grounded";
    const perDoc = (config.factAudit?.standardMaxClaims ?? 4) * (grounded ? ROUGH_COST_PER_CLAIM.grounded : ROUGH_COST_PER_CLAIM.basic);
    throw new Error(`Estimated spend ≈ $${(perDoc * docs.length).toFixed(2)} for ${docs.length} documents (rough). Re-run with --yes to proceed.`);
  }

  const cassette = opts.mode === "live"
    ? null
    : new Cassette(join(opts.out, variant.name, "cassette.json"), opts.mode, { allowGrounded: !!opts.allowGroundedRecording, reuseRecorded: !!opts.reuseRecorded });
  const realFetch = globalThis.fetch;
  let restoreExa = () => {};
  const appClaims: AppClaim[] = [];
  const runs: Array<{ doc: string; costUsd: number; wallMs: number }> = [];
  try {
    if (cassette) {
      globalThis.fetch = cassette.fetch as typeof fetch;
      const proto = deps.exaPrototype ?? ((await import("exa-js")).default.prototype as unknown as EvalDeps["exaPrototype"]);
      if (proto) restoreExa = cassette.wrapExa(proto);
    }
    await withEnv(variantEnv, async () => {
      for (const doc of docs) {
        const started = Date.now();
        const core = await deps.runCheckCore(texts.get(doc)!, config);
        const wallMs = Date.now() - started;
        const fact = core.results.find((r) => r.skillId.startsWith("fact-check"));
        const claims = appClaimsFromAudit(doc, core.audit as never);
        appClaims.push(...claims);
        runs.push({ doc, costUsd: fact?.costUsd ?? 0, wallMs });
        writePrivate(join(runDir, "docs", `${doc}.json`), JSON.stringify({ doc, wallMs, costUsd: fact?.costUsd, verdict: fact?.verdict, summary: fact?.summary, claims }, null, 1));
      }
    });
  } finally {
    globalThis.fetch = realFetch;
    restoreExa();
    if (cassette && opts.mode === "record") cassette.save();
  }

  const rows = scoreRows(gold, appClaims);
  const metrics = computeMetrics(rows, runs);
  // Replayed responses are instant, so their wall-clock time says nothing about latency.
  if (opts.mode === "replay") metrics.latencyMs = { p50: null, p90: null };
  writePrivate(join(runDir, "rows.json"), JSON.stringify(rows, null, 1));
  writePrivate(join(runDir, "metrics.json"), JSON.stringify({ variant: variant.name, mode: opts.mode, docs, metrics }, null, 1));
  writePrivate(join(runDir, "summary.md"), summaryMarkdown(variant, opts.mode, docs, metrics));
  return { runDir, missingSentences, metrics };
}

function parseArgs(argv: string[]): EvalOptions {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const need = (name: string) => {
    const v = get(name);
    if (!v) throw new Error(`Missing --${name}`);
    return v;
  };
  const mode = need("mode") as EvalMode;
  if (!["dry-run", "live", "record", "replay"].includes(mode)) throw new Error(`Unknown --mode ${mode}`);
  return {
    labels: need("labels"),
    corpus: need("corpus"),
    variant: need("variant"),
    out: need("out"),
    mode,
    yes: argv.includes("--yes"),
    docs: get("docs")?.split(",").filter(Boolean),
    allowGroundedRecording: argv.includes("--allow-grounded-recording"),
    reuseRecorded: argv.includes("--reuse-recorded"),
  };
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2));
  const { readConfig } = await import("../../src/config.ts");
  const { runCheckCore } = await import("../../src/checker-core.ts");
  const report = await runEval(opts, { readConfig, runCheckCore });
  if (report.missingSentences.length) {
    console.log(`Gold sentences not found in their document: ${report.missingSentences.join(", ")}`);
  }
  console.log(`Results: ${report.runDir}`);
  if (opts.mode !== "dry-run") console.log(readFileSync(join(report.runDir, "summary.md"), "utf-8"));
}
