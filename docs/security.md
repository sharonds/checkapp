# Security

## BYOK alpha scope

CheckApp is Bring-Your-Own-Key: API tokens for Exa, MiniMax, Anthropic, OpenRouter, Cloudflare Vectorize, etc. live in **your** infrastructure. CheckApp never relays them.

**At-rest storage:** keys are written to `~/.checkapp/config.json` in plaintext. Protect the file:

    chmod 600 ~/.checkapp/config.json

**Dashboard binding:** the dashboard is designed for localhost-only use. Do not put it behind a public reverse proxy. All mutation routes (`/api/config`, `/api/skills`, `/api/contexts/*`, `/api/checks`, `/api/checks/[id]/tags`, `/api/providers`, `/api/estimate`) enforce a loopback check via `req.nextUrl.hostname` and require a CSRF token. The check is performed at the Next.js middleware level, not via Host header inspection. Binding the dashboard to a non-loopback interface is unsupported in v1.3.0.

**Roadmap to full BYOK:**
- OS keychain integration (macOS Keychain / Windows Credential Manager / libsecret)
- CSRF token rotation command
- Optional at-rest encryption via age/OpenSSL

## CSRF

Dashboard mutations require the `X-CheckApp-CSRF` header matching `~/.checkapp/csrf.token` (created on first dashboard start, 32 hex bytes, 0600 perms). The root layout injects the token as `<meta name="checkapp-csrf">` so client components can read it.

## Reporting vulnerabilities

Email `sharon.spirit@gmail.com` or use the repo's SECURITY.md channel.
