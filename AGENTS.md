# Agent Integration Guide

CheckApp can be used by AI agents via MCP tools or CLI commands.

## MCP Server (Claude Code, Cursor, Windsurf)

Start the MCP server:

    checkapp --mcp

Or add to your MCP config (e.g., `.claude/settings.json`):

    {
      "mcpServers": {
        "checkapp": {
          "command": "bun",
          "args": ["run", "src/index.tsx", "--mcp"]
        }
      }
    }

### Available MCP tools

| Tool | Description | Required params |
|------|-------------|----------------|
| `check_article` | Run quality checks on article text | `text` |
| `list_reports` | Browse check history | - |
| `get_report` | Get full report details by ID, excluding raw article text | `id` |
| `upload_context` | Save a tone guide, brief, or legal policy | `type`, `content` |
| `list_contexts` | View saved context documents | - |
| `get_skills` | See which skills are enabled | - |
| `toggle_skill` | Enable/disable a skill | `skillId`, `enabled` |
| `regenerate_article` | Get AI-suggested rewrites for flagged sentences | `text` |
| `deep_audit_article` | Start or reuse an async deep fact-check audit | exactly one of `checkId` or `article` |
| `get_deep_audit_result` | Fetch the current result for a deep audit interaction | `interactionId` |

### Example: Check an article from Claude Code

    Use the check_article tool with:
    - text: "Your article content here..."
    - source: "my-article.md"

### Example: Upload a tone guide

    Use the upload_context tool with:
    - type: "tone-guide"
    - name: "Brand Voice"
    - content: "Write in second person. Be warm and conversational..."

### Example: Start a deep audit from a saved report

    Use the deep_audit_article tool with:
    - checkId: 42

### Example: Start a deep audit from raw article text

    Use the deep_audit_article tool with:
    - article: "Your full article text here..."

### Example: Poll for deep audit completion

    Use the get_deep_audit_result tool with:
    - interactionId: "int_abc123"

### Fact-check tiers

Basic is the default fact-check tier. Standard is opt-in and only used when `factCheckTierFlag=true` and `factCheckTier="standard"` are present in config. Basic and Standard sync checks default to up to 4 checked claims per article for predictable cost; `factAudit.standardMaxClaims` and provider-call budgets can change coverage, and structured audit coverage reports budget stop reasons such as `claim_cap`. Deep Audit is async; start it with `deep_audit_article` and poll with `get_deep_audit_result`.

### Structured audit field

`check_article` and `get_report` may include an optional `audit` object when a check path produces structured audit data. Existing agents should continue to read `results`; `audit` is additive and may be absent. Fact-check and plagiarism audits include document quote locations, language/direction metadata, evidence, confidence rationale, grounding mode for Gemini plagiarism matches, provider attempts, and suggested rewrites. Public MCP/API audit payloads preserve segment metadata for locations but redact `segments[].text`; finding quotes may still include the specific flagged article excerpts needed to explain a problem. HTML reports and dashboard audit drilldowns localize CheckApp-owned labels for English/Hebrew from this metadata, but agents should not assume provider names, URLs, source titles, model-generated text, or quoted article text have been translated. `list_reports` returns redacted report summaries and must not be treated as a source for full audit quotes, evidence snippets, provider/model metadata, search queries, provider attempts, `segments[].text`, or article text. `get_report` returns detail data for the selected report but still omits the raw persisted `articleText` field.

The structured audit contract is versioned with `audit.version`. Additive fields may appear in version 1 and should be ignored by consumers that do not understand them. Unknown future versions should be ignored unless the agent explicitly supports them.

## CLI Commands (scripts, CI/CD, OpenClaw)

    # Check an article (with Ink UI)
    checkapp ./article.md

    # Headless check with JSON output
    checkapp --json ./article.md

    # CI mode — exits 1 if any skill fails
    checkapp --ci ./article.md

    # Batch check a directory
    checkapp --batch ./articles/

    # Fix flagged sentences with AI-suggested rewrites
    checkapp --fix ./article.md

    # Export report
    checkapp --output report.md ./article.md

    # Manage contexts
    checkapp context add tone-guide ./brand-voice.md
    checkapp context add legal-policy ./legal-requirements.md
    checkapp context add brief ./campaign-brief.md
    checkapp context list
    checkapp context show tone-guide
    checkapp context remove brief

## Context Types

| Type | Used by skill | Purpose |
|------|--------------|---------|
| `tone-guide` | Tone of Voice | Brand voice rules |
| `legal-policy` | Legal Risk | Company legal requirements |
| `brief` | Brief Matching | Content brief with requirements |
| `style-guide` | SEO + Tone | Writing style rules |
| `custom` | Custom skills | Any additional context |

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `COPYSCAPE_USER` | Yes | Copyscape username |
| `COPYSCAPE_KEY` | Yes | Copyscape API key |
| `EXA_API_KEY` | No | Exa AI for fact-check evidence search |
| `GEMINI_API_KEY` | No | Gemini API key for Standard and Deep Audit fact-check tiers |
| `MINIMAX_API_KEY` | No | MiniMax LLM (preferred, cheapest) |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude LLM (fallback) |
| `OPENROUTER_API_KEY` | No | OpenRouter — one key for 200+ models |
| `LLM_PROVIDER` | No | `minimax` (default), `anthropic`, or `openrouter` |
| `PARALLEL_API_KEY` | No | Parallel AI for passage evidence |
| `TONE_GUIDE_FILE` | No | Path to brand voice `.md` file |

## Data Storage

All data is local:
- Check history: `~/.checkapp/history.db` (SQLite)
- Config: `~/.checkapp/config.json`
- Contexts: stored in the SQLite database
- Optional structured audit data: stored locally with check history when present

No remote servers. No authentication needed for local use.

Configured providers may receive article text, claims, passages, search queries, source URLs, and evidence snippets as part of checks. Provider retention is governed by each provider's terms.
