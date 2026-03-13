# YouTube Transcript Service Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Fastify HTTP server that accepts a YouTube URL and returns its transcript as a downloadable Markdown file, packaged in Docker.

**Architecture:** Three-layer structure — `src/transcript.js` handles all YouTube API calls and markdown formatting; `src/routes/transcript.js` handles HTTP concerns (URL validation, videoId extraction, response); `src/server.js` wires everything together and manages lifecycle. No persistence, no caching.

**Tech Stack:** Node.js 20, Fastify, `youtube-transcript` npm package, YouTube oEmbed API (native `fetch`), Docker (`node:20-alpine`)

**Spec:** `docs/superpowers/specs/2026-03-12-youtube-transcript-service-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `package.json` | ESM project config, dependencies, start script |
| `src/transcript.js` | `TranscriptError` class, `fetchTranscript(videoId, originalUrl)`, oEmbed fetch, entity decoding, markdown formatting |
| `src/routes/health.js` | `GET /health` route plugin |
| `src/routes/transcript.js` | `POST /transcript` route plugin — URL validation, videoId extraction, calls `fetchTranscript`, sets response headers |
| `src/server.js` | Fastify instance, PORT/HOST validation, route registration, SIGTERM handler |
| `Dockerfile` | Container image definition |
| `.dockerignore` | Files excluded from Docker build context |

---

## Chunk 1: Project Setup + Core Transcript Module

### Task 1: Initialise project

**Files:**
- Create: `package.json`

- [ ] **Step 1: Create `package.json`**

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
    "fastify": "^5.0.0",
    "youtube-transcript": "^1.2.1"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
npm install
```

Expected: `node_modules/` created, `package-lock.json` generated with pinned versions.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: initialise project with Fastify and youtube-transcript"
```

---

### Task 2: Implement `TranscriptError` and `fetchTranscript`

**Files:**
- Create: `src/transcript.js`

This module has three responsibilities:
1. Define `TranscriptError` — a typed error with a `code` string used by the route handler to map to HTTP statuses
2. Fetch the video title from YouTube oEmbed (in parallel with the transcript fetch)
3. Fetch transcript segments, decode HTML entities, format as markdown

- [ ] **Step 1: Create `src/` directory and `src/transcript.js`**

```bash
mkdir -p src/routes
```

- [ ] **Step 2: Write `src/transcript.js`**

```js
import {
  YoutubeTranscript,
  YoutubeTranscriptVideoUnavailableError,
  YoutubeTranscriptDisabledError,
  YoutubeTranscriptNotAvailableError,
  YoutubeTranscriptTooManyRequestError,
  YoutubeTranscriptNotAvailableLanguageError,
} from 'youtube-transcript';

const TIMEOUT_MS = 10_000;

export class TranscriptError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TranscriptError';
    this.code = code;
  }
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function formatMarkdown(videoId, originalUrl, title, segments) {
  const header = [
    `# ${title}`,
    '',
    `**Video ID:** ${videoId}`,
    `**URL:** ${originalUrl}`,
    `**Fetched at:** ${new Date().toISOString()}`,
    '',
    '---',
    '',
  ].join('\n');

  const paragraphs = [];
  for (let i = 0; i < segments.length; i += 10) {
    const chunk = segments.slice(i, i + 10);
    paragraphs.push(chunk.map((s) => decodeEntities(s.text)).join(' '));
  }

  return header + paragraphs.join('\n\n');
}

async function fetchTitle(originalUrl) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(originalUrl)}&format=json`;
  const res = await fetch(oembedUrl);
  if (!res.ok) throw new Error(`oEmbed returned ${res.status}`);
  const data = await res.json();
  return data.title;
}

function mapLibraryError(err) {
  if (err instanceof YoutubeTranscriptVideoUnavailableError)
    return new TranscriptError('Video is unavailable', 'UNAVAILABLE');
  if (err instanceof YoutubeTranscriptDisabledError)
    return new TranscriptError('Transcripts are disabled for this video', 'NOT_FOUND');
  if (err instanceof YoutubeTranscriptNotAvailableError)
    return new TranscriptError('No transcript available for this video', 'NOT_FOUND');
  if (err instanceof YoutubeTranscriptTooManyRequestError)
    return new TranscriptError('YouTube is currently unavailable', 'RATE_LIMITED');
  if (err instanceof YoutubeTranscriptNotAvailableLanguageError)
    return new TranscriptError('No transcript in requested language', 'NOT_FOUND');
  return new TranscriptError(err.message || 'Unexpected error', 'UNKNOWN');
}

export async function fetchTranscript(videoId, originalUrl) {
  const timeout = new Promise((_, reject) =>
    setTimeout(
      () => reject(new TranscriptError('Transcript fetch timed out', 'TIMEOUT')),
      TIMEOUT_MS
    )
  );

  const work = async () => {
    const [titleResult, segmentsResult] = await Promise.allSettled([
      fetchTitle(originalUrl),
      YoutubeTranscript.fetchTranscript(videoId),
    ]);

    let title;
    if (titleResult.status === 'fulfilled') {
      title = titleResult.value;
    } else {
      console.error('[oEmbed] Failed to fetch title:', titleResult.reason?.message);
      title = videoId;
    }

    if (segmentsResult.status === 'rejected') {
      throw segmentsResult.reason;
    }

    const markdown = formatMarkdown(videoId, originalUrl, title, segmentsResult.value);
    return { videoId, title, markdown };
  };

  try {
    return await Promise.race([work(), timeout]);
  } catch (err) {
    if (err instanceof TranscriptError) throw err;
    throw mapLibraryError(err);
  }
}
```

- [ ] **Step 3: Verify the module loads without errors**

```bash
node --input-type=module <<'EOF'
import { fetchTranscript, TranscriptError } from './src/transcript.js';
console.log('Module loaded OK');
console.log('TranscriptError:', typeof TranscriptError);
console.log('fetchTranscript:', typeof fetchTranscript);
EOF
```

Expected output:
```
Module loaded OK
TranscriptError: function
fetchTranscript: function
```

- [ ] **Step 4: Commit**

```bash
git add src/transcript.js
git commit -m "feat: add TranscriptError and fetchTranscript with oEmbed title and markdown formatting"
```

---

## Chunk 2: Routes and Server

### Task 3: Implement `GET /health` route

**Files:**
- Create: `src/routes/health.js`

- [ ] **Step 1: Write `src/routes/health.js`**

```js
export default async function healthRoutes(fastify) {
  fastify.get('/health', async (_request, reply) => {
    return reply.send({ status: 'ok' });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/routes/health.js
git commit -m "feat: add GET /health route"
```

---

### Task 4: Implement `POST /transcript` route

**Files:**
- Create: `src/routes/transcript.js`

This route handler is responsible for:
1. Validating the `url` body field is present and is a recognised YouTube URL form
2. Extracting the `videoId` using URL-aware parsing (not a bare string regex — see spec note on playlist IDs)
3. Validating the extracted `videoId` matches `[A-Za-z0-9_-]{11}`
4. Calling `fetchTranscript(videoId, url)` and mapping `TranscriptError` codes to HTTP status codes
5. Setting `Content-Type: text/markdown` and `Content-Disposition: attachment; filename="<videoId>.md"`

- [ ] **Step 1: Write `src/routes/transcript.js`**

```js
import { fetchTranscript, TranscriptError } from '../transcript.js';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const ERROR_STATUS = {
  NOT_FOUND: 404,
  UNAVAILABLE: 422,
  RATE_LIMITED: 503,
  TIMEOUT: 408,
  UNKNOWN: 500,
};

function extractVideoId(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.replace(/^www\./, '');

  if (hostname === 'youtube.com') {
    // watch?v=<id>
    const v = parsed.searchParams.get('v');
    if (v) return v;
    // /embed/<id> or /v/<id>
    const segments = parsed.pathname.split('/').filter(Boolean);
    if ((segments[0] === 'embed' || segments[0] === 'v') && segments[1]) {
      return segments[1];
    }
    return null;
  }

  if (hostname === 'youtu.be') {
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments[0] ?? null;
  }

  return null;
}

export default async function transcriptRoutes(fastify) {
  fastify.post('/transcript', async (request, reply) => {
    const { url } = request.body ?? {};

    if (!url || typeof url !== 'string') {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Missing required field: url',
      });
    }

    const videoId = extractVideoId(url);

    if (!videoId || !VIDEO_ID_RE.test(videoId)) {
      return reply.code(400).send({
        statusCode: 400,
        error: 'Bad Request',
        message: 'url must be a valid YouTube URL (youtube.com/watch?v=, youtu.be/, youtube.com/embed/, youtube.com/v/)',
      });
    }

    let result;
    try {
      result = await fetchTranscript(videoId, url);
    } catch (err) {
      if (err instanceof TranscriptError) {
        const status = ERROR_STATUS[err.code] ?? 500;
        return reply.code(status).send({
          statusCode: status,
          error: statusText(status),
          message: err.message,
        });
      }
      request.log.error(err);
      return reply.code(500).send({
        statusCode: 500,
        error: 'Internal Server Error',
        message: 'An unexpected error occurred',
      });
    }

    reply
      .code(200)
      .header('Content-Type', 'text/markdown')
      .header('Content-Disposition', `attachment; filename="${result.videoId}.md"`)
      .send(result.markdown);
  });
}

function statusText(code) {
  const map = {
    400: 'Bad Request',
    404: 'Not Found',
    408: 'Request Timeout',
    422: 'Unprocessable Entity',
    500: 'Internal Server Error',
    503: 'Service Unavailable',
  };
  return map[code] ?? 'Error';
}
```

- [ ] **Step 2: Verify the module loads without errors**

```bash
node --input-type=module <<'EOF'
import transcriptRoutes from './src/routes/transcript.js';
console.log('transcript route module loaded OK:', typeof transcriptRoutes);
EOF
```

Expected: `transcript route module loaded OK: function`

- [ ] **Step 3: Commit**

```bash
git add src/routes/transcript.js
git commit -m "feat: add POST /transcript route with URL validation and error mapping"
```

---

### Task 5: Implement server entry point

**Files:**
- Create: `src/server.js`

This file:
1. Reads and validates `PORT` and `HOST` env vars
2. Creates the Fastify instance with the default JSON logger
3. Registers both route plugins
4. Starts listening
5. Handles `SIGTERM` for graceful shutdown

- [ ] **Step 1: Write `src/server.js`**

```js
import Fastify from 'fastify';
import healthRoutes from './routes/health.js';
import transcriptRoutes from './routes/transcript.js';

function getEnvPort() {
  const raw = process.env.PORT ?? '3000';
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`[startup] Invalid PORT "${raw}": must be an integer between 1 and 65535`);
    process.exit(1);
  }
  return port;
}

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = getEnvPort();

const fastify = Fastify({ logger: true });

fastify.register(healthRoutes);
fastify.register(transcriptRoutes);

process.on('SIGTERM', async () => {
  fastify.log.info('SIGTERM received — closing server');
  await fastify.close();
  process.exit(0);
});

try {
  await fastify.listen({ port: PORT, host: HOST });
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
```

- [ ] **Step 2: Start the server and verify it runs**

```bash
node src/server.js
```

Expected log output (JSON):
```json
{"level":30,"msg":"Server listening at http://0.0.0.0:3000"}
```

Keep it running and continue to the next step.

- [ ] **Step 3: Verify `GET /health`**

In a second terminal:
```bash
curl -s http://localhost:3000/health | python3 -m json.tool
```

Expected:
```json
{ "status": "ok" }
```

- [ ] **Step 4: Verify `POST /transcript` rejects an invalid URL**

```bash
curl -s -X POST http://localhost:3000/transcript \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}' | python3 -m json.tool
```

Expected:
```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": "url must be a valid YouTube URL ..."
}
```

- [ ] **Step 5: Stop server, commit**

```bash
# Ctrl+C to stop server
git add src/server.js
git commit -m "feat: add server entry point with PORT/HOST validation and SIGTERM handler"
```

---

### Task 6: End-to-end smoke test

Before Dockerising, verify the full happy path with a real YouTube video that has captions.

- [ ] **Step 1: Start the server**

```bash
node src/server.js
```

- [ ] **Step 2: Send a real transcript request**

Use a well-known public video with captions (e.g. a TED Talk or YouTube official video):

```bash
curl -s -X POST http://localhost:3000/transcript \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  -o transcript.md
```

- [ ] **Step 3: Inspect the output**

```bash
head -20 transcript.md
```

Expected: A markdown file starting with `# <Video Title>` followed by metadata and transcript text.

- [ ] **Step 4: Clean up and commit**

```bash
rm -f transcript.md
# Ctrl+C to stop server
git commit --allow-empty -m "chore: smoke test passed — full happy path verified"
```

---

## Chunk 3: Docker

### Task 7: Add Dockerfile and `.dockerignore`

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`

- [ ] **Step 1: Write `.dockerignore`**

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

- [ ] **Step 2: Write `Dockerfile`**

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy dependency manifests first for better layer caching
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY src/ ./src/

# Run as non-root user (built into node:alpine image)
USER node

EXPOSE 3000

CMD ["node", "src/server.js"]
```

- [ ] **Step 3: Build the Docker image**

```bash
docker build -t my-ytd .
```

Expected: Build completes with no errors. Final line: `Successfully tagged my-ytd:latest` (or equivalent).

- [ ] **Step 4: Run the container**

```bash
docker run --rm -p 3000:3000 my-ytd
```

Expected: Server starts and logs its address.

- [ ] **Step 5: Verify health endpoint from outside the container**

In a second terminal:
```bash
curl -s http://localhost:3000/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 6: Verify transcript endpoint from outside the container**

```bash
curl -s -X POST http://localhost:3000/transcript \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"}' \
  -o transcript.md && head -5 transcript.md
```

Expected: First 5 lines of a valid markdown transcript.

- [ ] **Step 7: Verify graceful shutdown**

```bash
# Find the container ID
docker ps

# Send SIGTERM
docker stop <container-id>
```

Expected: Container stops cleanly (exit 0) within the default 10-second grace period.

- [ ] **Step 8: Clean up and commit**

```bash
rm -f transcript.md
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile and .dockerignore for containerised deployment"
```

---

## Done

At this point the service is fully implemented and verified:

- `POST /transcript` accepts a YouTube URL and returns a `.md` file
- `GET /health` returns `{ "status": "ok" }`
- All error cases (invalid URL, no transcript, unavailable video, CAPTCHA block, timeout) return structured JSON with the correct HTTP status
- The server starts cleanly in Docker, handles `SIGTERM`, and runs as non-root
