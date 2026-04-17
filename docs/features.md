# CheckApp — Feature List

## Content Quality Skills

| Skill | Engine | Cost/check | Default |
|-------|--------|-----------|---------|
| Plagiarism Check | Copyscape | ~$0.09 | Enabled |
| AI Detection | Copyscape | ~$0.09 | Enabled |
| SEO Analysis | Offline | Free | Enabled |
| Fact Check | Exa AI + MiniMax/Claude | ~$0.03 | Requires API keys |
| Tone of Voice | MiniMax/Claude | ~$0.002 | Requires API keys + tone guide |
| Legal Risk | MiniMax/Claude | ~$0.002 | Requires API keys |
| Content Summary | MiniMax/Claude | ~$0.002 | Requires API keys |
| Brief Matching | MiniMax/Claude | ~$0.002 | Requires API keys + brief context |
| Content Purpose | MiniMax/Claude | ~$0.002 | Requires API keys |
| Grammar & Style | LanguageTool (default) / Sapling / LLM-fallback | Free / $0.0008/100w / LLM | Optional — LT free, no key required |
| Academic Citations | Semantic Scholar | Free (100 req/5min) | Optional — no key required |
| Self-Plagiarism | Cloudflare Vectorize / Pinecone / Upstash | ~$0.0002/article | Optional — requires one-time `checkapp index <dir>` |

All enabled skills run in parallel. Skills with missing API keys skip gracefully.

### Phase 7 — Research-Backed Editor (shipped 2026-04)

Phase 7 extends findings with evidence + rewrite + citation. Findings now carry optional `sources[]`, `rewrite`, `citations[]`, `claimType`, and `confidence` fields. See [docs/api.md](api.md) for the extended `Finding` shape and [docs/security.md](security.md) for BYOK scope.

| Phase 7 addition | Details |
|------------------|---------|
| Sources per fact-check finding | Exa highlights (url, title, quote, publishedDate) returned on every `fact-check` finding |
| Rewrite per grammar finding | LanguageTool or LLM-fallback produces a corrected sentence; LLM rewrites get a second grammar pass |
| Academic enrichment | Semantic Scholar DOIs merged onto fact-check findings whose `claimType` is scientific/medical/financial |
| Deep fact-check | `--deep-fact-check` flag swaps the provider to Exa Deep Reasoning for multi-hop claims |
| Claim drill-down | Dashboard `/check` page shows sources + citations + rewrite inline per finding |
| Cost estimator | `checkapp --estimate-cost` or the Run Check page shows per-skill estimate before any API call |
| Provider picker | Settings → Providers page lets users choose per-skill provider; no key = degraded fallback, never silent failure |

### LLM Providers

CheckApp supports three LLM providers for AI-powered skills (fact check, tone, legal, summary, brief):

| Provider | Env var | Notes |
|----------|---------|-------|
| MiniMax (default) | `MINIMAX_API_KEY` | Cheapest, Anthropic-compatible API |
| Anthropic Claude | `ANTHROPIC_API_KEY` | Fallback if MiniMax not set |
| OpenRouter | `OPENROUTER_API_KEY` | One key for 200+ models (GPT-4o, Llama, Mistral, etc.) |

Set the provider via `LLM_PROVIDER` env var or the Settings page in the dashboard.

### Language Support (v1.2.0)

CheckApp is tuned and tested for **English and Hebrew**. Other scripts (Arabic, Chinese, Japanese, Korean, Russian, etc.) are detected, but SEO tokenization, passage-matching (`MIN_WORDS` uses whitespace tokens), and sentence splitting are NOT tuned for them. Non-Latin / non-Hebrew content may produce approximate or misleading scores. Full CJK + Arabic support is planned for Phase 8.

### Tone Rewrite Suggestions

When tone violations are found, each finding includes a suggested rewrite of the flagged passage in your brand voice -- not just the issue description.

### Citation Recommendations

Verified fact-check claims include source domain citations from the URLs used as evidence. This helps writers add proper citations to their articles.

### Content Purpose Detection

Classifies the article's content purpose (tutorial, product announcement, case study, thought leadership, how-to guide, etc.) and provides purpose-specific recommendations for missing structural elements. Scoring expectations adjust based on detected purpose.

### Regenerate/Fix Engine

`checkapp --fix <file>` runs all checks and then generates AI-suggested rewrites for every flagged sentence. Uses tone guide and legal policy contexts when available. Outputs before/after diffs for each issue. Also available via the `regenerate_article` MCP tool.

---

## Report and Export

- **HTML report** — Self-contained file with score bars, verdict badges, and per-finding citations. Opens in browser automatically after each check.
- **Markdown export** — `--output report.md` saves the terminal report as a Markdown file.
- **SQLite history** — Every check is persisted to `~/.checkapp/history.db`. Query with `--history`.

---

## Organization

- **Tags** — Attach tags to any check via the dashboard or API (`POST /api/checks/:id/tags`). Filter and search by tag.
- **Search** — Full-text search across check sources and results via the dashboard or API (`GET /api/search`).
- **Batch checking** — `checkapp --batch ./articles/` checks all `.md`/`.txt` files in a directory.
- **Configurable thresholds** — Custom pass/warn/fail score cutoffs per skill in `config.json`.

---

## Web Dashboard

A local Next.js web interface started with `checkapp --ui` or `cd dashboard && bun run dev`.

| Page | Description |
|------|-------------|
| **Overview** (/) | Total checks, average scores, cost chart, verdict distribution. |
| **Reports** (/reports) | Browse check history, view details, filter by verdict. |
| **Report Detail** (/reports/:id) | Full skill results, findings, score breakdown, tags. |
| **Run Check** (/check) | Paste text or URL, add tags, run a new check from the browser. |
| **Skills** (/skills) | Toggle skills on/off, see engine labels, API key status. |
| **Contexts** (/contexts) | Upload and manage context documents (tone guides, briefs, legal policies, style guides). |
| **Settings** (/settings) | API key management with status indicators, threshold configuration. |
| **Docs** (/docs) | In-app onboarding, skill reference, score guide, API setup, FAQ. |

Additional dashboard features:
- Dark mode via next-themes
- Responsive layout (desktop + mobile)
- JSON API for all operations (see [docs/api.md](api.md))

---

## Developer and Agent API

- **JSON API** — RESTful endpoints at `http://localhost:3000/api` for running checks, managing tags, toggling skills, and reading config. See [docs/api.md](api.md).
- **CLI flags:**
  - `--ui` — Start the web dashboard and open browser
  - `--batch <dir>` — Check all files in a directory
  - `--output <path>` — Export report to `.md` or `.html`
  - `--history` — Show recent checks from SQLite
  - `--fix <file>` — Run checks then generate AI-suggested rewrites for flagged sentences
  - `--setup` — Re-run credential wizard
- **Custom skills** — Implement the `Skill` TypeScript interface to add your own validators. See [docs/custom-skills.md](custom-skills.md).

---

## Context System

Contexts are reusable documents that provide additional instructions to skills during checks.

| Context type | Used by | Purpose |
|-------------|---------|---------|
| `tone-guide` | Tone of Voice | Brand voice rules and writing standards |
| `legal-policy` | Legal Risk | Company-specific legal requirements |
| `brief` | Brief Matching | Content brief with topic, audience, and requirements |
| `style-guide` | SEO + Tone | Writing style rules |
| `custom` | Custom skills | Any additional context |

Manage contexts via:
- **CLI:** `checkapp context add/list/show/remove`
- **Dashboard:** Contexts page (upload, edit, preview)
- **API:** `POST/GET/DELETE /api/contexts`
- **MCP:** `upload_context` and `list_contexts` tools

Contexts are stored in the SQLite database (`~/.checkapp/history.db`) and automatically loaded by relevant skills before each check.

---

## MCP Server

CheckApp includes an MCP (Model Context Protocol) server for AI agent integration with Claude Code, Cursor, and Windsurf.

Start the server: `checkapp --mcp`

| Tool | Description |
|------|-------------|
| `check_article` | Run quality checks on article text |
| `list_reports` | Browse check history |
| `get_report` | Get full report by ID |
| `upload_context` | Save a tone guide, brief, or legal policy |
| `list_contexts` | View saved context documents |
| `get_skills` | See which skills are enabled |
| `toggle_skill` | Enable/disable a skill |
| `regenerate_article` | Get AI-suggested rewrites for flagged sentences |

See [AGENTS.md](../AGENTS.md) for full integration instructions.

---

## CI Mode and JSON Output

- **`--ci`** — Exits with code 1 if any skill returns a `fail` verdict. Designed for CI/CD pipelines and automated quality gates.
- **`--json`** — Outputs structured JSON instead of the Ink terminal UI. Ideal for scripts, agents, and piping results to other tools.
- **`runCheckHeadless()`** — Programmatic API for running checks without the terminal UI. Used by the MCP server, CI mode, and dashboard API.
