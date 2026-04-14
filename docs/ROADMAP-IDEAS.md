# Article Checker — Roadmap Ideas

Ideas from Sharon, collected 2026-04-15. Prioritized by user impact.

## Phase 2+3 (executing now)
- Content Summary skill (topic, audience, tone)
- Legal suggestions ("Fix: replace with...")
- SEO keyword detection + first-paragraph check
- Custom skill authoring docs
- Batch checking (`--batch ./articles/`)
- Configurable thresholds per skill
- Fact-check confidence levels
- Full docs sync

## Phase 4 — Local Web Dashboard (`article-checker ui`)
- Single command, localhost, no login
- Dashboard: latest checks, pass/warn/fail counts, cost chart
- Reports: SQLite history table, click to view full HTML report
- Run Check: paste URL or upload file (.md, .txt, .pdf, .docx), live progress
- Skills: toggle on/off, see API key status, engine labels
- Settings: API keys, thresholds, tone guide path
- Stack: Next.js 16, shadcn/ui, Drizzle ORM, SQLite, Vitest (follow Jobot patterns)
- Deploy to Vercel (optional, local-first by default)

## Phase 5 — Smart Content Features
- **Brief matching** — upload a brief/requirements doc, skill checks article against it (word count, topic coverage, key messages)
- **Content purpose detection** — product announcement, user guide, thought leadership, listicle, tutorial, case study
- **Word count enforcement** — "this article should be 200 words" → warn if over/under
- **Multi-language support** — detect article language, adjust SEO rules (Hebrew RTL, different stop words)
- **Regenerate/fix** — AI rewrites flagged sentences based on all skill feedback
- **Model comparison** — run same article through multiple LLM providers, compare results side by side
- **PDF/DOCX input** — parse uploaded documents, not just .md/.txt and Google Docs

## Phase 6 — Team & Scale
- **User-configurable skills** — user writes a skill prompt in the dashboard, saved as a custom skill
- **Skill marketplace** — browse community-built skills, install with one click
- **Team dashboard** — multi-user, per-writer stats, trends over time
- **CMS integrations** — WordPress plugin, Ghost webhook, Webflow
- **CI/CD hook** — `article-checker --ci` returns exit code 1 if any skill fails (for PR gates)
- **Second AI detector** — Originality.ai cross-validation
- **Private index** — register your published articles so Copyscape excludes them
