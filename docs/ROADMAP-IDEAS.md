# CheckApp — Roadmap

## Phase 7 — Research-Backed Editor (planning)

Full strategy doc (in checkapp-landing repo): `docs/superpowers/roadmap/2026-04-17-phase7-research-backed-editor.md`

**Thesis:** Turn CheckApp from a quality gate (runs after you write) into a research-backed editor (runs with you, gives evidence + fixes, not just flags). Every flagged issue ends with: evidence, rewrite suggestion, cited source, and a grammar pass.

### New skills
- **Grammar & Style** — LanguageTool / Sapling / LLM fallback. Deterministic grammar, punctuation, style. Fills the gap the LLM tone skill cannot catch.
- **Academic Citation** — Semantic Scholar (free, no key required). Surfaces peer-reviewed papers for scientific/medical/financial claims. Returns DOI links.
- **Self-Plagiarism / Topic Coverage** — Cloudflare Vectorize / Pinecone / Upstash. Indexes user's own past articles; flags repetition with link to original.
- **Deep Fact-Check** — Exa Deep Reasoning / Parallel Task. Multi-hop reasoning for complex claims. Opt-in (slower, pricier).
- **Claim Drill-Down UI** — Click any claim in the dashboard, see 3 sources with quoted passages.

### Options-per-category model
Each skill gets a provider dropdown in Settings. User picks engine (with speed/cost/depth/free-tier info), supplies their own API key. CheckApp does not bundle tokens.

### Upgrades to existing skills
- Fact Check → `type: deep-reasoning` option; Exa Contents API `highlights` mode (10× token savings)
- Plagiarism → Copysentry monitoring option (ongoing post-publish watch)
- Dashboard → provider picker per skill + cost estimator before run

## Phase 8 — CheckApp Studio (vision)

A web editor (tiptap/monaco) where writers compose WITH CheckApp active. Checks run live in the margin. Rewrite co-pilot always available. Research panel on-demand. Built on Vercel AI SDK v6 + `useChat` + `ToolLoopAgent`. Vercel-deployed, authenticated, cloud config. This is a separate product from the CLI — CLI stays for power users + CI. Studio becomes the primary user-facing app for Phase 8+.

## Done (Phase 1-3) — CLI Foundation
- ~~7 skills: plagiarism, AI detection, SEO, fact-check, tone, legal, content summary~~
- ~~MiniMax + Anthropic LLM providers~~
- ~~Batch checking, configurable thresholds, keyword detection~~
- ~~HTML reports with score rings, engine badges, disclaimer~~
- ~~SQLite history, report export (MD/HTML)~~
- ~~Custom skill authoring guide~~

## Done (Phase 4) — Web Dashboard
- ~~Local dashboard (`checkapp --ui`) with 6 pages~~
- ~~Tags + search, dark mode, export buttons~~
- ~~JSON API for dashboard, LLM provider picker~~
- ~~13 PR review fixes (security, correctness, docs)~~

## Done (Phase 5) — Context System + Agent Integration

### Context Library
- **Context storage** — `~/.checkapp/contexts/` directory + `contexts` table in SQLite
- **Context types**: tone-guide, legal-policy, brief, style-guide, custom
- **Upload flows**: dashboard Contexts page (upload/paste/link), CLI `checkapp context add <type> <file>`
- **Update flows**: edit in dashboard, CLI `checkapp context update <type> <file>`, version history
- **Auto-use in skills**: tone skill reads tone-guide, legal reads legal-policy, new brief skill reads brief
- **Override per run**: `checkapp ./article.md --brief ./campaign-brief.md`
- **Dashboard page**: browse contexts, preview content, upload new, edit inline, delete

### Agent Integration
- **MCP server** — expose as MCP tools: `check_article`, `list_reports`, `search_reports`, `upload_context`, `get_skills`. Local agents (Claude Code, Cursor) call tools directly, no HTTP
- **AGENTS.md** — document how agents interact: MCP tools, CLI commands, context management
- **OpenClaw skill** — `checkapp` as an OpenClaw skill with full CLI access
- **CLI JSON output** — `checkapp --json ./article.md` returns structured JSON for piping
- **CI/CD mode** — `checkapp --ci ./article.md` exits 1 on fail, for PR gates

### Brief Matching Skill
- **New skill**: upload a content brief (target word count, required topics, key messages, audience)
- **Check**: article scored against brief requirements (coverage, length, message alignment)
- **Uses context system**: reads from `brief` context type

## Done (Phase 6A) — Multi-Provider + Intelligence
- ~~OpenRouter integration — one key for 200+ models, unified LlmClient.call() interface~~
- ~~Multi-language — auto-detects English, Hebrew, Arabic, Chinese, Japanese, Korean; language-specific SEO~~
- ~~Tone improvement suggestions — rewrite suggestions in brand voice alongside violation flags~~
- ~~Citation recommendations — verified claims include markdown citation links to source URLs~~

## Done (Phase 6B) — Content Purpose + Regenerate/Fix
- ~~Content purpose detection — classifies article type with purpose-specific recommendations~~
- ~~Regenerate/fix engine — `--fix` flag generates AI-suggested rewrites for flagged sentences~~
- ~~Dashboard Fix Issues panel — report detail shows CLI command when issues found~~
- ~~MCP `regenerate_article` tool — agents can trigger regeneration~~
- ~~9 skills total: plagiarism, AI detection, SEO, fact-check, tone, legal, summary, brief, purpose~~

## Phase 6C — Multi-Provider + Intelligence (remaining)

- **Model comparison** — run same article through multiple providers, compare scores side by side
- **PDF/DOCX input** — parse uploaded documents beyond .md/.txt

## Phase 9 — Platform & Scale (deferred)

- **API auth** — bearer token generation in Settings, required for remote API access
- **Vercel deployment** — cloud mode with auth, users, teams, permissions
- **Team dashboard** — multi-user, per-writer stats, trends over time
- **User-configurable skills** — write a skill prompt in dashboard, saved as custom skill
- **Skill marketplace** — browse community-built skills, install with one click
- **CMS integrations** — WordPress plugin, Ghost webhook, Webflow
- **Private index** — register published articles so Copyscape excludes them
