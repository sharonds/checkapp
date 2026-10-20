/**
 * Scores CheckApp fact-check output against human gold labels.
 *
 * Gold rows are matched to the app's checked claims by sentence (the app records the
 * verbatim article sentence each claim came from). A gold row may match several app
 * claims; it counts as flagged if any of them is flagged.
 */

export type GoldVerdict =
  | "supported" | "partially_supported" | "misattributed" | "unsupported" | "fabricated"
  | "not_publicly_verifiable" | "not_checkworthy" | "skip";

export interface GoldRow {
  id: string;
  doc: string;
  class: string;
  sentence: string;
  verdict?: GoldVerdict;
}

export interface AppClaim {
  doc: string;
  quote: string;
  status: string;
}

export type GoldBinary = "true" | "false" | "excluded" | "traceability";

export interface RowScore {
  id: string;
  doc: string;
  class: string;
  goldBinary: GoldBinary;
  matched: boolean;
  appStatuses: readonly string[];
  /** The app said "unsupported". */
  flaggedStrict: boolean;
  /** The app said "unsupported" or "unverified" (a human would review it). */
  flaggedLenient: boolean;
  /** The app tried to check this sentence but the provider failed; not counted as checked. */
  providerError: boolean;
}

export interface Rate {
  value: number | null;
  k: number;
  n: number;
  ci95: [number, number];
}

export interface Metrics {
  counts: { scorable: number; goldTrue: number; goldFalse: number; traceability: number; excluded: number; providerErrors: number };
  /** Share of gold-false claims the app flagged, counting claims it never checked as misses. The product metric. */
  recallFalseStrict: Rate;
  recallFalseLenient: Rate;
  /** Same, but only over gold-false claims the app actually checked: verdict quality without extraction misses. */
  matchedRecallFalseLenient: Rate;
  /** Share of checked gold-true claims the app called unsupported. */
  falseAlarmRate: Rate;
  /** Share of checked gold-true claims the app called unsupported or unverified; pairs with lenient recall. */
  falseAlarmRateLenient: Rate;
  /** Share of scorable gold claims the app checked at all. */
  coverage: Rate;
  /** Share of traceability rows (claims only the client could confirm) the app flagged. */
  traceabilityFlagRate: Rate;
  /** Cohen's kappa, gold false vs app unsupported, over checked scorable claims. */
  kappa: number | null;
  byClass: Record<string, { recallFalseLenient: Rate; falseAlarmRate: Rate; coverage: Rate }>;
  costPerArticleUsd: number | null;
  latencyMs: { p50: number | null; p90: number | null };
}

const FALSE_VERDICTS = new Set<GoldVerdict>(["partially_supported", "misattributed", "unsupported", "fabricated"]);

export function normalizeSentence(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[\u0591-\u05BD\u05BF-\u05C7]/g, "") // niqqud and cantillation
    .replace(/\u05BE/g, "-") // maqaf
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "") // zero-width and bidi marks
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // markdown links → text
    .replace(/[*_#|>`]/g, " ")
    .replace(/[״“”„]/g, '"')
    .replace(/[׳‘’]/g, "'")
    .replace(/[‐-―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s.:;!?,"']+$/u, "")
    .replace(/^[\s"']+/u, "")
    .toLowerCase();
}

function numbersIn(s: string): string[] {
  return (s.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, ""));
}

function tokens(s: string): Set<string> {
  return new Set(s.split(/[\s,;:()"'-]+/).filter(Boolean));
}

export function sentencesMatch(a: string, b: string): boolean {
  const na = normalizeSentence(a);
  const nb = normalizeSentence(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (isDecimalSplitFragment(short, long)) return true;
  // A planted error usually changes one number; never treat different numbers as the same sentence.
  const longNums = new Set(numbersIn(long));
  if (!numbersIn(short).every((n) => longNums.has(n))) return false;
  if (long.includes(short) && short.length >= 0.5 * long.length) return true;
  const ta = tokens(na);
  const tb = tokens(nb);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const jaccard = inter / (ta.size + tb.size - inter);
  return jaccard >= 0.6;
}

/**
 * The audit's sentence splitter breaks on every ".", so "holds 1.7 litres" can come back as the
 * quote "holds 1." or "7 litres". Accept a fragment of the gold sentence cut at a decimal point.
 */
function isDecimalSplitFragment(short: string, long: string): boolean {
  if (short.length < 8) return false;
  const at = long.indexOf(short);
  if (at < 0) return false;
  const cutBefore = /\d\.$/.test(long.slice(0, at)) && /^\d/.test(short);
  const cutAfter = /\d$/.test(short) && /^\.\d/.test(long.slice(at + short.length));
  return cutBefore || cutAfter;
}

/** Flattens a fact-check AuditRecord into one entry per checked claim. */
export function appClaimsFromAudit(
  doc: string,
  audit: { claims?: Array<{ id: string; quote: string }>; factAssessments?: Array<{ claimId: string; status: string }> } | undefined,
): AppClaim[] {
  const status = new Map((audit?.factAssessments ?? []).map((a) => [a.claimId, a.status]));
  return (audit?.claims ?? [])
    .filter((c) => status.has(c.id))
    .map((c) => ({ doc, quote: c.quote, status: status.get(c.id)! }));
}

function goldBinary(row: GoldRow): GoldBinary {
  if (!row.verdict || row.verdict === "skip" || row.verdict === "not_checkworthy") return "excluded";
  if (row.class === "traceability" || row.verdict === "not_publicly_verifiable") return "traceability";
  return FALSE_VERDICTS.has(row.verdict) ? "false" : "true";
}

export function scoreRows(gold: GoldRow[], app: AppClaim[]): RowScore[] {
  return gold.map((row) => {
    const all = app
      .filter((c) => c.doc === row.doc && sentencesMatch(row.sentence, c.quote))
      .map((c) => c.status);
    const statuses = all.filter((s) => s !== "provider_error");
    return {
      id: row.id,
      doc: row.doc,
      class: row.class,
      goldBinary: goldBinary(row),
      matched: statuses.length > 0,
      appStatuses: statuses,
      flaggedStrict: statuses.includes("unsupported"),
      flaggedLenient: statuses.some((s) => s === "unsupported" || s === "unverified"),
      providerError: statuses.length === 0 && all.length > 0,
    };
  });
}

/** Wilson score interval, 95%. */
export function wilson(k: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function rate(k: number, n: number): Rate {
  return { value: n === 0 ? null : k / n, k, n, ci95: wilson(k, n) };
}

function count<T>(items: readonly T[], pred: (t: T) => boolean): number {
  return items.filter(pred).length;
}

function coreRates(rows: readonly RowScore[]) {
  const falses = rows.filter((r) => r.goldBinary === "false");
  const trues = rows.filter((r) => r.goldBinary === "true");
  const scorable = [...falses, ...trues];
  const matchedTrues = trues.filter((r) => r.matched);
  return {
    recallFalseLenient: rate(count(falses, (r) => r.flaggedLenient), falses.length),
    falseAlarmRate: rate(count(matchedTrues, (r) => r.flaggedStrict), matchedTrues.length),
    falseAlarmRateLenient: rate(count(matchedTrues, (r) => r.flaggedLenient), matchedTrues.length),
    coverage: rate(count(scorable, (r) => r.matched), scorable.length),
  };
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
}

function cohenKappa(pairs: Array<[boolean, boolean]>): number | null {
  const n = pairs.length;
  if (n === 0) return null;
  const agree = count(pairs, ([g, a]) => g === a) / n;
  const pg = count(pairs, ([g]) => g) / n;
  const pa = count(pairs, ([, a]) => a) / n;
  const expected = pg * pa + (1 - pg) * (1 - pa);
  return expected === 1 ? null : (agree - expected) / (1 - expected);
}

export function computeMetrics(
  rows: readonly RowScore[],
  runs: ReadonlyArray<{ doc: string; costUsd: number; wallMs: number }>,
): Metrics {
  const falses = rows.filter((r) => r.goldBinary === "false");
  const trues = rows.filter((r) => r.goldBinary === "true");
  const trace = rows.filter((r) => r.goldBinary === "traceability");
  const matchedFalses = falses.filter((r) => r.matched);
  const core = coreRates(rows);
  const classes = [...new Set(rows.map((r) => r.class))];
  const wall = runs.map((r) => r.wallMs).sort((a, b) => a - b);
  const kappaPairs = [...falses, ...trues]
    .filter((r) => r.matched)
    .map((r): [boolean, boolean] => [r.goldBinary === "false", r.flaggedStrict]);
  return {
    counts: {
      scorable: falses.length + trues.length,
      goldTrue: trues.length,
      goldFalse: falses.length,
      traceability: trace.length,
      excluded: count(rows, (r) => r.goldBinary === "excluded"),
      providerErrors: count(rows, (r) => r.providerError),
    },
    recallFalseStrict: rate(count(falses, (r) => r.flaggedStrict), falses.length),
    recallFalseLenient: core.recallFalseLenient,
    matchedRecallFalseLenient: rate(count(matchedFalses, (r) => r.flaggedLenient), matchedFalses.length),
    falseAlarmRate: core.falseAlarmRate,
    falseAlarmRateLenient: core.falseAlarmRateLenient,
    coverage: core.coverage,
    traceabilityFlagRate: rate(count(trace, (r) => r.flaggedLenient), trace.length),
    kappa: cohenKappa(kappaPairs),
    byClass: Object.fromEntries(classes.map((c) => [c, coreRates(rows.filter((r) => r.class === c))])),
    costPerArticleUsd: runs.length ? runs.reduce((s, r) => s + r.costUsd, 0) / runs.length : null,
    latencyMs: { p50: percentile(wall, 0.5), p90: percentile(wall, 0.9) },
  };
}
