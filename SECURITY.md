# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public GitHub issue.

Instead, please report it privately via [GitHub Security Advisories](https://github.com/sharonds/checkapp/security/advisories/new).

I'll respond within 48 hours and aim to release a fix within 7 days for confirmed vulnerabilities.

## Outbound network requests

CheckApp's CLI and dashboard send article text and metadata to the following
third-party services when you explicitly enable and configure them. All are
BYOK (you supply the API key). CheckApp does not proxy or log these calls.
Config and history files are created with owner-only permissions where POSIX
file modes are supported.

| Service | Purpose | Data sent | Key env var |
|---|---|---|---|
| Google Docs | Fetch public document text | Public document ID | none |
| Copyscape | Plagiarism + AI detection | Article text | COPYSCAPE_KEY |
| Exa AI | Fact-check source retrieval | Claims extracted from article | EXA_API_KEY |
| Gemini | Grounded fact-check, grounded plagiarism, AI detection, Deep Audit | Article text, claims, passages, search/evidence context | GEMINI_API_KEY |
| Parallel AI | Passage evidence/source fetching | Source URLs and related passages | PARALLEL_API_KEY |
| LanguageTool (managed) | Grammar/style | Article text (chunks < 20KB) | LANGUAGETOOL_API_KEY (optional) |
| OpenAlex | Academic citations (default) | Query terms and optional configured mailto | OPENALEX_MAILTO (optional) |
| Semantic Scholar | Academic citations (legacy; only via explicit `providers.academic` config) | Query terms | none |
| Cloudflare Vectorize | Self-plagiarism embeddings | Article text + embeddings | CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN |
| OpenRouter | LLM fallback / tone / summary | Article excerpts | OPENROUTER_API_KEY |
| Anthropic | LLM fallback / tone / summary | Article excerpts | ANTHROPIC_API_KEY |
| MiniMax | LLM fallback / tone / summary | Article excerpts | MINIMAX_API_KEY |

Skills are opt-in. Disabling a skill or leaving its API key unset prevents
CheckApp from calling that configured service path.

## Dashboard network posture

The dashboard is **local-only by default** and dashboard scripts bind to
`127.0.0.1`. The Next proxy guard and route handlers reject
non-loopback hosts/origins, and forwarded headers can deny a request but cannot
make a remote request trusted. Mutation routes such as `/api/providers`,
`/api/config`, `/api/skills`, `/api/contexts`, `/api/checks`,
`/api/checks/[id]/tags`, and `/api/reports/[id]/deep-audit` require CSRF.
Read-only routes are loopback-guarded. Binding the dashboard to a non-loopback
interface is unsupported.

## MCP error sanitization

All MCP tool errors return sanitized messages. Credentials are redacted by
pattern (Bearer tokens, `key=`/`token=` query parameters, Gemini `AIza…` keys,
and common `sk-`-style key formats) at the MCP dispatch layer before the error
text is returned to the calling agent. Credentials in formats outside these
patterns are not detected.
