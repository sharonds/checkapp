# Agent Integration Guide

Checkit can be used by AI agents via MCP tools or CLI commands.

## MCP Server (Claude Code, Cursor, Windsurf)

Start the MCP server:

    checkit --mcp

Or add to your MCP config (e.g., `.claude/settings.json`):

    {
      "mcpServers": {
        "checkit": {
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
| `get_report` | Get full report by ID | `id` |
| `upload_context` | Save a tone guide, brief, or legal policy | `type`, `content` |
| `list_contexts` | View saved context documents | - |
| `get_skills` | See which skills are enabled | - |
| `toggle_skill` | Enable/disable a skill | `skillId`, `enabled` |
| `regenerate_article` | Get AI-suggested rewrites for flagged sentences | `text` |

### Example: Check an article from Claude Code

    Use the check_article tool with:
    - text: "Your article content here..."
    - source: "my-article.md"

### Example: Upload a tone guide

    Use the upload_context tool with:
    - type: "tone-guide"
    - name: "Brand Voice"
    - content: "Write in second person. Be warm and conversational..."

## CLI Commands (scripts, CI/CD, OpenClaw)

    # Check an article (with Ink UI)
    checkit ./article.md

    # Headless check with JSON output
    checkit --json ./article.md

    # CI mode — exits 1 if any skill fails
    checkit --ci ./article.md

    # Batch check a directory
    checkit --batch ./articles/

    # Fix flagged sentences with AI-suggested rewrites
    checkit --fix ./article.md

    # Export report
    checkit --output report.md ./article.md

    # Manage contexts
    checkit context add tone-guide ./brand-voice.md
    checkit context add legal-policy ./legal-requirements.md
    checkit context add brief ./campaign-brief.md
    checkit context list
    checkit context show tone-guide
    checkit context remove brief

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
| `MINIMAX_API_KEY` | No | MiniMax LLM (preferred, cheapest) |
| `ANTHROPIC_API_KEY` | No | Anthropic Claude LLM (fallback) |
| `OPENROUTER_API_KEY` | No | OpenRouter — one key for 200+ models |
| `LLM_PROVIDER` | No | `minimax` (default), `anthropic`, or `openrouter` |
| `PARALLEL_API_KEY` | No | Parallel AI for passage evidence |
| `TONE_GUIDE_FILE` | No | Path to brand voice `.md` file |

## Data Storage

All data is local:
- Check history: `~/.checkit/history.db` (SQLite)
- Config: `~/.checkit/config.json`
- Contexts: stored in the SQLite database

No remote servers. No authentication needed for local use.
