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
    return new TranscriptError('YouTube is currently unavailable. Try again later.', 'RATE_LIMITED');
  if (err instanceof YoutubeTranscriptNotAvailableLanguageError)
    return new TranscriptError('No transcript in requested language', 'NOT_FOUND');
  return new TranscriptError(err.message || 'Unexpected error', 'UNKNOWN');
}

/**
 * @param {string} videoId - Validated 11-character YouTube video ID
 * @param {string} originalUrl - Original URL (used for markdown metadata only)
 * @returns {Promise<{ videoId: string, title: string, markdown: string }>}
 * @throws {TranscriptError} with code: NOT_FOUND | UNAVAILABLE | RATE_LIMITED | TIMEOUT | UNKNOWN
 */
export async function fetchTranscript(videoId, originalUrl) {
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(
      () => reject(new TranscriptError('Transcript fetch timed out', 'TIMEOUT')),
      TIMEOUT_MS
    );
  });

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
  } finally {
    clearTimeout(timerId);
  }
}
