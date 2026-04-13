# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability, please **do not** open a public GitHub issue.

Instead, open a [GitHub issue](https://github.com/sharonds/article-checker/issues) with the title prefix `[security]` — this flags it for private review.

I'll respond within 48 hours and aim to release a fix within 7 days for confirmed vulnerabilities.

## What This Tool Does (and Doesn't Do)

- **Article text** is sent to the Copyscape API over HTTPS for plagiarism checking. This is the core purpose of the tool. Review [Copyscape's privacy policy](https://www.copyscape.com/privacy.php) if your content is sensitive before use.
- **Credentials** are stored locally at `~/.article-checker/config.json`. They are only sent to `www.copyscape.com` over HTTPS.
- **No other outbound requests.** The only network calls are to `docs.google.com` (doc fetch) and `www.copyscape.com` (API).
- **No telemetry, no analytics, no logging** to any external service.
