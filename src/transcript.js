import { spawn } from 'child_process';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

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

function parseVtt(vttContent) {
  // Strip inline timing cues like <00:00:19.039><c> and </c>
  const stripped = vttContent.replace(/<[^>]+>/g, '');

  const lines = stripped.split('\n');
  const texts = [];
  let prev = null;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip WEBVTT header, Kind/Language metadata, timestamp lines, and blanks
    if (
      !trimmed ||
      trimmed.startsWith('WEBVTT') ||
      trimmed.startsWith('Kind:') ||
      trimmed.startsWith('Language:') ||
      /^\d{2}:\d{2}:\d{2}/.test(trimmed) ||  // timestamp line
      /^\d+$/.test(trimmed)                    // cue number
    ) {
      continue;
    }
    // Deduplicate consecutive identical lines (yt-dlp shows rolling captions)
    if (trimmed !== prev) {
      texts.push(trimmed);
      prev = trimmed;
    }
  }

  return texts;
}

function formatMarkdown(videoId, originalUrl, title, texts) {
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
  for (let i = 0; i < texts.length; i += 10) {
    const chunk = texts.slice(i, i + 10);
    paragraphs.push(chunk.map(decodeEntities).join(' '));
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

function runYtDlp(videoId, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`[yt-dlp] starting download for ${videoId}`);
    const proc = spawn('yt-dlp', [
      '--write-auto-sub',
      '--sub-lang', 'en',
      '--skip-download',
      '--sub-format', 'vtt',
      '--no-warnings',
      '-o', outputPath,
      `https://www.youtube.com/watch?v=${videoId}`,
    ]);

    let stderr = '';
    proc.stdout.on('data', (d) => { process.stdout.write(`[yt-dlp] ${d}`); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[yt-dlp] finished for ${videoId}`);
        resolve();
      } else {
        reject(new Error(`yt-dlp exited ${code}: ${stderr.slice(0, 300)}`));
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`yt-dlp not found: ${err.message}`));
    });
  });
}

async function fetchTranscriptText(videoId) {
  const tmpDir = await mkdtemp(join(tmpdir(), 'ytd-'));
  const outputPath = join(tmpDir, 'transcript');
  const vttPath = `${outputPath}.en.vtt`;

  try {
    await runYtDlp(videoId, outputPath);
    const vttContent = await readFile(vttPath, 'utf8');
    console.log(`[transcript] parsed VTT for ${videoId}`);
    return parseVtt(vttContent);
  } catch (err) {
    const msg = err.message ?? '';
    if (msg.includes('Video unavailable') || msg.includes('not available')) {
      throw new TranscriptError('Video is unavailable', 'UNAVAILABLE');
    }
    if (msg.includes('no subtitles') || msg.includes('no captions')) {
      throw new TranscriptError('No transcript available for this video', 'NOT_FOUND');
    }
    // If the vtt file wasn't created, no subtitles were available
    if (msg.includes('ENOENT')) {
      throw new TranscriptError('No transcript available for this video', 'NOT_FOUND');
    }
    throw err;
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
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
    const [titleResult, textsResult] = await Promise.allSettled([
      fetchTitle(originalUrl),
      fetchTranscriptText(videoId),
    ]);

    let title;
    if (titleResult.status === 'fulfilled') {
      title = titleResult.value;
    } else {
      console.error('[oEmbed] Failed to fetch title:', titleResult.reason?.message);
      title = videoId;
    }

    if (textsResult.status === 'rejected') {
      throw textsResult.reason;
    }

    const markdown = formatMarkdown(videoId, originalUrl, title, textsResult.value);
    return { videoId, title, markdown };
  };

  try {
    return await Promise.race([work(), timeout]);
  } catch (err) {
    if (err instanceof TranscriptError) throw err;
    throw new TranscriptError(err.message || 'Unexpected error', 'UNKNOWN');
  } finally {
    clearTimeout(timerId);
  }
}
