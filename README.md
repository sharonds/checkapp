# CheckApp

> AI content quality gate for marketing teams. CLI + web dashboard that returns plagiarism, AI-detection, SEO score, fact-check, tone-of-voice, legal risk, brief matching, and content summary — before you publish. Supports context management (tone guides, briefs, legal policies), MCP server for AI agent integration, batch checking, CI mode, JSON output, tags, search, report export, and a local web dashboard for browsing results and managing skills.

[![CI](https://github.com/sharonds/checkapp/actions/workflows/ci.yml/badge.svg)](https://github.com/sharonds/checkapp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/checkapp.svg)](https://www.npmjs.com/package/checkapp)
[![GitHub stars](https://img.shields.io/github/stars/sharonds/checkapp?style=social)](https://github.com/sharonds/checkapp)
[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-fbf0df?logo=bun)](https://bun.sh)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What Is CheckApp?

CheckApp is a pluggable CLI tool that runs a configurable set of quality checks on any article — a Google Doc URL or a local `.md`/`.txt` file — before it goes live.

Each check is a **skill** you can enable or disable. Results appear in the terminal and are automatically saved as an HTML report and to a local SQLite history database.

---

## Phase 7 — Research-Backed Editor

Every flagged issue ships with evidence + rewrite + citation:

- **Fact-check** now carries `sources[]` (Exa highlights with url/title/quote) on every finding. Upgrade to deep-reasoning with `--deep-fact-check`.
- **Grammar & Style** (LanguageTool + LLM fallback) produces a `rewrite` per finding. LLM-fallback rewrites are grammar-checked a second time to catch mechanical errors.
- **Academic Citations** (Semantic Scholar) merges citations onto matching fact-check findings with scientific/medical/financial claim types. Free, no API key.
- **Self-Plagiarism** (Cloudflare Vectorize + OpenRouter embeddings) flags overlap with your past articles. Run `checkapp index <dir>` once to ingest your archive.

Pick a provider per skill from the Settings → Providers dashboard. CheckApp never holds API tokens — users bring their own keys.

Pre-flight cost estimate: `checkapp --estimate-cost article.md` or the Run Check page in the dashboard shows "Estimated cost: $0.0320" before spending anything.

See [docs/security.md](docs/security.md) for the BYOK-alpha threat model.

---

## Skills

| Skill | Engine | Cost/check | Enabled by default |
|-------|--------|-----------|-------------------|
| **Plagiarism** | Copyscape | ~$0.09 | ✅ |
| **AI Detection** | Copyscape | ~$0.09 | ✅ |
| **SEO** | Offline (no API) | free | ✅ |
| **Grammar & Style** | LanguageTool + LLM fallback | free tier / ~$0.002 | ✅ (free tier) |
| **Academic Citations** | Semantic Scholar | free | ✅ |
| **Self-Plagiarism** | Cloudflare Vectorize + OpenRouter embeddings | ~$0.0001 | ❌ requires index (`checkapp index <dir>`) |
| **Fact Check** | Tiered: Basic = Exa + LLM; Standard = Gemini + Google Search; Deep Audit = Gemini Deep Research | varies | Basic is available by default; Standard is opt-in; Deep Audit is async |
| **Tone of Voice** | Claude/MiniMax | ~$0.002 | ❌ requires LLM key + tone guide file |
| **Legal Risk** | Claude/MiniMax | ~$0.002 | ❌ requires LLM key |
| **Content Summary** | Claude/MiniMax | ~$0.002 | ❌ requires LLM key |
| **Brief Matching** | MiniMax/Claude | ~$0.002 | ❌ requires LLM key + brief context |
| **Content Purpose** | MiniMax/Claude | ~$0.002 | ❌ requires LLM key |

All enabled skills run in parallel. Adding more skills does not increase total time significantly.

---

## Fact-Check Tiers

Standard is opt-in and stays off by default until Gate 2 passes. Basic remains the default tier unless `factCheckTierFlag` is explicitly enabled.

| Tier | Engine | Cost per article | Typical time | Notes |
|------|--------|------|------|-------|
| Basic (default) | Exa + LLM | $0.04 | ~15s | Works without Gemini API key |
| Standard (opt-in) | Gemini + Google Search grounding | $0.16 | ~45s | Requires `GEMINI_API_KEY`. Enable with `factCheckTierFlag=true` and `factCheckTier="standard"` in config. |
| Deep Audit (async) | Gemini Deep Research | $1.50 | 5–15 min | Premium audit workflow. Initiate via dashboard button or `deep_audit_article` MCP tool. |

Research basis: the Standard tier was selected based on an [internal benchmark on a 20-claim synthetic corpus](https://github.com/sharonds/checkapp-fact-check-research). That benchmark is directional, not definitive - see its [LIMITATIONS.md](https://github.com/sharonds/checkapp-fact-check-research/blob/main/LIMITATIONS.md) before relying on the results for your own decisions.

---

## Features

| Feature | Details |
|---------|---------|
| **Pluggable skills** | Enable/disable any skill via config. Add custom skills by implementing one TypeScript interface. |
| **Plagiarism check** | Checks against the full indexed web via Copyscape. Returns 0–100% similarity + matched sources. |
| **AI detection** | Copyscape AI detector. Returns 0–100% probability per sentence and an overall verdict. |
| **SEO analysis** | Offline. Checks word count (800–2500 ideal), H1/H2 headings, average sentence length, Flesch-Kincaid readability. |
| **Fact check** | Extracts 4 specific claims → searches each with Exa AI → Claude assesses evidence → per-claim supported/unsupported verdict with citation recommendations. |
| **Tone of voice** | Loads your brand voice guide (`.md` file), sends article + guide to Claude, returns violations with quotes and rewrite suggestions in your brand voice. |
| **Legal risk** | Scans for unsubstantiated health claims, defamation, false promises, GDPR risks, price misrepresentation. Findings include actionable "Fix:" suggestions. |
| **Content summary** | Analyzes topic, main argument, target audience, and tone (informational/persuasive/conversational/technical/promotional). |
| **SEO keyword detection** | Extracts the top keyword and checks whether it appears in the first paragraph. |
| **Fact-check confidence** | Each claim now shows high/medium/low confidence based on the number of supporting sources found. |
| **Batch checking** | Check all `.md`/`.txt` files in a directory with `checkapp --batch ./articles/`. |
| **Configurable thresholds** | Custom pass/warn/fail score cutoffs per skill via `config.json`. |
| **HTML report** | Self-contained, no-dependency HTML file. Score bars, verdict badges, per-finding citations. Opens in browser automatically. |
| **SQLite history** | Every check is saved to `~/.checkapp/history.db`. Query with `--history`. |
| **Google Doc support** | Paste a publicly-shared Google Doc URL. No Google auth required. |
| **Local file support** | Pass a `.md` or `.txt` file path. Works offline for the fetch step. |
| **Single binary** | No Node.js, Bun, or runtime required. |
| **Web dashboard** | Local Next.js UI — overview stats, report browser, run checks, manage skills and settings, in-app docs. Start with `checkapp --ui`. |
| **`--ui` flag** | Launches the dashboard dev server and opens `http://localhost:3000` in your browser. |
| **`--output` export** | `--output report.md` or `--output report.html` — save the report to a file. |
| **Tags + search** | Attach tags to checks, search across all history by text or tag via dashboard or API. |
| **JSON API** | RESTful API at `localhost:3000/api` for running checks, managing tags, toggling skills. See [docs/api.md](docs/api.md). |
| **Context system** | Upload tone guides, content briefs, legal policies, and style guides. Contexts are stored in SQLite and automatically loaded by relevant skills. Manage via CLI (`checkapp context add/list/show/remove`) or the dashboard Contexts page. |
| **MCP server** | 8 tools for AI agent integration (Claude Code, Cursor, Windsurf). Start with `checkapp --mcp`. Tools: `check_article`, `list_reports`, `get_report`, `upload_context`, `list_contexts`, `get_skills`, `toggle_skill`, `regenerate_article`. |
| **CI mode (`--ci`)** | Exits with code 1 if any skill returns a `fail` verdict. Designed for CI/CD pipelines. |
| **JSON output (`--json`)** | Outputs structured JSON instead of the Ink terminal UI. Ideal for scripts, agents, and piping. |
| **Brief matching** | Checks article against an uploaded content brief. Verifies coverage of required topics, audience alignment, and tone match. Requires a `brief` context. |
| **Content purpose detection** | Detects article type (tutorial, product announcement, case study, thought leadership, etc.) and provides purpose-specific recommendations for missing elements. |
| **Regenerate/fix** | `checkapp --fix <file>` runs all checks then generates AI-suggested rewrites for every flagged sentence, using tone guide and legal policy contexts. |
| **Cross-platform** | Mac (Apple Silicon + Intel), Linux, Windows. |

---

## Real Results — What It Finds

### Example 1 — English article with Wikipedia passages

An article about Vitamin D with 3 verbatim sentences from Wikipedia. Live output with the default 3 skills:

```
────────────────────────────────────────────────
Words checked:  310
API cost:        $0.080

❌   Plagiarism Check:  33% similarity — 18 sources matched  (34/100)
✅   AI Detection:  10% AI probability — human  (90/100)
❌   SEO:  310 words · avg 17-word sentences · readability: Medium  (49/100)
────────────────────────────────────────────────
Overall: 58/100
Report: checkapp-report.html
────────────────────────────────────────────────
```

**HTML report:** Each skill gets a card with a circular score indicator, engine badge, and a list of findings. The report links to all engines used (Copyscape, Exa AI, MiniMax) and includes an MIT disclaimer.

---

### Example 2 — Hebrew article with Wikipedia passages

Three sentences from the Hebrew Wikipedia article on Vitamin D:

```
────────────────────────────────────────────────
Words checked:  119
Plagiarism:      39%  (46 / 118 words matched)

Top match: he.wikipedia.org/wiki/ויטמין_D
  ↳ "ויטמין D הוא קבוצה של חמש תרכובות מסיסות בשמן..."
  ↳ "המחלה הנפוצה ביותר הנגרמת כתוצאה ממחסור בוויטמין D..."

AI detection:    12%  probability AI-generated
────────────────────────────────────────────────
❌  REWRITE — similarity too high
✍️  HUMAN — 12% AI probability
────────────────────────────────────────────────
```

Hebrew content, RTL — no configuration needed.

---

### Example 3 — Hebrew article with 2 sentences from an Israeli news site (Ynet)

Only 2 sentences copied out of ~220 words of original Hebrew content:

```
────────────────────────────────────────────────
Words checked:  222
Similarity:      33%  (76 / 224 words matched)

Top match: ynet.co.il/articles/0,7340,L-4870486,00.html  76 words
  (syndicated copy also found at news08.net)
────────────────────────────────────────────────
❌  REWRITE — similarity too high
────────────────────────────────────────────────
```

2 sentences in 220 words of original content was enough to trigger REWRITE. Both the original source and a syndicated copy were identified.

---

## Verdicts

### Plagiarism

| Similarity | Verdict | What to do |
|-----------|---------|-----------|
| 0 – 15% | ✅ **PUBLISH** | No significant matches. Safe to publish. |
| 16 – 25% | ⚠️ **REVIEW** | Some overlap. Check listed sources and rewrite matching passages. |
| 26%+ | ❌ **REWRITE** | Too similar to existing content. Rewrite before publishing. |

### AI Detection

| AI probability | Verdict | What to do |
|---------------|---------|-----------|
| 0 – 29% | ✍️ **HUMAN** | Content reads as human-written. |
| 30 – 69% | 🔍 **MIXED** | Contains AI-like passages. Review highlighted sentences. |
| 70%+ | 🤖 **AI-GENERATED** | High probability of AI authorship. Rewrite or disclose. |

### SEO (score out of 100)

| Score | Verdict |
|-------|---------|
| 75+ | ✅ Pass |
| 50–74 | ⚠️ Warn |
| <50 | ❌ Fail |

Checks: word count (800–2500 ideal), H1/H2 headings present, average sentence length ≤20 words, Flesch-Kincaid readability.

---

## Quick Start

### Step 1 — Download the binary

Go to the **[Releases page](https://github.com/sharonds/checkapp/releases/latest)** and download for your platform:

| File | Platform |
|------|----------|
| `checkapp-mac-arm64` | Mac — Apple Silicon (M1/M2/M3/M4) |
| `checkapp-mac-x64` | Mac — Intel |
| `checkapp-linux-x64` | Linux x64 |
| `checkapp-win-x64.exe` | Windows x64 |

### Step 2 — Make it executable (Mac/Linux only)

```bash
chmod +x ~/Downloads/checkapp-mac-arm64
mv ~/Downloads/checkapp-mac-arm64 /usr/local/bin/checkapp
```

### Step 3 — Add your API keys

Create a `.env` file in your working directory:

```env
# Required — plagiarism + AI detection
COPYSCAPE_USER=your-copyscape-username
COPYSCAPE_KEY=your-copyscape-api-key

# Optional — passage-level evidence (free tier: 16k requests)
PARALLEL_API_KEY=your-parallel-api-key

# Optional — fact check + tone + legal skills (use one LLM provider)
EXA_API_KEY=your-exa-api-key
MINIMAX_API_KEY=your-minimax-api-key  # preferred — cheaper, Anthropic-compatible
ANTHROPIC_API_KEY=your-anthropic-api-key  # fallback if MINIMAX_API_KEY not set
OPENROUTER_API_KEY=your-openrouter-key  # alternative — one key for 200+ models
LLM_PROVIDER=minimax  # minimax (default), anthropic, or openrouter

# Optional — tone of voice skill (path to your brand voice .md file)
TONE_GUIDE_FILE=/path/to/brand-voice.md
```

Or run the interactive setup wizard:

```bash
checkapp --setup
```

### Step 4 — Run it

```bash
# Check a Google Doc (must be publicly shared)
checkapp "https://docs.google.com/document/d/XXXX/edit"

# Check a local file
checkapp ./my-article.md

# Check all articles in a directory
checkapp --batch ./articles/

# View check history
checkapp --history
```

---

## API Keys — Setup Guide

### Copyscape (required — plagiarism + AI detection)

One account for both plagiarism and AI detection checks.

1. Go to [copyscape.com](https://www.copyscape.com/) → **Sign up for Premium**
2. Add credits (minimum $5 deposit — ~27 full checks)
3. **My Account → API** — your key is listed there
4. Your username is the email you signed up with

**Cost per 800-word check:**

| Check | Cost |
|-------|------|
| Plagiarism (first 200 words) | $0.03 |
| Plagiarism (each 100 words after) | $0.01 |
| AI detection (first 200 words) | $0.03 |
| AI detection (each 100 words after) | $0.01 |
| **Total — 800 words, both checks** | **~$0.18** |

### Exa AI (optional — fact check skill)

Exa is a neural search engine built for AI agents. Used to search for evidence supporting or refuting each factual claim in the article.

1. Go to [dashboard.exa.ai](https://dashboard.exa.ai/api-keys)
2. Create an account and generate an API key
3. Add to `.env`: `EXA_API_KEY=your-key`

**Cost:** ~$0.007 per search. The fact-check skill searches 4 claims per article → ~$0.028 per check.

Free trial credits available on signup.

### LLM provider (optional — fact check, tone, legal skills)

Fact check, tone, and legal skills need an LLM. Set **one** of these — MiniMax is preferred (cheaper):

#### MiniMax (recommended)

MiniMax M2.7 is an extended-thinking model with an Anthropic-compatible API. Used via the Anthropic SDK with a custom base URL.

1. Go to [platform.minimax.io](https://platform.minimax.io/) → **API Keys**
2. Create an API key
3. Add to `.env`: `MINIMAX_API_KEY=your-key`

**Cost per check:** ~$0.001–0.002.

#### Anthropic Claude (fallback)

Used automatically if `MINIMAX_API_KEY` is not set.

1. Go to [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Create a new API key
3. Add to `.env`: `ANTHROPIC_API_KEY=your-key`

**Cost per check:** ~$0.001–0.002 (Haiku pricing).

### OpenRouter (optional — one key for 200+ models)

OpenRouter lets you use any LLM (GPT-4o, Llama, Mistral, etc.) with a single API key.

1. Go to [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys)
2. Create an API key
3. Add to `.env`: `OPENROUTER_API_KEY=your-key`
4. Optionally set preferred provider: `LLM_PROVIDER=openrouter`

**Cost:** Varies by model. See [openrouter.ai/models](https://openrouter.ai/models) for per-model pricing.

### Parallel AI (optional — passage evidence)

Fetches the full text of flagged URLs to find exactly which sentences in your article appear on those pages.

1. Go to [platform.parallel.ai](https://platform.parallel.ai/)
2. Create a free account → **API Keys** → **Create new key**
3. Add to `.env`: `PARALLEL_API_KEY=your-key`

**Cost:** $0.001 per URL (free tier: 16,000 requests).

---

## Usage

```bash
# Check a Google Doc (publicly shared)
checkapp "https://docs.google.com/document/d/XXXX/edit"

# Check a local Markdown or text file
checkapp ./my-article.md

# Check all articles in a directory
checkapp --batch ./articles/

# Export report to a file
checkapp ./my-article.md --output report.md

# Open the web dashboard
checkapp --ui

# Re-run setup wizard
checkapp --setup

# Show the last 20 checks from history
checkapp --history
```

```bash
# Manage contexts (tone guide, brief, legal policy)
checkapp context add tone-guide ./brand-voice.md
checkapp context add brief ./campaign-brief.md
checkapp context add legal-policy ./legal-requirements.md
checkapp context list
checkapp context show tone-guide
checkapp context remove brief

# CI mode — exit 1 on fail (for CI/CD pipelines)
checkapp --ci ./my-article.md

# JSON output — structured result for scripts and agents
checkapp --json ./my-article.md

# Fix flagged sentences with AI-suggested rewrites
checkapp --fix ./my-article.md

# MCP server — for Claude Code / Cursor / Windsurf
checkapp --mcp
```

**Google Docs:** Share → Change to "Anyone with the link" → Viewer → Done.

---

## How It Works

```
Article input (Google Doc URL or local .md/.txt)
        │
        ▼
┌───────────────────────────────────────┐
│  Article fetch (gdoc.ts)              │
│  Google Docs export URL / local file  │
└───────────────────┬───────────────────┘
                    │
        ┌───────────┼───────────────────┐
        ▼           ▼                   ▼  (all parallel)
┌──────────────┐ ┌──────────────┐ ┌─────────────────┐
│  Plagiarism  │ │  AI Detect   │ │  SEO (offline)  │ …
│  (Copyscape) │ │  (Copyscape) │ │  word/heading/  │
└──────┬───────┘ └──────┬───────┘ │  readability    │
       │                │         └────────┬────────┘
       └────────────────┴──────────────────┘
                        │
                        ▼
            ┌────────────────────┐
            │  SkillRegistry     │
            │  aggregates all    │
            │  results           │
            └─────────┬──────────┘
                      │
          ┌───────────┼────────────┐
          ▼           ▼            ▼
  ┌──────────────┐ ┌──────────┐ ┌──────────────────┐
  │  Terminal    │ │  SQLite  │ │  HTML Report     │
  │  report      │ │  history │ │  (self-contained)│
  │  (Ink UI)    │ │  .db     │ │  opens in browser│
  └──────────────┘ └──────────┘ └──────────────────┘
```

---

## Web Dashboard

CheckApp includes a local web dashboard for browsing check history, running new checks, and managing skills and settings from the browser.

**Start the dashboard:**

```bash
# Via CLI flag
checkapp --ui

# Or directly from source
cd dashboard && bun run dev
```

The dashboard runs at `http://localhost:3000` and includes:

| Page | Description |
|------|-------------|
| **Overview** | Total checks, average scores, cost chart, verdict distribution |
| **Reports** | Browse and search check history, view full report details |
| **Run Check** | Paste text or URL, attach tags, run a check from the browser |
| **Skills** | Toggle skills on/off, view engine labels and API key status |
| **Settings** | Manage API keys, configure thresholds per skill |
| **Docs** | In-app onboarding, skill reference, score explanations |

The dashboard also exposes a JSON API for programmatic access. See [docs/api.md](docs/api.md) for the full reference.

---

## Agent Integration

CheckApp works with AI agents via MCP tools or CLI. See [AGENTS.md](AGENTS.md) for the full integration guide.

---

## Pricing Summary

Approximate cost per 800-word article check with all skills enabled:

| Skill | Engine | Cost |
|-------|--------|------|
| Plagiarism | Copyscape | ~$0.09 |
| AI Detection | Copyscape | ~$0.09 |
| SEO | Offline | free |
| Fact Check | Exa + MiniMax/Claude | ~$0.03 |
| Tone of Voice | MiniMax/Claude | ~$0.002 |
| Legal Risk | MiniMax/Claude | ~$0.002 |
| Content Summary | MiniMax/Claude | ~$0.002 |
| Brief Matching | MiniMax/Claude | ~$0.002 |
| Content Purpose | MiniMax/Claude | ~$0.002 |
| Passage evidence (optional) | Parallel AI | ~$0.003 |
| **Total — all skills** | | **~$0.22** |

For a team publishing 100 articles per month: ~$22/month in API costs.

---

## Configuring Skills

Enable or disable skills via the `skills` section of `~/.checkapp/config.json`, or set them directly in your `.env`:

```json
{
  "skills": {
    "plagiarism": true,
    "aiDetection": true,
    "seo": true,
    "factCheck": true,
    "tone": true,
    "legal": true,
    "summary": true,
    "brief": true,
    "purpose": true
  }
}
```

Skills that require unconfigured API keys skip gracefully and show a `warn` verdict with a setup hint rather than failing the check.

### Custom Thresholds

Override the default pass/warn/fail cutoffs for any skill in `~/.checkapp/config.json`:

```json
{
  "thresholds": {
    "seo": { "pass": 80, "warn": 60 },
    "plagiarism": { "pass": 90, "warn": 70 }
  }
}
```

Scores >= `pass` result in a PASS verdict, scores >= `warn` result in WARN, and anything below `warn` is FAIL. Only skills listed in `thresholds` are overridden; all others use their built-in defaults.

### Language Support (v1.2.0)

CheckApp is tuned and tested for **English and Hebrew**. Other scripts (Arabic, Chinese, Japanese, Korean, Russian, etc.) are detected, but SEO tokenization, passage-matching (`MIN_WORDS` uses whitespace tokens), and sentence splitting are NOT tuned for them. Non-Latin / non-Hebrew content may produce approximate or misleading scores. Full CJK + Arabic support is planned for Phase 8.

### Tone of Voice Guide

The tone skill compares your article against a brand voice document — a `.md` file that describes how your brand writes. Example:

```markdown
# Brand Voice Guide

- Write in second person ("you", "your")
- Conversational and warm, never clinical
- Avoid jargon and acronyms without explanation
- Short paragraphs — max 3 sentences
- Use contractions (it's, we're) — formal language feels distant
```

Set the path: `TONE_GUIDE_FILE=/path/to/brand-voice.md`

---

## Roadmap

### Done

- Readability score (Flesch-Kincaid)
- `--output report.md` / `--output report.html` export
- Local web dashboard (`checkapp --ui`) with overview, reports, check, skills, settings, docs pages
- Tags, search, and JSON API
- Dark mode
- Context system — tone guides, briefs, legal policies stored in SQLite, managed via CLI or dashboard
- MCP server — 8 tools for AI agent integration (Claude Code, Cursor, Windsurf)
- Brief Matching skill — checks article against uploaded content brief
- CI mode (`--ci`) — exit 1 on fail for CI/CD pipelines
- JSON output (`--json`) — structured output for scripts and agents
- Headless check engine (`runCheckHeadless()`) for MCP, CI, and dashboard API
- AGENTS.md — full agent integration guide
- Dashboard Contexts page — upload, edit, preview contexts in browser
- OpenRouter integration — one API key for 200+ models, configurable via `LLM_PROVIDER` env var
- Language support — tuned for English and Hebrew; other scripts detected but not optimized (CJK + Arabic in Phase 8)
- Tone improvement suggestions — rewrite suggestions in brand voice alongside violation flags
- Citation recommendations — verified fact-check claims include source domain citations
- Content purpose detection — classifies article type with purpose-specific recommendations
- Regenerate/fix engine — `--fix` flag generates AI-suggested rewrites for flagged sentences

### Medium-term

- **Private index** — register your own published articles with Copyscape so future checks exclude them from results

### Long-term

- **Second AI detector** — Originality.ai integration for cross-validation of AI detection
- **CMS integrations** — WordPress plugin, Ghost webhook, Webflow integration
- **Team dashboard** — multi-user web interface with per-writer stats and trends
- **Custom skill packages** — publish your own validator as an npm package, install with `checkapp skill add <package>`
- **Ranking score** — overall article quality score combining all skill signals, calibrated for SEO impact
- **Additional LLM providers** — OpenAI (GPT-4o-mini), Google Gemini — configurable per user

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime & compiler | [Bun](https://bun.sh) |
| Terminal UI | [Ink](https://github.com/vadimdemedes/ink) — React for CLIs |
| Plagiarism + AI detection | [Copyscape Premium API](https://www.copyscape.com/api-guide.php) |
| SEO analysis | Offline — custom metrics engine |
| Fact checking | [Exa AI](https://exa.ai) search + MiniMax M2.7 or Claude Haiku assessment |
| Tone + Legal | MiniMax M2.7 (preferred) or Claude Haiku (fallback) |
| Passage evidence | [Parallel Extract API](https://docs.parallel.ai/) |
| Article fetch | Google Docs public export URL or local file |
| History database | [bun:sqlite](https://bun.sh/docs/api/sqlite) (CLI) / [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (dashboard) — stored at `~/.checkapp/history.db` |
| HTML reports | Self-contained inline HTML/CSS — no external dependencies |
| Language | TypeScript strict |

---

## Project Structure

```
checkapp/
├── src/
│   ├── index.tsx             # Entry point — routes to setup, history, check, or --ui
│   ├── setup.tsx             # First-run credential wizard (Ink UI)
│   ├── check.tsx             # Check flow UI — SkillRegistry + HTML report + SQLite
│   ├── gdoc.ts               # Input reader — Google Docs or local .md/.txt
│   ├── config.ts             # Config: credentials, skill toggles
│   ├── db.ts                 # SQLite history — openDb, insertCheck, queryRecent
│   ├── report.ts             # Self-contained HTML report generator
│   ├── copyscape.ts          # Copyscape plagiarism API client + XML parser
│   ├── aidetector.ts         # Copyscape AI detector API client + XML parser
│   ├── parallel.ts           # Parallel Extract API client
│   ├── passage.ts            # Passage matcher — finds copied sentences
│   ├── batch.ts              # Batch checking — runs all .md/.txt files in a directory
│   ├── checker.ts            # Headless check engine — runCheckHeadless() for MCP/CI/API
│   ├── regenerate.ts         # Regenerate/fix engine — AI rewrites for flagged sentences
│   ├── mcp-server.ts         # MCP server — 8 tools for agent integration
│   ├── thresholds.ts         # Configurable pass/warn/fail score cutoffs
│   ├── language.ts           # Language detection — English, Hebrew, Arabic, Chinese, Japanese, Korean
│   └── skills/
│       ├── types.ts          # Skill interface, SkillResult, Finding types
│       ├── registry.ts       # SkillRegistry — parallel execution, error isolation
│       ├── plagiarism.ts     # PlagiarismSkill — wraps copyscape.ts
│       ├── aidetection.ts    # AiDetectionSkill — wraps aidetector.ts
│       ├── seo.ts            # SeoSkill — offline word/heading/readability check
│       ├── factcheck.ts      # FactCheckSkill — Exa search + Claude assessment
│       ├── tone.ts           # ToneSkill — Claude brand voice validator
│       ├── legal.ts          # LegalSkill — Claude legal risk scanner
│       ├── summary.ts        # SummarySkill — topic, argument, audience, tone analysis
│       ├── brief.ts          # BriefSkill — checks article against content brief
│       ├── purpose.ts        # PurposeSkill — detects article type with recommendations
│       └── llm.ts            # Shared LLM client factory for MiniMax/Claude/OpenRouter
├── dashboard/                # Local web dashboard (Next.js)
│   ├── src/app/              # Pages: overview, reports, check, skills, settings, docs
│   ├── src/app/api/          # JSON API routes
│   └── src/lib/              # Shared DB, config, and utility modules
├── docs/
│   ├── api.md                # Dashboard API reference
│   ├── features.md           # Full feature list
│   ├── custom-skills.md      # Custom skill authoring guide
│   └── ROADMAP-IDEAS.md      # Roadmap and future ideas
├── demo/
│   ├── english-demo.md       # English article with Wikipedia passages (33% — REWRITE)
│   ├── hebrew-demo.md        # Hebrew article with Hebrew Wikipedia passages (39% — REWRITE)
│   └── superpharm-demo.md    # Hebrew article with Ynet sentences (33% — REWRITE)
├── build.sh                  # Compiles four platform binaries to dist/
├── package.json
└── README.md
```

---

## Writing a Custom Skill

Add any validator by creating a class that implements the `Skill` interface:

```typescript
// src/skills/my-skill.ts
import type { Skill, SkillResult } from "./types.ts";
import type { Config } from "../config.ts";

export class MySkill implements Skill {
  readonly id = "my-skill";
  readonly name = "My Custom Check";

  async run(text: string, config: Config): Promise<SkillResult> {
    // your logic here
    return {
      skillId: this.id,
      name: this.name,
      score: 85,           // 0–100
      verdict: "pass",     // "pass" | "warn" | "fail"
      summary: "All good",
      findings: [],        // Array of { severity, text, quote? }
      costUsd: 0,
    };
  }
}
```

Then add it to the `allSkills` array in `src/check.tsx` and wire the toggle in `src/config.ts`.

See [docs/custom-skills.md](docs/custom-skills.md) for the full guide with examples.

### Documentation

- [API Reference](docs/api.md) — all dashboard JSON endpoints with curl examples
- [Feature List](docs/features.md) — complete feature inventory by category
- [Custom Skills Guide](docs/custom-skills.md) — how to write your own skill
- [Roadmap](docs/ROADMAP-IDEAS.md) — planned features by phase

---

## For Developers — Run from Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/sharonds/checkapp
cd checkapp
bun install

# Run with a local file
bun src/index.tsx ./demo/english-demo.md

# View check history
bun src/index.tsx --history

# Run tests
bun test

# End-to-end tests (mocked providers, real Next.js dashboard + CLI + MCP)
bun run test:e2e:browser

# Build all platform binaries
bash build.sh
```

**Environment variables** (create a `.env` file in the project root):

```env
COPYSCAPE_USER=your-username
COPYSCAPE_KEY=your-api-key
PARALLEL_API_KEY=your-parallel-key     # optional
EXA_API_KEY=your-exa-key               # optional — enables fact check
MINIMAX_API_KEY=your-minimax-key       # optional — preferred LLM for fact check, tone, legal
ANTHROPIC_API_KEY=your-anthropic-key   # optional — fallback LLM if MINIMAX_API_KEY not set
OPENROUTER_API_KEY=your-openrouter-key # optional — one key for 200+ models
LLM_PROVIDER=minimax                   # optional — minimax (default), anthropic, or openrouter
TONE_GUIDE_FILE=/path/to/voice.md      # optional — enables tone of voice skill
```

---

## Security

- Credentials are stored **locally only** at `~/.checkapp/config.json`, or read from environment variables — never stored remotely
- Article text is sent to Copyscape (plagiarism + AI detection), optionally to Parallel AI (source page fetching), Exa AI (fact checking), and MiniMax or Anthropic (fact check, tone, legal) — all over HTTPS
- The HTML report and SQLite database are stored locally in the current directory and `~/.checkapp/`
- No analytics, no telemetry, no logging

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines. Issues and PRs welcome.

---

## About the Author

Built by **[Sharon Sciammas](https://github.com/sharonds)** — full-stack developer and AI automation specialist based in the Netherlands. Sharon builds AI-powered SaaS products including event management platforms, marketing automation pipelines, and CRM infrastructure for AI agents.

This tool was built as part of a content quality pipeline for agencies using AI-generated marketing content.

---

## License

[MIT](LICENSE)
