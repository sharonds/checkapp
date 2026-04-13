# Article Checker

> Plagiarism checker for AI-generated marketing articles. Paste a Google Doc URL, get a verdict in seconds — no browser, no cloud, no setup beyond a Copyscape account.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-fbf0df?logo=bun)](https://bun.sh)
[![Ink](https://img.shields.io/badge/UI-Ink%20%2B%20React-61DAFB?logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![Copyscape](https://img.shields.io/badge/Engine-Copyscape-0078D4)](https://www.copyscape.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## What is Article Checker?

Article Checker is a single-binary CLI tool that checks AI-generated articles for plagiarism before they go live. Point it at a Google Doc and it returns a scored verdict — **Publish**, **Review**, or **Rewrite** — in under 10 seconds.

> **Your content stays private.** The only network calls are to `docs.google.com` (to read the doc) and `www.copyscape.com` (the plagiarism API). No analytics, no telemetry, no logging.

## The Problem

AI writing tools (Gemini, ChatGPT, Claude) don't copy-paste. But they all draw from the same training data. When every AI writes about "benefits of Vitamin D", the outputs can end up structurally similar to articles already indexed on the web — not from copying, but from convergent generation.

For brands publishing health, beauty, or marketing content, that's a real legal and reputational risk. A competitor could claim your article is substantially similar to theirs, even if no one copied anything.

Article Checker gives you a one-command safety gate before every publish.

## Features

- **Single binary** — download and run; no Node.js, Bun, or runtime required
- **First-run wizard** — interactive terminal setup on first launch; credentials saved locally forever
- **Auto-detects public docs** — no Google auth needed if the doc is shared publicly
- **Any article length** — handles short posts and long-form content
- **Clear verdicts** — three-tier scoring with configurable thresholds
- **Top matches** — shows which sites matched and how many words overlapped
- **Cross-platform** — Mac (Apple Silicon + Intel), Linux, Windows
- **Fast** — under 10 seconds for a typical 800-word article

## How It Works

```
Google Doc URL (publicly shared)
        │
        ▼
┌───────────────────┐
│  Google Doc fetch │  Exports plain text via public export URL
└─────────┬─────────┘
          │
┌─────────▼─────────┐
│  Copyscape API    │  Checks against the full indexed web
└─────────┬─────────┘
          │
  ┌───────┴────────┐
  ▼                ▼
Verdict       Top matches
(Publish /    (URL + word
 Review /      overlap count)
 Rewrite)
```

## Demo

```
$ article-checker "https://docs.google.com/document/d/XXXX/edit"

⠸ Reading Google Doc...
⠼ Running plagiarism check (743 words)...

────────────────────────────────────────────────────────
 Words checked:  743
 Similarity:     12%   (89 / 743 words matched)

 Top matches (2 sources):
   1. healthline.com/nutrition/vitamin-d           89 words
   2. webmd.com/vitamins/ai/ingredientmono-768     12 words

────────────────────────────────────────────────────────
 ✅  PUBLISH — no issues found
────────────────────────────────────────────────────────
```

## Quick Start

### Step 1 — Download the binary

Go to the **[Releases page](https://github.com/sharonds/article-checker/releases/latest)** and download the file for your platform:

| File | Platform |
|------|----------|
| `article-checker-mac-arm64` | Mac — Apple Silicon (M1 / M2 / M3 / M4) |
| `article-checker-mac-x64` | Mac — Intel |
| `article-checker-linux-x64` | Linux x64 |
| `article-checker-win-x64.exe` | Windows x64 |

> **Not sure which Mac you have?**  → About This Mac. "Apple M…" = arm64 · "Intel" = x64

### Step 2 — Make it executable (Mac / Linux only)

```bash
chmod +x ~/Downloads/article-checker-mac-arm64
```

### Step 3 — Move it to your PATH (optional but recommended)

```bash
mv ~/Downloads/article-checker-mac-arm64 /usr/local/bin/article-checker
```

### Step 4 — Run it

```bash
article-checker "https://docs.google.com/document/d/XXXX/edit"
```

On first run, a setup wizard appears and asks for your Copyscape credentials. Takes 30 seconds. Never asks again.

## Setup Wizard

```
╭─────────────────────────────────────────╮
│  Article Checker — First-time Setup     │
╰─────────────────────────────────────────╯

You only need to do this once. Credentials are saved to:
  /Users/you/.article-checker/config.json

Copyscape username:  you@example.com
Copyscape API key:   ************

✓ All set! Run the checker:
  article-checker <google-doc-url>
```

**Getting Copyscape credentials:**
1. Sign up (free) at [copyscape.com](https://www.copyscape.com/)
2. Top up credits — $5 minimum (~$0.09 per 800-word check)
3. Go to **My Account → API** to find your API key

## Usage

```bash
# Check an article
article-checker "https://docs.google.com/document/d/XXXX/edit"

# Re-run setup (to update credentials)
article-checker --setup
```

**The Google Doc must be publicly accessible.** Set it to "Anyone with the link can view":
> Docs → Share → Change to "Anyone with the link" → Viewer → Done

## Verdicts

| Similarity | Verdict | Recommended action |
|-----------|---------|-------------------|
| 0 – 15% | ✅ **PUBLISH** | No significant matches. Ship it. |
| 16 – 25% | ⚠️ **REVIEW** | Some overlap. Check the listed sources manually. |
| 26%+ | ❌ **REWRITE** | Too similar to existing content. Rewrite before publishing. |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime & compiler | [Bun](https://bun.sh) |
| Terminal UI | [Ink](https://github.com/vadimdemedes/ink) — React for CLIs |
| Plagiarism engine | [Copyscape API](https://www.copyscape.com/api.php) |
| Google Doc fetch | Google Docs public export URL (no auth required) |
| Language | TypeScript (strict) |

No database. No server. No cloud dependency beyond Copyscape.

## For Developers — Run from Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/sharonds/article-checker
cd article-checker
bun install
bun src/index.tsx "https://docs.google.com/document/d/XXXX/edit"
```

**Build all platform binaries:**

```bash
bash build.sh

# → dist/article-checker-mac-arm64
# → dist/article-checker-mac-x64
# → dist/article-checker-linux-x64
# → dist/article-checker-win-x64.exe
```

## Project Structure

```
article-checker/
├── src/
│   ├── index.tsx       # Entry point — routes to setup or check
│   ├── setup.tsx       # First-run credential wizard (Ink UI)
│   ├── check.tsx       # Plagiarism check UI + report (Ink UI)
│   ├── gdoc.ts         # Fetches plain text from a Google Doc
│   ├── copyscape.ts    # Copyscape API client + XML response parser
│   └── config.ts       # Reads/writes credentials to ~/.article-checker/
├── build.sh            # Compiles four platform binaries to dist/
├── package.json
└── README.md
```

## Security

- Credentials are stored **locally only** at `~/.article-checker/config.json`
- Credentials are only sent to the Copyscape API over HTTPS
- Article text is sent to Copyscape for plagiarism checking — review their [privacy policy](https://www.copyscape.com/privacy.php) for sensitive content
- No other network requests, no analytics, no telemetry

To report a security vulnerability, open a [GitHub issue](https://github.com/sharonds/article-checker/issues) with the label `security`.

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

Some ideas for what would be useful:
- `--output report.md` to save the report as a file
- [Originality.ai](https://originality.ai/) as an alternative/additional plagiarism engine
- `--rewrite` flag to auto-rewrite flagged passages via Claude API
- Support for private Google Docs via OAuth (`gws` CLI)
- Configurable verdict thresholds via a config flag

## About the Author

Built by **[Sharon Sciammas](https://github.com/sharonds)** — full-stack developer and AI automation specialist based in the Netherlands. Sharon builds AI-powered SaaS products including event management platforms, marketing automation pipelines, and CRM infrastructure for AI agents.

This tool was built as part of a content quality pipeline for brands using AI-generated marketing content.

## License

[MIT](LICENSE)
