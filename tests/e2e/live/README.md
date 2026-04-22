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

**Empty today.** Populate as the team runs into real-world provider deltas that the mocked fixtures don't catch.
