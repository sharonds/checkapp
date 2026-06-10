# Contributing

Contributions are welcome — bug fixes, new features, and documentation improvements.

## Setup

```bash
git clone https://github.com/sharonds/checkapp
cd checkapp
bun install
```

Run from source:

```bash
bun src/index.tsx "https://docs.google.com/document/d/XXXX/edit"
```

## Project structure

| File | Purpose |
|------|---------|
| `src/index.tsx` | Entry point — routes to setup or check |
| `src/setup.tsx` | First-run credential wizard (Ink UI) |
| `src/checker.ts` | Headless check orchestration and skill registration |
| `src/check.tsx` | Ink UI wrapper around the check flow |
| `src/gdoc.ts` | Input reader — fetches Google Docs via public export URL or reads local `.md`/`.txt` files |
| `src/copyscape.ts` | Copyscape API client + XML response parser |
| `src/config.ts` | Reads/writes credentials to `~/.checkapp/config.json` |

## Building binaries

```bash
bash build.sh
```

Produces four platform binaries in `dist/`. Upload them to a GitHub Release.

## Pull requests

- Keep PRs focused — one thing per PR
- If adding or changing user-visible behavior, update the README and any affected docs under `docs/`
- If changing structured audit data, report rendering, dashboard APIs, provider calls, security/privacy behavior, packaging, or agent-facing output, include focused tests plus the relevant release gates
- For release-grade changes, run `bun run test:release` when possible. If a browser or live-provider lane is unavailable, call out the exact blocked command and reason in the PR.
- Do not commit internal planning docs, local validation reports, credentials, provider transcripts, or generated package tarballs

## Ideas for contributions

- [ ] Originality.ai as an alternative/additional AI detection engine
- [ ] PDF/DOCX input parsing
- [ ] CMS integrations — WordPress plugin, Ghost webhook
- [ ] Support for Google Docs that require OAuth
- [ ] Skill marketplace — community-built skills installable with one click
