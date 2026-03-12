# YouTube Transcript Download Service — Design Spec

**Date:** 2026-03-12
**Status:** Draft

---

## Overview

A stateless HTTP API server that accepts a YouTube URL and returns the video's transcript as a downloadable Markdown file. The service is designed to run in a Docker container.

---

## Stack

- **Runtime:** Node.js 20
- **HTTP Framework:** Fastify (default logger enabled, JSON format)
- **Transcript Fetching:** `youtube-transcript` npm package (scrapes YouTube's internal transcript API, no API key required)
- **Video title:** YouTube oEmbed API (`https://www.youtube.com/oembed?url=...&format=json`) — no API key required
- **Containerisation:** Docker (`node:20-alpine` base image)
- **Module format:** ESM (`"type": "module"` in `package.json`) — required because `youtube-transcript` ships as a pure ES module and cannot be `require()`d from CommonJS
- **No caching, no database** — every request fetches fresh from YouTube

> **Note on scraper reliability:** `youtube-transcript` relies on YouTube's internal API shape, which can change without notice. This is an accepted trade-off for the simplicity of no API key. The package version is pinned via `package-lock.json`. If the package breaks due to a YouTube-side change, re-evaluating the fetching strategy is out of scope for this version.

---

## API Surface

### `POST /transcript`

Fetches the transcript for the given YouTube URL and returns it as a Markdown file.

**Request:**
```
POST /transcript
Content-Type: application/json

{ "url": "https://www.youtube.com/watch?v=<id>" }
```

Accepted URL forms (validated by the route handler before calling `fetchTranscript`):
- `https://www.youtube.com/watch?v=<id>`
- `https://youtu.be/<id>`
- `https://www.youtube.com/embed/<id>`
- `https://www.youtube.com/v/<id>`

Bare 11-character video IDs are **not** accepted at the HTTP layer.

**Success Response:**
```
200 OK
Content-Type: text/markdown
Content-Disposition: attachment; filename="<video-id>.md"

<markdown transcript>
```

The `videoId` used in the filename is extracted from the URL by the route handler using URL-aware parsing — not a bare string regex (which would incorrectly match playlist IDs that appear before `v=` in query strings):

- For `youtube.com/watch?v=<id>` URLs: `new URL(url).searchParams.get('v')`
- For `youtu.be/<id>`, `embed/<id>`, `v/<id>` forms: extract the last path segment

The extracted ID must match `/^[A-Za-z0-9_-]{11}$/` before use; if it does not, return `400`. The filename value is double-quoted per RFC 6266. No percent-encoding is needed since only `[A-Za-z0-9_-]` characters are used.

**Error Responses:**

| Status | Condition | Response body |
|--------|-----------|---------------|
| `400 Bad Request` | `url` missing or does not match a recognised YouTube URL form | `{ "statusCode": 400, "error": "Bad Request", "message": "<reason>" }` |
| `404 Not Found` | Video exists but has no transcript | `{ "statusCode": 404, "error": "Not Found", "message": "No transcript available for this video" }` |
| `422 Unprocessable Entity` | Video is unavailable (private or deleted — library does not distinguish) | `{ "statusCode": 422, "error": "Unprocessable Entity", "message": "Video is unavailable" }` |
| `503 Service Unavailable` | YouTube returned a CAPTCHA/rate-limit challenge | `{ "statusCode": 503, "error": "Service Unavailable", "message": "YouTube is currently unavailable. Try again later." }` |
| `408 Request Timeout` | Fetch did not complete within 10 seconds | `{ "statusCode": 408, "error": "Request Timeout", "message": "Transcript fetch timed out" }` |
| `500 Internal Server Error` | Unexpected failure | `{ "statusCode": 500, "error": "Internal Server Error", "message": "An unexpected error occurred" }` |

> **Note on 503 vs 429:** YouTube's CAPTCHA block is not a standard HTTP rate-limit response — it is a page substitution. `503 Service Unavailable` more accurately reflects the situation than `429 Too Many Requests`, which implies a `Retry-After` header contract.

---

### `GET /health`

Liveness/readiness probe for container orchestration.

**Response:**
```
200 OK
Content-Type: application/json

{ "status": "ok" }
```

---

## Markdown Output Format

```markdown
# <Video Title>

**Video ID:** <id>
**URL:** <original url>
**Fetched at:** <ISO 8601 timestamp>

---

<transcript body>
```

**Obtaining the video title:**
The `youtube-transcript` package does not return the video title. The title is fetched separately via the YouTube oEmbed API:
```
GET https://www.youtube.com/oembed?url=<encoded-url>&format=json
```
The oEmbed fetch runs **in parallel** with the transcript fetch, both within the 10-second global timeout window. If the oEmbed call fails for any reason, the failure is logged (not silently swallowed) and the title falls back to the video ID.

**Transcript body formatting:**

A "segment" is a single entry in the array returned by `youtube-transcript` — each entry has `{ text, duration, offset }`.

- HTML entities in segment `text` (e.g. `&amp;`, `&quot;`, `&#39;`) are decoded to their plain-text equivalents before output
- Timestamps (`offset`, `duration`) are stripped — only the decoded text is used
- Consecutive segment texts are joined with a single space
- A blank line (`\n\n`) is inserted after every 10 raw array entries to create readable paragraphs
- No speaker labels or other metadata are added

**Default language:**
The library selects `captionTracks[0]` — the first available caption track. For multi-language videos this is non-deterministic. Consumers should expect whichever language YouTube lists first.

---

## `transcript.js` Module Interface

`src/transcript.js` exports a single async function. The route handler extracts and validates the `videoId` from the URL, then passes it (plus the original URL) to `fetchTranscript`. `transcript.js` does **not** re-validate inputs — it trusts the route handler.

```js
/**
 * @param {string} videoId - The validated 11-character YouTube video ID (extracted by the route handler)
 * @param {string} originalUrl - The original URL (used only for the markdown metadata header)
 * @returns {Promise<{ videoId: string, title: string, markdown: string }>}
 *   videoId: echoed back from input
 *   title:   video title from oEmbed, or videoId as fallback
 *   markdown: fully formatted markdown string ready to send as response body
 * @throws {TranscriptError} with a `code` string property:
 *   'NOT_FOUND'    - no transcript available (captions disabled or no tracks)
 *   'UNAVAILABLE'  - video is private or deleted
 *   'RATE_LIMITED' - YouTube returned a CAPTCHA/block page
 *   'TIMEOUT'      - both fetches did not complete within 10 seconds
 *   'UNKNOWN'      - any other error
 */
export async function fetchTranscript(videoId, originalUrl) { ... }
```

The route handler extracts the `videoId` from the URL and passes it (not the full URL) to the library's `YoutubeTranscript.fetchTranscript(videoId)`. The `originalUrl` parameter is passed separately so the markdown metadata header can include it.

**Timeout scope:** The 10-second `Promise.race` timer covers both the oEmbed fetch and the library's `YoutubeTranscript.fetchTranscript(videoId)` call together. If either hangs and the wall clock expires, a `TIMEOUT` error is thrown.

**Known limitation:** `Promise.race` does not abort the underlying HTTP requests inside the library. In-flight fetches will complete in the background after the timeout. This is accepted for this version.

---

## Project Structure

```
my-ytd/
├── src/
│   ├── server.js          # Creates Fastify instance, registers routes, handles PORT/HOST env vars, SIGTERM shutdown
│   ├── routes/
│   │   ├── transcript.js  # POST /transcript — validates URL, extracts videoId, calls fetchTranscript, sets Content-Disposition, sends markdown
│   │   └── health.js      # GET /health — returns { status: "ok" }
│   └── transcript.js      # fetchTranscript(url): parallel oEmbed + transcript fetches, entity decode, markdown format
├── Dockerfile
├── .dockerignore
└── package.json
```

---

## `package.json` Required Fields

```json
{
  "name": "my-ytd",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "start": "node src/server.js"
  },
  "engines": {
    "node": ">=20"
  },
  "dependencies": {
    "fastify": "...",
    "youtube-transcript": "..."
  }
}
```

`"type": "module"` is required — `youtube-transcript` ships as a pure ES module and cannot be loaded via `require()`. All source files use `import`/`export` syntax. `devDependencies` may be added at implementer discretion.

---

## Docker

**Dockerfile behaviour:**
- Base image: `node:20-alpine`
- Installs production dependencies only (`npm ci --omit=dev`)
- Runs as non-root user (`node`)
- Exposes port `3000`
- Entry point: `node src/server.js` (aligns with the `start` script)

**`.dockerignore`:**
```
node_modules/
.git/
docs/
*.md
.env
.env.*
test/
*.test.js
.vscode/
.DS_Store
```

**Environment variables:**

| Variable | Default   | Description |
|----------|-----------|-------------|
| `PORT`   | `3000`    | Port the server listens on. Must be a valid integer in range 1–65535. Non-numeric or out-of-range values cause the server to exit with a clear error message on startup. |
| `HOST`   | `0.0.0.0` | Host binding. Must be `0.0.0.0` inside Docker to accept external connections. Applies equally when running locally. |

**Example run:**
```bash
docker build -t my-ytd .
docker run -p 3000:3000 my-ytd
```

---

## Startup & Graceful Shutdown

- `PORT` and `HOST` are read and validated before Fastify starts
- On startup, Fastify binds to `HOST:PORT` and logs the bound address (JSON log line via default Fastify logger)
- On `SIGTERM` (sent by `docker stop`), the server calls `fastify.close()` to drain in-flight requests, then exits with code `0`
- The `/health` endpoint serves as the liveness and readiness probe

---

## Error Handling

1. Route handler validates `url` against accepted forms; returns `400` immediately if invalid
2. Route handler extracts the video ID using URL-aware parsing (see API Surface section); validates result against `/^[A-Za-z0-9_-]{11}$/`; returns `400` if invalid
3. Route handler calls `fetchTranscript(videoId, url)` and catches `TranscriptError`, mapping `code` to HTTP status:

   | `code` | HTTP status |
   |--------|-------------|
   | `NOT_FOUND` | 404 |
   | `UNAVAILABLE` | 422 |
   | `RATE_LIMITED` | 503 |
   | `TIMEOUT` | 408 |
   | `UNKNOWN` | 500 |

4. Inside `fetchTranscript`, library error classes map to `TranscriptError` codes:
   - `YoutubeTranscriptVideoUnavailableError` → `UNAVAILABLE`
   - `YoutubeTranscriptDisabledError` → `NOT_FOUND`
   - `YoutubeTranscriptNotAvailableError` → `NOT_FOUND`
   - `YoutubeTranscriptTooManyRequestError` → `RATE_LIMITED`
   - `YoutubeTranscriptNotAvailableLanguageError` → `NOT_FOUND` *(currently unreachable — language selection is out of scope — included for completeness)*
   - Timeout → `TIMEOUT`
   - All others → `UNKNOWN`

5. Fastify's built-in error serialisation produces the JSON error body format shown in the API Surface table

---

## Out of Scope

- Authentication / API keys
- Caching or persistence
- Language selection (uses YouTube's default — first available caption track)
- Rate limiting
- Fallback transcript fetching strategy if `youtube-transcript` breaks
- Automated tests
