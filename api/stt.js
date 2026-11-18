import { transcribe, sttReady } from '../lib/stt.mjs';
import { cors, rateLimit, readJson, sendJson } from '../lib/http.mjs';

/**
 * POST /api/stt
 * Body: { audio: <base64>, mime?: "audio/webm", lang?: "ur"|"en"|"ps"|"auto" }
 *
 * Base64-in-JSON instead of multipart keeps this portable across Vercel,
 * Netlify and Cloudflare without touching body-parser settings. A 5-second
 * clip is ~40 KB, so the 33% overhead costs a few milliseconds of upload.
 */
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.end();
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!sttReady()) return sendJson(res, 501, { error: 'stt_not_configured' });

  if (!rateLimit(req, { key: 'stt', limit: 30, windowMs: 60_000 }).ok) {
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  let body;
  try {
    body = await readJson(req, 8 * 1024 * 1024);
  } catch {
    return sendJson(res, 400, { error: 'bad_request' });
  }

  const b64 = String(body.audio ?? '').replace(/^data:[^;]+;base64,/, '');
  if (!b64) return sendJson(res, 400, { error: 'missing_audio' });

  const audio = Buffer.from(b64, 'base64');
  if (audio.length < 1200) return sendJson(res, 400, { error: 'clip_too_short' });
  if (audio.length > 7 * 1024 * 1024) return sendJson(res, 413, { error: 'clip_too_large' });

  const lang = ['ur', 'en', 'ps', 'auto'].includes(body.lang) ? body.lang : 'auto';
  const started = Date.now();

  try {
    const text = await transcribe(audio, 'speech.webm', body.mime || 'audio/webm', lang);
    return sendJson(res, 200, { text, lang, ms: Date.now() - started });
  } catch (err) {
    console.error('[stt]', err?.message);
    return sendJson(res, 502, { error: 'stt_failed' });
  }
}
