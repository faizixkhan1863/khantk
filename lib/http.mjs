/** Tiny helpers shared by the Vercel handlers and the local dev server. */

export function cors(req, res) {
  const allowed = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim());
  const origin = req.headers?.origin ?? '';
  const ok = !allowed || allowed.includes('*') || allowed.includes(origin);
  res.setHeader('Access-Control-Allow-Origin', ok ? origin || '*' : 'null');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  return ok;
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

export function methodGuard(req, res, allowed = ['POST']) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }
  if (!allowed.includes(req.method)) {
    sendJson(res, 405, { error: 'method_not_allowed' });
    return false;
  }
  return true;
}

/** Read the request body as a Buffer, with a hard size cap. */
export async function readBody(req, limit = 12 * 1024 * 1024) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit) {
  const buf = await readBody(req, limit);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8'));
  } catch {
    throw new Error('BAD_JSON');
  }
}

/** Fixed-window rate limit. Per-instance only — good enough as a brake, not a quota. */
const buckets = new Map();

export function rateLimit(req, { key = 'default', limit = 30, windowMs = 60_000 } = {}) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  const bucketKey = `${key}:${ip}`;
  const now = Date.now();
  const entry = buckets.get(bucketKey);

  if (!entry || now > entry.reset) {
    buckets.set(bucketKey, { count: 1, reset: now + windowMs });
    if (buckets.size > 5000) buckets.clear();
    return { ok: true, remaining: limit - 1 };
  }
  entry.count += 1;
  return { ok: entry.count <= limit, remaining: Math.max(0, limit - entry.count) };
}
