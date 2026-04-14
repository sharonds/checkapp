# Article Checker

> AI content quality gate for marketing teams. One command returns plagiarism, AI-detection, SEO score, fact-check, tone-of-voice, and legal risk — before you publish. Results saved to a local database and rendered as a self-contained HTML report.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built with Bun](https://img.shields.io/badge/Built%20with-Bun-fbf0df?logo=bun)](https://bun.sh)
[![Ink](https://img.shields.io/badge/UI-Ink%20%2B%20React-61DAFB?logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![Copyscape](https://img.shields.io/badge/Engine-Copyscape-0078D4)](https://www.copyscape.com/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

---

## What Is Article Checker?

Article Checker is a pluggable CLI tool that runs a configurable set of quality checks on any article — a Google Doc URL or a local `.md`/`.txt` file — before it goes live.

Each check is a **skill** you can enable or disable. Results appear in the terminal and are automatically saved as an HTML report and to a local SQLite history database.

---

## Skills

| Skill | Engine | Cost/check | Enabled by default |
|-------|--------|-----------|-------------------|
| **Plagiarism** | Copyscape | ~$0.09 | ✅ |
| **AI Detection** | Copyscape | ~$0.09 | ✅ |
| **SEO** | Offline (no API) | free | ✅ |
| **Fact Check** | Exa AI + Claude | ~$0.03 | ❌ requires `EXA_API_KEY` + `ANTHROPIC_API_KEY` |
| **Tone of Voice** | Claude | ~$0.002 | ❌ requires `ANTHROPIC_API_KEY` + tone guide file |
| **Legal Risk** | Claude | ~$0.002 | ❌ requires `ANTHROPIC_API_KEY` |

All enabled skills run in parallel. Adding more skills does not increase total time significantly.

---

## Features

| Feature | Details |
|---------|---------|
| **Pluggable skills** | Enable/disable any skill via config. Add custom skills by implementing one TypeScript interface. |
| **Plagiarism check** | Checks against the full indexed web via Copyscape. Returns 0–100% similarity + matched sources. |
| **AI detection** | Copyscape AI detector. Returns 0–100% probability per sentence and an overall verdict. |
| **SEO analysis** | Offline. Checks word count (800–2500 ideal), H1/H2 headings, average sentence length, Flesch-Kincaid readability. |
| **Fact check** | Extracts 4 specific claims → searches each with Exa AI → Claude assesses evidence → per-claim supported/unsupported verdict. |
| **Tone of voice** | Loads your brand voice guide (`.md` file), sends article + guide to Claude, returns violations with quotes. |
| **Legal risk** | Scans for unsubstantiated health claims, defamation, false promises, GDPR risks, price misrepresentation. |
| **HTML report** | Self-contained, no-dependency HTML file. Score bars, verdict badges, per-finding citations. Opens in browser automatically. |
| **SQLite history** | Every check is saved to `~/.article-checker/history.db`. Query with `--history`. |
| **Google Doc support** | Paste a publicly-shared Google Doc URL. No Google auth required. |
| **Local file support** | Pass a `.md` or `.txt` file path. Works offline for the fetch step. |
| **Single binary** | No Node.js, Bun, or runtime required. |
| **Cross-platform** | Mac (Apple Silicon + Intel), Linux, Windows. |

---

## Real Results — What It Finds

### Example 1 — English article with Wikipedia passages

An article about Vitamin D with 3 verbatim sentences from Wikipedia. Live output with all 3 skills:

```
────────────────────────────────────────────────
Words checked:  310
API cost:        $0.080

❌  Plagiarism Check:  33% similarity — 18 sources matched  (34/100)
✅  AI Detection:      10% AI probability — human           (90/100)
❌  SEO:               Score 49/100 — 310 words, avg 17-word sentences  (49/100)
────────────────────────────────────────────────
Overall: 58/100
Report: article-checker-report.html
────────────────────────────────────────────────
```

**HTML report:** Each skill gets a card with a score bar, verdict badge, and a list of findings with quoted passages.

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

Go to the **[Releases page](https://github.com/sharonds/article-checker/releases/latest)** and download for your platform:

| File | Platform |
|------|----------|
| `article-checker-mac-arm64` | Mac — Apple Silicon (M1/M2/M3/M4) |
| `article-checker-mac-x64` | Mac — Intel |
| `article-checker-linux-x64` | Linux x64 |
| `article-checker-win-x64.exe` | Windows x64 |

### Step 2 — Make it executable (Mac/Linux only)

```bash
chmod +x ~/Downloads/article-checker-mac-arm64
mv ~/Downloads/article-checker-mac-arm64 /usr/local/bin/article-checker
```

### Step 3 — Add your API keys

Create a `.env` file in your working directory:

```env
# Required — plagiarism + AI detection
COPYSCAPE_USER=your-copyscape-username
COPYSCAPE_KEY=your-copyscape-api-key

# Optional — passage-level evidence (free tier: 16k requests)
PARALLEL_API_KEY=your-parallel-api-key

# Optional — fact check + tone + legal skills
EXA_API_KEY=your-exa-api-key
ANTHROPIC_API_KEY=your-anthropic-api-key

# Optional — tone of voice skill (path to your brand voice .md file)
TONE_GUIDE_FILE=/path/to/brand-voice.md
```

Or run the interactive setup wizard:

```bash
article-checker --setup
```

### Step 4 — Run it

```bash
# Check a Google Doc (must be publicly shared)
article-checker "https://docs.google.com/document/d/XXXX/edit"

# Check a local file
article-checker ./my-article.md

# View check history
article-checker --history
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

### Anthropic Claude (optional — fact check, tone, legal skills)

Used for claim extraction, tone assessment, and legal risk scanning. All calls use Claude Haiku (cheapest model).

1. Go to [console.anthropic.com](https://console.anthropic.com/settings/keys)
2. Create a new API key
3. Add to `.env`: `ANTHROPIC_API_KEY=your-key`

**Cost per check:** ~$0.001–0.002 (Haiku pricing).

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
article-checker "https://docs.google.com/document/d/XXXX/edit"

# Check a local Markdown or text file
article-checker ./my-article.md

# Re-run setup wizard
article-checker --setup

# Show the last 20 checks from history
article-checker --history
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

## Pricing Summary

Approximate cost per 800-word article check with all skills enabled:

| Skill | Engine | Cost |
|-------|--------|------|
| Plagiarism | Copyscape | ~$0.09 |
| AI Detection | Copyscape | ~$0.09 |
| SEO | Offline | free |
| Fact Check | Exa + Claude Haiku | ~$0.03 |
| Tone of Voice | Claude Haiku | ~$0.002 |
| Legal Risk | Claude Haiku | ~$0.002 |
| Passage evidence (optional) | Parallel AI | ~$0.003 |
| **Total — all skills** | | **~$0.22** |

For a team publishing 100 articles per month: ~$22/month in API costs.

---

## Configuring Skills

Enable or disable skills via the `skills` section of `~/.article-checker/config.json`, or set them directly in your `.env`:

```json
{
  "skills": {
    "plagiarism": true,
    "aiDetection": true,
    "seo": true,
    "factCheck": true,
    "tone": true,
    "legal": true
  }
}
```

Skills that require unconfigured API keys skip gracefully and show a `warn` verdict with a setup hint rather than failing the check.

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

### Near-term

- **Content summary** — brief summary of what the article is about, generated by Claude (topic detection, key claims)
- **Keyword density** — top keywords detected, keyword repetition score, semantic gap analysis
- **Readability score** — Flesch-Kincaid score displayed per article in history
- **`--output report.md`** — save the terminal report as a Markdown file
- **Batch checking** — `article-checker check-all ./articles/` to check a whole directory

### Medium-term

- **Local web dashboard** (`article-checker ui`) — browse check history, filter by verdict, compare scores over time, manage API keys and skill toggles from a browser UI
- **Tone improvement suggestions** — not just flag violations, but suggest a rewritten version of each flagged sentence in your brand voice
- **Configurable thresholds** — custom REVIEW/REWRITE cutoffs via `.article-checker.json`
- **Private index** — register your own published articles with Copyscape so future checks exclude them from results
- **Citation recommendations** — when facts are verified by Exa, suggest adding inline citations with source links

### Long-term

- **Second AI detector** — Originality.ai integration for cross-validation of AI detection
- **CMS integrations** — WordPress plugin, Ghost webhook, Webflow integration
- **Team dashboard** — multi-user web interface with per-writer stats and trends
- **Custom skill packages** — publish your own validator as an npm package, install with `article-checker skill add <package>`
- **Ranking score** — overall article quality score combining all skill signals, calibrated for SEO impact

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime & compiler | [Bun](https://bun.sh) |
| Terminal UI | [Ink](https://github.com/vadimdemedes/ink) — React for CLIs |
| Plagiarism + AI detection | [Copyscape Premium API](https://www.copyscape.com/api-guide.php) |
| SEO analysis | Offline — custom metrics engine |
| Fact checking | [Exa AI](https://exa.ai) search + [Claude Haiku](https://anthropic.com) assessment |
| Tone + Legal | [Claude Haiku](https://anthropic.com) |
| Passage evidence | [Parallel Extract API](https://docs.parallel.ai/) |
| Article fetch | Google Docs public export URL or local file |
| History database | [bun:sqlite](https://bun.sh/docs/api/sqlite) — zero deps, stored at `~/.article-checker/history.db` |
| HTML reports | Self-contained inline HTML/CSS — no external dependencies |
| Language | TypeScript strict |

---

## Project Structure

```
article-checker/
├── src/
│   ├── index.tsx             # Entry point — routes to setup, history, or check
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
│   └── skills/
│       ├── types.ts          # Skill interface, SkillResult, Finding types
│       ├── registry.ts       # SkillRegistry — parallel execution, error isolation
│       ├── plagiarism.ts     # PlagiarismSkill — wraps copyscape.ts
│       ├── aidetection.ts    # AiDetectionSkill — wraps aidetector.ts
│       ├── seo.ts            # SeoSkill — offline word/heading/readability check
│       ├── factcheck.ts      # FactCheckSkill — Exa search + Claude assessment
│       ├── tone.ts           # ToneSkill — Claude brand voice validator
│       └── legal.ts          # LegalSkill — Claude legal risk scanner
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

---

## For Developers — Run from Source

Requires [Bun](https://bun.sh).

```bash
git clone https://github.com/sharonds/article-checker
cd article-checker
bun install

# Run with a local file
bun src/index.tsx ./demo/english-demo.md

# View check history
bun src/index.tsx --history

# Run tests
bun test

# Build all platform binaries
bash build.sh
```

**Environment variables** (create a `.env` file in the project root):

```env
COPYSCAPE_USER=your-username
COPYSCAPE_KEY=your-api-key
PARALLEL_API_KEY=your-parallel-key     # optional
EXA_API_KEY=your-exa-key               # optional — enables fact check
ANTHROPIC_API_KEY=your-anthropic-key   # optional — enables fact check, tone, legal
TONE_GUIDE_FILE=/path/to/voice.md      # optional — enables tone of voice skill
```

---

## Security

- Credentials are stored **locally only** at `~/.article-checker/config.json`, or read from environment variables — never stored remotely
- Article text is sent to Copyscape (plagiarism + AI detection), optionally to Parallel AI (source page fetching), Exa AI (fact checking), and Anthropic (fact check, tone, legal) — all over HTTPS
- The HTML report and SQLite database are stored locally in the current directory and `~/.article-checker/`
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
