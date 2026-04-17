# Changelog

All notable changes to CheckApp are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.0] — 2026-04-18 — Phase 7: Research-Backed Editor

Every flagged issue now ships with evidence, a rewrite suggestion, and a citation.
The four-output contract lands on a single finding via the new enricher pipeline.

### Added

- **Grammar & Style skill** — LanguageTool-backed with LLM fallback. Each
  finding carries a `rewrite` string. LLM-generated rewrites are re-checked
  through LanguageTool to correct mechanical errors (R9). (#14)
- **Academic Citations skill** — Semantic Scholar integration (free, no key).
  New `EnricherSkill` interface + `enrichFindings()` merges DOIs onto matching
  fact-check findings by quoted claim (R8). (#15)
- **Self-Plagiarism skill** — Cloudflare Vectorize similarity search (with
  Pinecone / Upstash Vector options). New `checkapp index <dir>` CLI subcommand
  ingests past articles. Flags overlaps ≥ 0.85 similarity with past-article
  metadata and rewrite suggestion. (#16)
- **Provider abstraction layer** — `resolveProvider(config, skillId)` picks a
  provider per skill with legacy flat-key fallback. Registry of 15 providers
  with speed / cost / depth / free-tier / key-required metadata. (#12)
- **Settings → Providers UI** — per-skill provider picker with chips and
  saved-state indicators. Dashboard `/api/providers` GET/PUT with
  `X-CheckApp-CSRF` header + localhost origin guard (R5). GET masks apiKeys;
  PUT writes to `~/.checkapp/config.json`. (#17)
- **Claim drill-down side panel** — every finding with sources, citations, or
  rewrite gets a "View evidence (N)" button that opens a side panel surfacing
  all three outputs with quoted excerpts and DOI links (R12). (#18)
- **Pre-flight cost estimator** — `checkapp --estimate-cost article.md`
  prints per-skill cost breakdown and provider-limit warnings before spending
  anything. Dashboard Run Check page shows a live cost estimate as users type
  (R11). (#18)
- **Fact-check upgrades** — every finding carries `sources[]` from Exa
  highlights. New `claimType` field classifies each claim as scientific /
  medical / financial / general. New `--deep-fact-check` flag routes through
  Exa's deep-reasoning API (R1). (#13)
- **MCP output schema** documented — `check_article` tool description
  surfaces the extended `Finding` shape so downstream agents handle the new
  optional fields gracefully (R4). (#19)
- **Automated E2E test** — `tests/e2e/phase7.test.ts` asserts the unified
  four-output contract on a single fact-check finding with fully-mocked
  upstream services (R19). (#19)
- **Registry drift guard** — `scripts/check-registry-parity.ts` CI-fails if
  `src/providers/registry.ts` and `dashboard/src/lib/providers.ts` diverge
  on provider IDs (R16). (#19)

### Changed

- **SkillRegistry.runAll** refactored into two phases: primary skills in
  parallel → enrichers with `priorResults` → `enrichFindings()` merge (R8).
- **Fact-check costs** — deep-reasoning is $0.025/claim (down from the
  $0.04 initially estimated); standard remains $0.007/claim.
- **`writeConfig`** is now async and wrapped in `proper-lockfile` to
  serialize concurrent writes between the CLI (`--deep-fact-check`) and the
  dashboard (`PUT /api/providers`) (R15).
- **Dashboard DB init** — lazy `getDb()` singleton with parent-directory
  auto-mkdir replaces module-load `new Database(...)`. Pages that query
  the DB at render time now export `dynamic = "force-dynamic"` so Next.js
  doesn't try to open SQLite during static generation (R20).

### Fixed

- **Report replay crash on pre-Phase-7 blobs** — `normalizeSkillResult`
  coerces old JSON blobs (missing `sources[]` / `citations[]` / `rewrite`)
  into the new shape so `ClaimDrillDown` can safely `.map()` over optional
  arrays (R3). (#11, #17)
- **Test mock leakage** — new `src/testing/mock-fetch.ts` helper with
  module-scoped `afterEach` auto-reset prevents cross-file `globalThis.fetch`
  mock leakage that bun:test does not guard natively (R7). (#11)
- **429 / 5xx retries** — new `fetchWithBackoff` helper for LanguageTool
  (20 req/min managed cap), Semantic Scholar (100/5min unauth), Exa, and
  Cloudflare Vectorize (R14). (#11)
- **Dashboard CI build failure on fresh runners** — Next.js prerender no
  longer opens `better-sqlite3` at module load (was crashing with "Cannot
  open database because the directory does not exist" on PR #8). (#11)
- **HTML escaping in `regenerate-panel.tsx`** — backslash characters now
  escaped before interpolation (PR #7 CodeQL alert).
- **Silent-green stubs** — grammar / academic / self-plagiarism skill stubs
  now return `verdict: "warn"` with an info finding pointing at the
  implementing batch, rather than `verdict: "pass"` with empty findings.
  (#12)
- **Self-plagiarism upsert batching** — `checkapp index` splits into chunks
  of 500 vectors (below Cloudflare Vectorize's 1000-per-request cap);
  archives >1k articles no longer OOM or 4xx (R2). (#16)
- **`/api/providers` GET apiKey leak** — response is now masked, returning
  only `{ provider, extra }` per skill plus a `hasKey` boolean map. Inline
  comment claimed masking but code didn't mask. (#17)
- **`ClaimDrillDown` null-guard** — now renders when ONLY `rewrite` is
  present (grammar findings' rewrites were previously invisible in the
  dashboard). (#18)
- **`--deep-fact-check` apiKey resolution** — uses `resolveProvider` first,
  then falls back to `config.exaApiKey`. Previously overwrote apiKey with
  `undefined` for users who migrated to the new `providers` config (R10).
  (#13)
- **Env-var key exfil risk** — `CHECKAPP_DEEP_FACT_CHECK_KEY` is now
  unconditionally unset after the run via `try/finally` + `process.once("exit")`
  handler, preventing leak into spawned child processes. (#13)
- **Exa SDK contract** — uses `exa.search(q, { type: "deep-reasoning" })`
  against the unified `/search` endpoint, not the deprecated
  `/research/v1` / `researchTask` method (R1). (#13)
- **Vectorize v2 upsert shape** — NDJSON multipart/form-data with `vectors`
  file field, not a JSON `{ vectors: [...] }` body (R2). (#16)
- **Cost estimator honesty** — fact-check × 4 claims (was unscaled),
  self-plagiarism embedding cost scales with token count, LanguageTool
  managed-tier 20KB warning when articles exceed the per-request cap (R11).
  (#18)

### Security

- **BYOK alpha scope** documented in new `docs/security.md`: API keys are
  stored plaintext at `~/.checkapp/config.json` (protect with `chmod 600`),
  dashboard binds to localhost only. At-rest encryption + OS keychain
  integration are tracked for Phase 7.5+.
- **CSRF token** (`~/.checkapp/csrf.token`, 32 hex bytes, mode 0600) now
  required on `/api/providers` PUT via `X-CheckApp-CSRF` header.
- **Origin guard** on `/api/providers` PUT rejects non-localhost host
  headers → 403.
- **`safeHref` / `sanitizeText` helpers** applied to all new dashboard
  user-content sinks (Exa source URLs, Semantic Scholar titles, Vectorize
  metadata, LLM rewrites) — blocks `javascript:` / `data:` / `vbscript:` /
  `file:` schemes, strips C0 control chars (R21). (#18)

### Deferred to Phase 7.5

- Parallel Task as second deep-reasoning provider (Exa Deep ships first
  per roadmap §7)
- Copysentry post-publish monitoring
- Cross-provider transient-failure fallback chain
- Unicode bidi / zero-width joiner stripping in `sanitizeText`
- OS keychain integration for API keys

## [1.0.0] — 2026-04-16 — CheckApp rebrand

Rebranded from `article-checker` → `checkit` → `checkapp`. See repository
history for full details. Legacy config directories (`~/.article-checker`,
`~/.checkit`) are auto-migrated to `~/.checkapp` on first run.

[Unreleased]: https://github.com/sharonds/checkapp/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/sharonds/checkapp/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/sharonds/checkapp/releases/tag/v1.0.0
