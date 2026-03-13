import { fetchTranscript, TranscriptError } from '../transcript.js';

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

const ERROR_RESPONSE = {
  NOT_FOUND:    { status: 404, text: 'Not Found' },
  UNAVAILABLE:  { status: 422, text: 'Unprocessable Entity' },
  RATE_LIMITED: { status: 503, text: 'Service Unavailable' },
  TIMEOUT:      { status: 408, text: 'Request Timeout' },
  UNKNOWN:      { status: 500, text: 'Internal Server Error' },
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
        const response = ERROR_RESPONSE[err.code] ?? { status: 500, text: 'Internal Server Error' };
        return reply.code(response.status).send({
          statusCode: response.status,
          error: response.text,
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
      .header('Content-Disposition', `attachment; filename="${videoId}.md"`)
      .send(result.markdown);
  });
}
