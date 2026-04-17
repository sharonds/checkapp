# CheckApp — Dashboard API Reference

The web dashboard exposes a JSON API at `http://localhost:3000/api` when running locally. All endpoints return JSON with CORS headers enabled.

---

## POST /api/checks

Run a new content quality check.

**Request body:**

```json
{
  "text": "Your article content here...",
  "source": "my-article.md",
  "tags": ["blog", "q2"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `text` | string | yes | Article content. Maximum 50,000 characters. |
| `source` | string | no | Label for the check (filename or URL). |
| `tags` | string[] | no | Tags to attach to the check. |

**Response (201):**

```json
{ "id": 42 }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/checks \
  -H "Content-Type: application/json" \
  -d '{"text": "Vitamin D is essential for bone health...", "source": "health-article.md", "tags": ["health"]}'
```

---

## GET /api/checks

List recent checks.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | Max checks to return (capped at 200). |

**Response (200):**

```json
[
  {
    "id": 42,
    "source": "health-article.md",
    "wordCount": 810,
    "totalCost": 0.18,
    "createdAt": "2026-04-15T10:30:00Z",
    "results": [
      { "skillId": "plagiarism", "name": "Plagiarism Check", "score": 92, "verdict": "pass", "summary": "8% similarity", "findings": [], "costUsd": 0.09 }
    ]
  }
]
```

**Example:**

```bash
curl "http://localhost:3000/api/checks?limit=10"
```

---

## GET /api/checks/:id

Get a single check with full results and tags.

**Response (200):**

```json
{
  "id": 42,
  "source": "health-article.md",
  "wordCount": 810,
  "totalCost": 0.18,
  "createdAt": "2026-04-15T10:30:00Z",
  "results": [ ... ],
  "tags": ["health", "q2"]
}
```

**Response (404):**

```json
{ "error": "Not found" }
```

**Example:**

```bash
curl http://localhost:3000/api/checks/42
```

---

## POST /api/checks/:id/tags

Add tags to an existing check.

**Request body:**

```json
{ "tags": ["blog", "q2"] }
```

**Response (200):**

```json
{ "tags": ["blog", "q2", "health"] }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/checks/42/tags \
  -H "Content-Type: application/json" \
  -d '{"tags": ["blog", "q2"]}'
```

---

## GET /api/search

Search checks by text query and/or tag.

| Param | Type | Description |
|-------|------|-------------|
| `q` | string | Free-text search by source name. Searching within results content is planned for a future release. |
| `tag` | string | Filter by tag name. |

**Response (200):** Same shape as `GET /api/checks`.

**Example:**

```bash
curl "http://localhost:3000/api/search?q=vitamin&tag=blog"
```

---

## GET /api/tags

List all tags with usage counts.

**Response (200):**

```json
[
  { "tag": "blog", "count": 12 },
  { "tag": "health", "count": 5 }
]
```

**Example:**

```bash
curl http://localhost:3000/api/tags
```

---

## GET /api/config

Get current configuration. API keys are masked (only last 4 characters shown).

**Response (200):**

```json
{
  "config": {
    "copyscapeUser": "user@example.com",
    "copyscapeKey": "****abcd",
    "skills": { "plagiarism": true, "seo": true }
  },
  "apiKeys": {
    "copyscape": true,
    "exa": false,
    "minimax": true,
    "anthropic": false
  }
}
```

**Example:**

```bash
curl http://localhost:3000/api/config
```

---

## PATCH /api/config

Update configuration fields. Partial updates are supported.

**Request body:**

```json
{
  "skills": { "factCheck": true },
  "thresholds": { "seo": { "pass": 80, "warn": 60 } }
}
```

**Response (200):**

```json
{ "ok": true }
```

**Example:**

```bash
curl -X PATCH http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -d '{"skills": {"factCheck": true}}'
```

---

## GET /api/skills

List all skills with their enabled state, engine, and API key status.

**Response (200):**

```json
[
  {
    "id": "plagiarism",
    "name": "Plagiarism Check",
    "engine": "Copyscape",
    "requiresKeys": ["copyscape"],
    "enabled": true,
    "keysConfigured": true
  },
  {
    "id": "seo",
    "name": "SEO Analysis",
    "engine": "Offline",
    "requiresKeys": [],
    "enabled": true,
    "keysConfigured": true
  }
]
```

**Example:**

```bash
curl http://localhost:3000/api/skills
```

---

## POST /api/skills

Toggle a skill on or off.

**Request body:**

```json
{ "skillId": "factCheck", "enabled": true }
```

**Response (200):**

```json
{ "ok": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -d '{"skillId": "factCheck", "enabled": true}'
```

---

## POST /api/contexts

Create or update a context document (tone guide, brief, legal policy, etc.).

**Request body:**

```json
{
  "type": "tone-guide",
  "name": "Brand Voice",
  "content": "Write in second person. Be warm and conversational..."
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | yes | Context type: `tone-guide`, `brief`, `legal-policy`, `style-guide`, or `custom`. |
| `name` | string | no | Display name for the context. |
| `content` | string | yes | The context document content (Markdown or plain text). |

**Response (200):**

```json
{ "ok": true }
```

**Example:**

```bash
curl -X POST http://localhost:3000/api/contexts \
  -H "Content-Type: application/json" \
  -d '{"type": "tone-guide", "name": "Brand Voice", "content": "Write in second person..."}'
```

---

## GET /api/contexts

List all stored contexts.

**Response (200):**

```json
[
  {
    "type": "tone-guide",
    "name": "Brand Voice",
    "content": "Write in second person...",
    "updatedAt": "2026-04-15T10:30:00Z"
  }
]
```

**Example:**

```bash
curl http://localhost:3000/api/contexts
```

---

## GET /api/contexts/:type

Get a single context by type.

**Response (200):**

```json
{
  "type": "tone-guide",
  "name": "Brand Voice",
  "content": "Write in second person...",
  "updatedAt": "2026-04-15T10:30:00Z"
}
```

**Response (404):**

```json
{ "error": "Not found" }
```

**Example:**

```bash
curl http://localhost:3000/api/contexts/tone-guide
```

---

## DELETE /api/contexts/:type

Remove a context document.

**Response (200):**

```json
{ "ok": true }
```

**Response (404):**

```json
{ "error": "Not found" }
```

**Example:**

```bash
curl -X DELETE http://localhost:3000/api/contexts/brief
```

---

## Error Responses

All endpoints return errors in this format:

```json
{ "error": "Description of what went wrong" }
```

Common status codes:

| Code | Meaning |
|------|---------|
| 400 | Bad request (missing required field, text too long) |
| 404 | Check not found |
| 500 | Internal server error |

---

## Finding (Phase 7+)

Each `SkillResult.findings[]` entry has the following shape. All Phase 7 fields are optional and strictly additive — pre-Phase-7 reports round-trip unchanged.

```ts
interface Finding {
  severity: "info" | "warn" | "error";
  text: string;
  quote?: string;
  // Phase 7 additions — all optional, strictly additive:
  sources?: Array<{ url: string; title?: string; publishedDate?: string; quote?: string; relevanceScore?: number }>;
  rewrite?: string;
  citations?: Array<{ title: string; authors?: string[]; year?: number; doi?: string; url?: string; abstractSnippet?: string }>;
  claimType?: "scientific" | "medical" | "financial" | "general";
  confidence?: "high" | "medium" | "low";
}
```

**Four-output contract:** a single fact-check finding can carry `sources[]` (evidence), `rewrite` (correction from grammar), `citations[]` (academic papers), and `claimType` simultaneously. The orchestrator's `enrichFindings()` step merges citations from enricher skills onto matching fact-check findings. See `tests/e2e/phase7.test.ts` for the load-bearing assertion.

**MCP clients:** `check_article` returns `JSON.stringify(result)`. Parse with a schema that treats the Phase 7 fields as optional for back-compat with pre-Phase-7 report blobs. CheckApp ships `normalizeFinding()` (dashboard `src/lib/normalize-report.ts`) which coerces old blobs safely.
