# Security

## BYOK alpha scope

CheckApp is Bring-Your-Own-Key: API tokens for Exa, MiniMax, Anthropic, OpenRouter, Cloudflare Vectorize, etc. live in **your** infrastructure. CheckApp never relays them.

**At-rest storage:** keys are written to `~/.checkapp/config.json` in plaintext. Protect the file:

    chmod 600 ~/.checkapp/config.json

**Dashboard binding:** the dashboard is designed for localhost-only use. Do not put it behind a public reverse proxy. `/api/providers` PUT and `/api/estimate` reject non-localhost host headers, but at-rest encryption is out of scope for alpha.

**Roadmap to full BYOK:**
- OS keychain integration (macOS Keychain / Windows Credential Manager / libsecret)
- CSRF token rotation command
- Optional at-rest encryption via age/OpenSSL

## CSRF

Dashboard mutations require the `X-CheckApp-CSRF` header matching `~/.checkapp/csrf.token` (created on first dashboard start, 32 hex bytes, 0600 perms). The root layout injects the token as `<meta name="checkapp-csrf">` so client components can read it.

## Reporting vulnerabilities

Email `sharon.spirit@gmail.com` or use the repo's SECURITY.md channel.
