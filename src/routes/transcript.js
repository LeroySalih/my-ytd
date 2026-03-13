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
    const v = parsed.searchParams.get('v');
    if (v) return v;
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
