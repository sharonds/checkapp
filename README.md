# Article Checker

> AI-content quality gate for marketing teams. One command returns a plagiarism score, an AI-detection score, and the exact copied sentences — before you publish.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-fbf0df?logo=bun)](https://bun.sh)
[![Ink](https://img.shields.io/badge/UI-Ink%20%2B%20React-61DAFB?logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![Copyscape](https://img.shields.io/badge/Engine-Copyscape-0078D4)](https://www.copyscape.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

## What Is Article Checker?

Article Checker is a CLI tool that runs a two-layer quality check on any article — a Google Doc URL or a local `.md`/`.txt` file — before it goes live:

1. **Plagiarism check** — finds which published pages share text with your article, scores overall similarity, and shows which exact sentences were copied.
2. **AI detection** — estimates the probability that the content was AI-generated, sentence by sentence.

You get both results in one run, in under 15 seconds, with no browser and no cloud dashboard.

> **Privacy first.** The only network calls are to `docs.google.com` (to read the doc), `www.copyscape.com` (plagiarism + AI detection), and optionally `api.parallel.ai` (to fetch the source pages for passage-level evidence). No analytics, no telemetry, no logging.

---

## The Problem This Solves

AI writing tools (Gemini, ChatGPT, Claude) don't copy-paste — but they all draw from the same training data. When every AI writes about "benefits of Vitamin D," the outputs can end up structurally similar to articles already indexed on the web — not from copying, but from convergent generation.

Beyond AI content, human writers sometimes copy a sentence or two from a source article, embed it in original content, and assume it won't be detected. It will be.

Article Checker gives your team a one-command safety gate before every publish.

---

## Features

| Feature | Details |
|---------|---------|
| **Plagiarism check** | Checks against the full indexed web via Copyscape. Returns a 0–100% similarity score. |
| **AI detection** | Uses Copyscape's AI detector. Returns a 0–100% probability that the content is AI-generated, broken down sentence by sentence. |
| **Passage evidence** | Fetches the top 3 flagged pages and finds which exact sentences in your article appear there. Shows the copied text verbatim. Requires a Parallel AI key (free tier available). |
| **Three-tier verdict** | PUBLISH / REVIEW / REWRITE for plagiarism. HUMAN / MIXED / AI-GENERATED for AI detection. |
| **Google Doc support** | Paste a publicly-shared Google Doc URL. No Google auth required. |
| **Local file support** | Pass a `.md` or `.txt` file path. Works completely offline for the article fetch step. |
| **Env var config** | Set `COPYSCAPE_USER`, `COPYSCAPE_KEY`, and `PARALLEL_API_KEY` in `.env` — no setup wizard needed. |
| **Single binary** | Download one file and run it. No Node.js, Bun, or runtime required. |
| **Cross-platform** | Mac (Apple Silicon + Intel), Linux, Windows. |

---

## Real Results — What It Finds

These are actual outputs from real checks run during development.

### Example 1 — English article with Wikipedia passages

An article about Vitamin D was written with 3 verbatim sentences lifted from Wikipedia. The checker found them in seconds.

```
────────────────────────────────────────────────
Words checked:  310
Plagiarism:      33%  (104 / 314 words matched)

Top matches (19 sources):
  1.  en.wikipedia.org/wiki/Vitamin_D                  104 words
      ↳ "Unlike the other twelve vitamins, vitamin D is only conditionally
         essential in the diet, as with adequate skin exposure to the…"
      ↳ "Vitamin D can also be obtained through diet, food fortification
         and dietary supplements."
      ↳ "For most people, skin synthesis contributes more than dietary sources."
  2.  eprints.cihanuniversity.edu.iq/…                  26 words
  3.  (3 more sources)

AI detection:    10%  probability AI-generated

────────────────────────────────────────────────
❌  REWRITE — similarity too high
✍️   HUMAN — 10% AI probability (likely human)
────────────────────────────────────────────────
```

**What happened:** Three sentences were copied verbatim from `en.wikipedia.org/wiki/Vitamin_D`. The tool found the exact source, matched 104 words, and showed the copied sentences. The AI score was 10% — correctly identified as human-written Wikipedia content.

---

### Example 2 — Hebrew article with Wikipedia passages

Same test in Hebrew. Three sentences from the Hebrew Wikipedia article on Vitamin D were embedded in an otherwise original article.

```
────────────────────────────────────────────────
Words checked:  119
Plagiarism:      39%  (46 / 118 words matched)

Top matches (3 sources):
  1.  he.wikipedia.org/wiki/ויטמין_D                    46 words
      ↳ "ויטמין D הוא קבוצה של חמש תרכובות מסיסות בשמן המסייעות
         למאזן תקין של משק הסידן והזרחן בגוף האדם."
      ↳ "המחלה הנפוצה והידועה ביותר הנגרמת כתוצאה ממחסור בוויטמין D
         בילדים היא רככת"
  2.  (2 more sources)

AI detection:    12%  probability AI-generated

────────────────────────────────────────────────
❌  REWRITE — similarity too high
✍️   HUMAN — 12% AI probability (likely human)
────────────────────────────────────────────────
```

**What happened:** The checker works equally well on Hebrew content. It identified the exact Hebrew Wikipedia source and quoted the copied sentences in Hebrew. The tool handles right-to-left text without configuration.

---

### Example 3 — Hebrew article with 2 sentences from an Israeli news site (Ynet)

An article about Vitamin C was written with 2 verbatim sentences from a Ynet health article. The rest was original. Only ~220 words total.

```
────────────────────────────────────────────────
Words checked:  222
Similarity:      33%  (76 / 224 words matched)

Top matches (2 sources):
  1.  ynet.co.il/articles/0,7340,L-4870486,00.html      76 words
  2.  news08.net/…                                       54 words
      (syndicated copy of the same Ynet article)

────────────────────────────────────────────────
❌  REWRITE — similarity too high
────────────────────────────────────────────────
```

**What happened:** 2 sentences out of ~220 words were copied from a Ynet article. The checker found both the original source and a syndicated site that republished the same article. Even 2 sentences in 220 words of original content was enough to flag a REWRITE.

---

## Verdicts

### Plagiarism

| Similarity | Verdict | What to do |
|-----------|---------|-----------|
| 0 – 15% | ✅ **PUBLISH** | No significant matches. Safe to publish. |
| 16 – 25% | ⚠️ **REVIEW** | Some overlap. Check the listed sources and rewrite any matching passages. |
| 26%+ | ❌ **REWRITE** | Too similar to existing content. Rewrite before publishing. |

### AI Detection

| AI probability | Verdict | What to do |
|---------------|---------|-----------|
| 0 – 29% | ✍️ **HUMAN** | Content reads as human-written. |
| 30 – 69% | 🔍 **MIXED** | Contains AI-like passages. Review highlighted sentences. |
| 70%+ | 🤖 **AI-GENERATED** | High probability of AI authorship. Rewrite or clearly disclose. |

---

## Quick Start

### Step 1 — Download the binary

Go to the **[Releases page](https://github.com/sharonds/article-checker/releases/latest)** and download the file for your platform:

| File | Platform |
|------|----------|
| `article-checker-mac-arm64` | Mac — Apple Silicon (M1/M2/M3/M4) |
| `article-checker-mac-x64` | Mac — Intel |
| `article-checker-linux-x64` | Linux x64 |
| `article-checker-win-x64.exe` | Windows x64 |

> **Not sure which Mac you have?** Apple menu → About This Mac. "Apple M…" = arm64 · "Intel" = x64

### Step 2 — Make it executable (Mac/Linux only)

```bash
chmod +x ~/Downloads/article-checker-mac-arm64
```

### Step 3 — Move to your PATH (optional but recommended)

```bash
mv ~/Downloads/article-checker-mac-arm64 /usr/local/bin/article-checker
```

### Step 4 — Add your API keys

Create a `.env` file in your working directory (or export the variables in your shell profile):

```bash
COPYSCAPE_USER=your-copyscape-username
COPYSCAPE_KEY=your-copyscape-api-key
PARALLEL_API_KEY=your-parallel-api-key   # optional — enables passage evidence
```

Or run the setup wizard (skipped automatically if env vars are present):

```bash
article-checker --setup
```

### Step 5 — Run it

```bash
# Check a Google Doc (must be publicly shared)
article-checker "https://docs.google.com/document/d/XXXX/edit"

# Check a local file
article-checker ./my-article.md
```

---

## API Keys — Setup Guide

### Copyscape (required)

Copyscape handles both plagiarism checking and AI detection. One account, one key, both features.

**How to get your key:**

1. Go to [copyscape.com](https://www.copyscape.com/) and click **Sign up for Premium**
2. Create an account with your email address
3. Add credits — minimum deposit is **$5** (roughly 50 full checks)
4. Go to **My Account → API** — your API key is listed there
5. Your username is the email address you signed up with

**Cost per check (800-word article):**

| Operation | Words | Cost |
|-----------|-------|------|
| Plagiarism check | first 200 words | $0.03 |
| Plagiarism check | each additional 100 words | $0.01 |
| AI detection | first 200 words | $0.03 |
| AI detection | each additional 100 words | $0.01 |
| **800-word article (both checks)** | | **~$0.18** |

Both checks run in parallel, so the total time is the same as running one check.

**Minimum deposit:** $5 → approximately 27 full checks (800 words, both plagiarism + AI detection).

### Parallel AI (optional — passage evidence)

Parallel AI fetches the full content of each flagged URL and finds which sentences in your article appear verbatim on that page. Without it, you see which sites matched and how many words — with it, you see the exact copied sentences.

**How to get your key:**

1. Go to [platform.parallel.ai](https://platform.parallel.ai/)
2. Create a free account
3. Go to **API Keys** in your dashboard
4. Click **Create new key** and copy it

**Cost:** $0.001 per URL fetched. Each check fetches up to 3 URLs → $0.003 per check. The free tier includes 16,000 requests.

| | |
|--|--|
| **Free tier** | 16,000 requests |
| **Cost after free tier** | $0.001 per URL |
| **Per check (3 URLs)** | $0.003 |
| **Setup** | Add `PARALLEL_API_KEY` to your `.env` |

---

## Usage

```bash
# Check a Google Doc (publicly shared)
article-checker "https://docs.google.com/document/d/XXXX/edit"

# Check a local Markdown file
article-checker ./article.md
article-checker /absolute/path/to/article.txt

# Re-run setup wizard (update credentials)
article-checker --setup
```

**Google Docs must be publicly accessible.** In the doc: Share → Change to "Anyone with the link" → Viewer → Done.

---

## How It Works

```
Article input (Google Doc URL or local .md/.txt)
        │
        ▼
┌───────────────────────────────────────┐
│  Article fetch                        │
│  Google Docs export URL (no auth)     │
│  or local file read                   │
└──────────────┬────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────────┐   ┌───────────────────┐
│  Copyscape  │   │  Copyscape        │
│  Plagiarism │   │  AI Detector      │
│  (csearch)  │   │  (aicheck)        │
└──────┬──────┘   └────────┬──────────┘
       │                   │
       └──────────┬────────┘
                  │  (parallel — same total time)
                  ▼
    ┌─────────────────────────┐
    │  Parallel Extract API   │  optional
    │  Fetch top 3 flagged    │
    │  URLs + find copied     │
    │  sentences              │
    └────────────┬────────────┘
                 │
                 ▼
         ┌───────────────┐
         │  Report       │
         │  Plagiarism % │
         │  AI score %   │
         │  Top sources  │
         │  Copied text  │
         │  Verdict      │
         └───────────────┘
```

---

## Pricing Summary

All-in cost per article check (800 words, all features):

| Component | Cost |
|-----------|------|
| Plagiarism check (Copyscape) | ~$0.09 |
| AI detection (Copyscape) | ~$0.09 |
| Passage evidence — 3 URLs (Parallel AI) | ~$0.003 |
| **Total per check** | **~$0.18** |

For a team publishing 100 articles per month: ~$18/month in API costs.

---

## Roadmap

Features planned for future releases:

### Near-term

- **`--output report.md`** — save the full report as a Markdown file
- **Check history database** — SQLite log of every check: article name, date, similarity score, AI score, verdict, cost. Query with `article-checker history`.
- **Local web dashboard** — a lightweight local UI (`article-checker ui`) to browse past checks, filter by verdict, and see trends over time
- **Cost tracking** — running total of Copyscape API spend, shown after each check and summarized in history

### Medium-term

- **Batch checking** — `article-checker check-all ./articles/` to check a directory of files
- **Configurable thresholds** — set your own REVIEW/REWRITE cutoffs via a config flag or `.article-checker.json`
- **`--rewrite` flag** — pass flagged passages to Claude API for a suggested rewrite
- **Private index** — register your own published articles with Copyscape so future checks exclude them from results

### Long-term

- **Originality.ai integration** — second AI detection engine for cross-validation
- **CMS integrations** — WordPress plugin, Ghost webhook, Webflow integration
- **Team dashboard** — multi-user web interface with per-writer stats

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime & compiler | [Bun](https://bun.sh) |
| Terminal UI | [Ink](https://github.com/vadimdemedes/ink) — React for CLIs |
| Plagiarism engine | [Copyscape Premium API](https://www.copyscape.com/api-guide.php) (`csearch`) |
| AI detection engine | [Copyscape AI Detector API](https://www.copyscape.com/api-guide.php#airequest) (`aicheck`) |
| Passage evidence | [Parallel Extract API](https://docs.parallel.ai/) |
| Article fetch | Google Docs public export URL (no auth) or local file read |
| Language | TypeScript (strict) |

No database. No server. No cloud dependency beyond the two APIs.

---

## Project Structure

```
article-checker/
├── src/
│   ├── index.tsx         # Entry point — routes to setup or check
│   ├── setup.tsx         # First-run credential wizard (Ink UI)
│   ├── check.tsx         # Check flow UI + report (Ink UI)
│   ├── gdoc.ts           # Input reader — Google Docs or local .md/.txt
│   ├── copyscape.ts      # Copyscape plagiarism API client + XML parser
│   ├── aidetector.ts     # Copyscape AI detector API client + XML parser
│   ├── parallel.ts       # Parallel Extract API client
│   ├── passage.ts        # Passage matcher — finds copied sentences
│   └── config.ts         # Reads credentials from env vars or config file
├── demo/
│   ├── english-demo.md   # English article with Wikipedia passages (33% — REWRITE)
│   ├── hebrew-demo.md    # Hebrew article with Hebrew Wikipedia passages (39% — REWRITE)
│   └── superpharm-demo.md  # Hebrew article with Ynet sentences (33% — REWRITE)
├── build.sh              # Compiles four platform binaries to dist/
├── package.json
└── README.md
```

---

## For Developers — Run from Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/sharonds/article-checker
cd article-checker
bun install

# Run with a local file
bun src/index.tsx ./demo/english-demo.md

# Run tests
bun test

# Build all platform binaries
bash build.sh
# → dist/article-checker-mac-arm64
# → dist/article-checker-mac-x64
# → dist/article-checker-linux-x64
# → dist/article-checker-win-x64.exe
```

**Environment variables** (create a `.env` file in the project root):

```bash
COPYSCAPE_USER=your-username
COPYSCAPE_KEY=your-api-key
PARALLEL_API_KEY=your-parallel-key   # optional
```

---

## Security

- Credentials are stored **locally only** at `~/.article-checker/config.json`, or read from environment variables — never stored remotely
- Article text is sent to Copyscape (for plagiarism and AI detection) and optionally to Parallel AI (to fetch source URLs) — both over HTTPS
- Review [Copyscape's privacy policy](https://www.copyscape.com/privacy.php) and [Parallel's privacy policy](https://parallel.ai/privacy) for details on how submitted content is handled
- No other network requests, no analytics, no telemetry

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
