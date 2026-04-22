# Live-provider E2E lane

Opt-in verification against real Exa and Gemini APIs. **Not part of routine CI.** Running this lane spends real money.

## Requirements

- `GEMINI_API_KEY` in environment.
- `EXA_API_KEY` in environment.
- Network connectivity to `generativelanguage.googleapis.com` and `api.exa.ai`.
- Explicit opt-in: `CHECKAPP_ALLOW_LIVE_PROVIDERS=1`.

## Running

```bash
CHECKAPP_ALLOW_LIVE_PROVIDERS=1 bun run test:e2e:live
```

## Budget

- Basic smoke: ~$0.05 per run.
- Standard smoke: ~$0.20 per run.
- Premium smoke: ~$1.50 per run (skip unless basic + standard have passed this session).

Keep live runs rare. The mocked lane (`bun run test:e2e:browser`) is the one that should catch regressions.

## Authoring a live test

1. Start from a mocked test in `tests/e2e/browser/`.
2. Copy it into `tests/e2e/live/<name>.test.ts`.
3. Remove any scenario injection and use the real API keys from environment.
4. Assert shape, not content — live results vary.

## Status

All three tiers covered as of 2026-04-22:

| Test | Wall time | Cost | Provider |
|---|---|---|---|
| `basic-live.test.ts` | ~50s | ~$0.05 | Exa + MiniMax |
| `standard-live.test.ts` | ~140s | ~$0.20 | Gemini 3.1 Pro + Google Search |
| `premium-live.test.ts` | 5–15 min | ~$1.50 | Gemini Deep Research |

Total ~$1.75 and ~20 min for a full live run. Keep runs rare.

### What the Premium live smoke caught on first run

The Gemini capability probe at `src/providers/gemini-capability.ts` was sending `background=false, store=false` to `/interactions`, which Gemini now rejects (HTTP 400). That silently gated out every real Deep Research call through the cached health check. Fixed in commit `12c1eff` (probe now uses `background=true, store=true`). Moral: live smokes catch bugs mocks can't.
