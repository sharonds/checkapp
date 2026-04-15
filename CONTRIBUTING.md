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
| `src/check.tsx` | Plagiarism check UI + report (Ink UI) |
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
- If adding a feature, update the README
- No tests required for small fixes; for larger changes a brief description of how you tested is appreciated

## Ideas for contributions

- [ ] Originality.ai as an alternative/additional AI detection engine
- [ ] PDF/DOCX input parsing
- [ ] CMS integrations — WordPress plugin, Ghost webhook
- [ ] Support for Google Docs that require OAuth
- [ ] Skill marketplace — community-built skills installable with one click
