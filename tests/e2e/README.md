# E2E Verification

End-to-end verification for the multi-tier fact-check feature (Plan 2).

## Lanes

### Fast / unit + integration (`bun run test`)

Covers the plumbing + mocked provider integration without booting the dashboard:

- `tests/e2e/mode.test.ts` — env gates, temp-path isolation, subprocess proof that `readConfig()` / `openDb()` honor the overrides.
- `tests/e2e/fixtures.test.ts` — the 6 scenario fixtures round-trip correctly.
- `tests/e2e/llm-mock.test.ts` — LLM calls in E2E mode return scenario data with zero fetch.
- `tests/e2e/providers-mock.test.ts` — Exa / Gemini grounded / Deep Research / capability all return scenario data with zero fetch across basic/standard/premium scenarios.

Total: ~40 tests, runs in <5s.

### Browser / full-stack (`bun run test:e2e:browser`)

Boots the real Next.js dashboard against isolated temp paths under `CHECKAPP_E2E=1` and exercises the full pipeline via HTTP + in-process drivers:

- `tests/e2e/browser/boot.test.ts` — dashboard comes up, serves `/` with <500 status.
- `tests/e2e/browser/dashboard-default-off.test.ts` — default-off guardrail via `/api/config`.
- `tests/e2e/browser/dashboard-tier-routing.test.ts` — basic / standard / premium via `/api/checks` and direct `FactCheckDeepResearchSkill.initiate()`.
- `tests/e2e/browser/cli-smokes.test.ts` — `bun src/index.tsx <article.md>` for basic, standard, and `--estimate-cost`.
- `tests/e2e/browser/mcp-smokes.test.ts` — `check_article`, `deep_audit_article`, `get_deep_audit_result` via `handleToolCall`.

Total: ~13 tests, runs in ~15s (Next.js dev boots once per scenario; one dev-server lock per dashboard dir means tests are serial).

### Live-provider (`bun run test:e2e:live`)

Opt-in only. Empty directory today — tests added here must set `CHECKAPP_ALLOW_LIVE_PROVIDERS=1` explicitly and require real API keys. See `tests/e2e/live/README.md`.

## Writing a new scenario

1. Add `tests/e2e/fixtures/<name>.json`. Shape is defined by `Scenario` in `src/e2e/fixtures.ts`:
   - `providers.llm.extractClaims` / `providers.llm.assessClaim` — for the basic tier LLM calls
   - `providers.exa.results` — for basic tier Exa search
   - `providers.geminiGrounded.claims` — for standard tier
   - `providers.deepResearch.initiateResponse` + `pollStates[]` — for premium
2. Add the name to the round-trip list in `tests/e2e/fixtures.test.ts`.
3. Reference the scenario from a test via `process.env.CHECKAPP_E2E_SCENARIO = "<name>"` or as the `scenario:` field on `bootDashboard`.

## Environment variables

| Var | Purpose |
|---|---|
| `CHECKAPP_E2E=1` | Enables the mock short-circuit in every provider adapter. |
| `CHECKAPP_E2E_SCENARIO=<name>` | Which fixture file to load. |
| `CHECKAPP_CONFIG_PATH=<path>` | Redirects `readConfig()` / `writeConfig()` away from `~/.checkapp/config.json`. |
| `CHECKAPP_DB_PATH=<path>` | Redirects `openDb()` away from `~/.checkapp/history.db`. |
| `CHECKAPP_CSRF_PATH=<path>` | CSRF token file so tests can POST to `guardLocalMutation`-protected routes. |
| `CHECKAPP_E2E_FIXTURES_DIR=<path>` | Override fixture lookup (defaults to `tests/e2e/fixtures/` relative to `src/e2e/fixtures.ts`). |
| `CHECKAPP_ALLOW_LIVE_PROVIDERS=1` | Disables the `assertMocksOnly()` belt-and-suspenders. Required for the live lane. **Never** set this unless you intend real API calls. |

## Known issues

See `docs/superpowers/plans/2026-04-22-e2e-issues.md`.
