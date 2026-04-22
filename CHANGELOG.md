# Changelog

All notable changes to CheckApp are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Dependency majors**
  - **Root runtime majors coordinated upgrade** (#36): `react` ^18 → ^19.2, `@types/react` ^18 → ^19.2, `ink` ^5 → ^7. Ink 7 requires React 19 — merged as one cluster. Dashboard was already on React 19.2.
  - **Dashboard TypeScript** (#35): ^5 → ^6.
    - TypeScript 6 caught two latent issues, both fixed in the same PR.
    - Widened `AppConfigForEstimate` to type legacy `exaApiKey`/`copyscapeKey` fields the estimator already reads.
    - Removed `(cfg as any)` escape hatches in `providerBase()`.
    - Moved orphaned sanitize regression test from `src/lib/` into the vitest-watched `src/__tests__/` directory (77 → 78 tests now execute).
  - **Dashboard Node types** (#36): `@types/node` ^20 → ^25. Node 24 LTS runtime unchanged; only types updated.
  - Root deps: `@anthropic-ai/sdk` bumped via minor-and-patch group (#27).
  - Dashboard deps: minor-and-patch group of 4 updates (#31).

### Deferred

- **ESLint 9 → 10** (Dependabot #33) — `eslint-plugin-react` (pulled in transitively via `eslint-config-next`) is not yet compatible with ESLint 10's rule-context API (`contextOrFilename.getFilename is not a function`). Will revisit once `eslint-config-next` ships a compatible release.

### Added — repository infrastructure

- `.github/dependabot.yml` — weekly version + security updates for CLI, dashboard, and GitHub Actions (grouped minor+patch, Monday 06:00 Europe/Amsterdam) (#25).
- Branch protection on `main`: required `test` status check, linear history, conversation resolution, no force-push, no deletions.
- CodeQL default setup (weekly; `actions`/`javascript`/`javascript-typescript`/`typescript`).
- `ci.yml`: `actions/checkout` 4 → 6 (#26).

### Security

- Secret scanning + push protection enabled.
- Dependabot vulnerability alerts + automated security fixes enabled.

### Fixed

- `.env.example` — replaced stale `checkit` references with `CheckApp` / `~/.checkapp` / `checkapp --setup` (#25).

## [1.3.0] - 2026-04-22

### Added

- Fact-Check Tier system with three tiers: Basic (Exa + LLM, current default), Standard (Gemini + Google Search grounding, opt-in behind `factCheckTierFlag`), Deep Audit (Gemini Deep Research, async premium workflow).
- Gemini-backed fact-check tiers (Grounded and Deep Audit) plus provider capability checks for preview Gemini endpoints.
- `deep_audit_article` and `get_deep_audit_result` MCP tools for agent integration.
- Dashboard Deep Audit panel on report pages.
- Dashboard tier selector in Settings.
- Provider capability layer with startup health check for preview Gemini endpoints.
- Telemetry for tier selection and audit lifecycle events.
- **End-to-end verification lane** for the tier system. `bun run test:e2e:browser` boots the real Next.js dashboard against temp config + DB, drives provider mocks via scenario fixtures, and covers basic / standard / premium via `/api/checks`, CLI, and MCP. `bun run test:e2e:live` runs the same surfaces against real APIs (Exa + Gemini grounded + Gemini Deep Research) — opt-in via `CHECKAPP_ALLOW_LIVE_PROVIDERS=1`. Live smokes verified all three tiers: basic ~$0.05, standard ~$0.20, premium ~$1.50 (32KB real audit report).
- Belt-and-suspenders live-provider guard (`assertMocksOnly`) throws if any adapter reaches the network in E2E mode without the explicit opt-in.
- Scenario fixture registry (`tests/e2e/fixtures/`) with six scenarios: basic-happy, standard-happy, premium-pending, premium-completed, premium-failed, settings-default-off.

### Changed

- Exa fact-check now uses `text` retrieval (full content) in addition to highlights, for better specific-statistic verification.
- `src/config.ts` and `src/db.ts` resolve `CHECKAPP_CONFIG_PATH` / `CHECKAPP_DB_PATH` dynamically on each call so tests can redirect paths without a subprocess boundary.

### Fixed

- Removed restrictive `includeDomains` filter from Exa search that caused false negatives on topics outside the hardcoded allowlist.
- **Gemini Deep Research capability probe** was sending `background=false, store=false` to `/interactions`, which Gemini rejects with HTTP 400. That silently gated out every real Deep Research call through the cached health check. Probe now uses `background=true, store=true` (both required). Caught by the live Premium smoke.
- `dashboard/src/app/api/checks/route.ts` now honors `CHECKAPP_DB_PATH` instead of hardcoding `~/.checkapp/history.db`.
- **Dashboard React hydration under `next dev`** (#44, PR #47). Next 16's dev-only cross-origin gate silently dropped HMR + RSC Flight chunks for requests via `127.0.0.1` when the server bound to `localhost`. React never hydrated — every interactive control was inert, `useEffect`-fetch pages (`/settings`, `/skills`, `/contexts`, `/reports`) showed a skeleton forever. Fix: `allowedDevOrigins: ["127.0.0.1", "localhost"]` in `dashboard/next.config.ts`. CLI, MCP, and HTTP API surfaces were unaffected throughout.
- Dashboard summary date buckets (`buildDashboardSummary`) now compute month start and 7-day bars in UTC, matching SQLite `datetime('now')` — previously drifted ±1 day near month boundaries for any non-UTC host.
- Dashboard sidebar theme toggle hydration-guards via `useSyncExternalStore` so the server-rendered button has a stable `aria-label` and doesn't trigger a hydration mismatch.
- `ScenarioExaResult` type now declares `publishedDate?` so the dashboard build typechecks the downstream fact-check import.
- MCP `deep_audit_article` test is now hermetic: the deep-research skill binds to the in-memory test DB instead of leaking `int-new` into `~/.checkapp/history.db` between runs.

### Added — dashboard UI E2E coverage (PR #47)

- Hydration oracle `tests/e2e/browser/ui-theme-toggle.test.ts` — detects React hydration via `__react*` DOM markers + click assertion on the sidebar theme toggle.
- Five new UI E2E tests driven via agent-browser against the live dashboard: `ui-skills-page`, `ui-contexts-page`, `ui-settings-tier-selector`, `ui-check-form`, `ui-reports-page`.
- API-layer workaround `tests/e2e/browser/dashboard-default-off.test.ts` retired — coverage moved to the real `ui-settings-tier-selector` interaction.

### Notes

- Standard tier defaults to off. Enable it manually (`factCheckTierFlag: true, factCheckTier: "standard"` in config) until we validate it with broader production evidence.
- Tier selection was informed by an internal 20-claim synthetic benchmark; see [research repo](https://github.com/sharonds/checkapp-fact-check-research) for methodology and limitations.

## [1.2.0] — 2026-04-17 — Phase 7.1: Review Cleanup

Consolidation release. Addresses all outstanding review findings from Phase 6 + Phase 7 PRs (#11–#19), CodeQL alerts, and a second Codex validation pass. Ships as five PRs (B0–B4).

### Fixed

- **All three check pipelines unified** — CLI (`<Check>`), headless (`runCheckHeadless`), and dashboard `POST /api/checks` now invoke a single pure `runCheckCore()`. Removes the dashboard's `spawn()` + temp-file + "query latest row" race. (#20, Codex §1 + Codex-validation §2)
- **Dashboard mutation surface uniformly guarded** — shared `guardLocalMutation` + `guardLocalReadOnly` applied to `/api/config`, `/api/skills`, `/api/contexts/*`, `/api/checks`, `/api/checks/[id]/tags`, `/api/providers`, `/api/estimate`. Loopback via `req.nextUrl.hostname` (not client Host header); CSRF on all mutations; `fetchWithCsrf` client helper injects the token. (#21, Codex-validation §1)
- **Grammar correctness** — rewrites use offset-based splice (no wrong-occurrence replace for duplicated words); LLM-recheck sorted descending before splicing (no offset drift); recheck concurrency capped at 3 (respects LanguageTool managed-tier 20/min); LLM fallback caps verdict at `warn` whenever findings > 0; `ltCheck` chunks text > 18KB at sentence boundaries. (#23, PR#14 + Codex-validation §3)
- **`skipped` + `info` verdict cascade** — `Verdict` widened CLI + dashboard side; `verdict-badge`, `score-ring`, `skill-card`, `normalize.ts` all render `skipped` + distinct `info` severity. Overall-score averages exclude `skipped`. (#20, #21, Codex-validation §5 + §8)
- CLI runs now load DB-backed contexts uniformly with headless/MCP/dashboard (#20, Codex §1).
- `FactCheckSkill` gates Exa SDK instantiation on provider resolution; non-Exa keys no longer flow to `new Exa()` (#20, PR#13).
- `--deep-fact-check` works env-only (EXA_API_KEY); subprocess env cleaned before `--ui` spawn (#20, PR#13).
- `--fix` no longer prints "article is clean" when unfixable warn/error findings remain (#20, Codex §6).
- MCP `regenerate_article` returns structured `{ status: "skipped", reason, text, costUsd }` when no LLM provider configured (#20, Codex §7).
- `DEFAULT_SKILLS` includes `grammar`/`academic`/`selfPlagiarism: false` so `get_skills` lists them (#20, PR#12).
- Stub skills return `verdict: "skipped"` (excluded from overall average) instead of `score:0`+`fail` (#20, PR#12).
- Dashboard skills API provider-aware via `supportedProviders[]`; LLM skills accept minimax/anthropic/openrouter; threshold editor gains `brief` + `purpose` (#21, Codex §2, §9).
- Provider secrets never serialized to client props (server strips to `{ provider, extra, hasKey }`); PUT `/api/providers` preserves `apiKey` when body omits it; `""` clears; new value overwrites (#21, PR#17 D1, D3).
- "Fix Issues" button hidden for non-rerunnable sources (MCP-origin, custom labels) via `isRerunnableSource()` (#21, Codex §5).
- Estimator parity: `AI_DETECTION_COST` added to both CLI + dashboard; legacy `exaApiKey`/`copyscapeKey` fallback; abort controller on estimate fetch; warnings shown even at $0 total (#21, PR#18 D7, D8, D9).
- Registry drift guard compares provider IDs per skill (#21, PR#19 H3).
- Normalize guards `sources`/`citations`/`costBreakdown` element shapes on both CLI + dashboard (#21, #22, PR#11 F1 + F5).
- `fetchWithBackoff`: throws on negative `maxRetries`; retries on network errors (TypeError); parses HTTP-date `Retry-After` (#22, PR#11 F2 + F4 + Codex F3).
- `/api/providers` PUT uses `request.nextUrl.hostname` (not client-controlled Host header); GET applies `guardLocalReadOnly` (#22, PR#17 D2, D4 + GET guard).
- CSRF token regenerated when file is empty/whitespace; `CHECKAPP_CSRF_PATH` env-overridable for tests (#22, PR#17 D5).
- `indexArchive`: validates `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN`; `resolveArchivePath(env)` falls back to `os.homedir()`; Vectorize IDs now SHA-256 of file path (content-independent, 32 hex chars) (#22, PR#16 B6, H7).
- CI workflow declares `permissions: contents: read` (#22, CodeQL #5).
- Hebrew passage matching via `Intl.Segmenter` sentence splitting (no longer requires large contiguous block) (#23, Codex §4).
- `openDb` `mkdirSync(dirname(path))` for non-`:memory:` custom paths (#24, Codex §12).
- `sanitizeText` no double-ellipsis on already-truncated input (#24, PR#18 H5).
- `countWords` dedupe: `src/index.tsx` uses the `gdoc.ts` helper instead of inline split (#24, PR#18 H6).
- Phase 7 E2E placeholder `expect(true)` removed; temp DBs cleaned via `mkTmp()` + `afterEach` (#24, PR#19 H1, H2).
- Docs narrow language support to **Hebrew + English** (tuned); CJK/Arabic detected but deferred to Phase 8 (#24, Codex §3, §8, Codex-validation §6).
- `SECURITY.md` lists all 10 outbound services with BYOK posture (#24, Codex-validation §7).
- `docs/security.md` aligned with actual `guardLocalMutation` implementation (#24, Codex-validation §8).

### Changed

- MCP server version bumped from `1.1.0` → `1.2.0` (#24).

### Shared testing scaffold

- New `dashboard/src/testing/index.ts` + `src/testing/helpers.ts`: `writeTestConfig`, `csrfTokenForTests`, `writeTokenFile`, `overallScore` (#22, B2.0).

### Deferred to Phase 8

- `--setup` re-wizard UX (Codex §10).
- `ProviderId` type union soundness (PR#12).
- Settings UI revert-on-failure (Codex §11).
- CJK + Arabic + other non-Latin/non-Hebrew language tuning (Codex §3, §8, Codex-validation §6).
- Full dashboard render-test coverage (Ink UI).
- Estimator drift-guard output-shape comparison (one-task consolidation deferred — current drift guard is per-skill provider IDs).
- `v1.2.0-smoke.test.ts` E2E is present but `describe.skip` — Next.js route imports don't resolve under `bun:test`. Contract is covered by dashboard vitest + MCP integration tests.

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
