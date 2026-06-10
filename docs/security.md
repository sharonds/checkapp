# Security

## BYOK alpha scope

CheckApp is Bring-Your-Own-Key: API tokens for Copyscape, Gemini, Exa, MiniMax, Anthropic, OpenRouter, Parallel, Cloudflare Vectorize, and similar providers are stored in the local user config or supplied through environment variables. CheckApp does not operate a hosted backend for user content or credentials.

**At-rest storage:** keys are written to `~/.checkapp/config.json` in plaintext. CheckApp creates/chmods the config directory as owner-only (`0700`) and the config file as owner-only (`0600`) where POSIX file modes are supported. Protect the file:

    chmod 600 ~/.checkapp/config.json

**Dashboard binding:** the dashboard is designed for localhost-only use and dashboard scripts bind to `127.0.0.1`. Do not put it behind a public reverse proxy. The Next proxy guard and route handlers reject non-loopback hosts/origins. Forwarded headers such as `Forwarded`, `X-Forwarded-Host`, and `X-Forwarded-For` can deny a request but cannot make a remote request trusted. Mutation routes (`/api/config`, `/api/skills`, `/api/contexts/*`, `/api/checks`, `/api/checks/[id]/tags`, `/api/providers`, `/api/reports/[id]/deep-audit`) enforce `guardLocalMutation`, require a CSRF token, and reject browser-simple form content types. Read-only routes enforce loopback access with read-only route guards but do not use the mutation CSRF guard. Binding the dashboard to a non-loopback interface is unsupported.

**Roadmap to full BYOK:**
- OS keychain integration (macOS Keychain / Windows Credential Manager / libsecret)
- CSRF token rotation command
- Optional at-rest encryption via age/OpenSSL

## CSRF

Dashboard mutations require the `X-CheckApp-CSRF` header matching `~/.checkapp/csrf.token` (created on first dashboard start, 32 hex bytes, 0600 perms). The root layout injects the token as `<meta name="checkapp-csrf">` so client components can read it.

## Structured audit data

When structured audit data is present, CheckApp stores it locally in SQLite beside the check history. CheckApp creates/chmods the history DB as owner-only (`0600`) where POSIX file modes are supported. Audit data may include article quotes, claim text, evidence URLs, evidence snippets, provider attempt metadata, and sanitized provider error messages.

List and search APIs must not return full audit records, raw `audit_json`, raw `results_json`, or full result findings because findings may now contain article quotes, source snippets, provider/model metadata, and search queries. Detail APIs may return parsed `audit` and full `results` for the requested check. MCP `list_reports` follows the same redacted-summary contract. MCP `get_report` returns detail data for one report but omits the raw persisted article text.

Configured external providers may receive article text, claims, passages, search queries, source URLs, and evidence snippets. Provider retention, training, and logging behavior are governed by the configured provider's terms.

Required automated tests must use fake providers. Live provider smoke tests are opt-in and must be skipped when credentials are absent.

Provider errors are sanitized before persistence or rendering. API keys, bearer tokens, key-like query parameters, and unsafe URLs must not appear in reports, logs, JSON exports, or snapshots.

Report localization does not translate or rewrite untrusted provider/source content. CheckApp localizes only its own labels; external provider names, URLs, titles, source snippets, and article quotes are escaped/sanitized and rendered in their original text.

## Reporting vulnerabilities

Email `sharon.spirit@gmail.com` or use the repo's SECURITY.md channel.
