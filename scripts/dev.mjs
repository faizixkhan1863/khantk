#!/usr/bin/env node
/**
 * Zero-dependency dev server: serves /public and mounts /api/* on the same
 * origin, so the widget runs exactly as it will on Vercel.
 *
 *   node scripts/dev.mjs            # http://127.0.0.1:4173
 *   PORT=8080 node scripts/dev.mjs
 */
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function loadEnv() {
  try {
    const raw = await readFile(path.join(root, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const value = m[2].replace(/^['"]|['"]$/g, '');
      if (!(m[1] in process.env)) process.env[m[1]] = value;
    }
  } catch {
    /* .env is optional */
  }
}

async function readRequestBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error('BODY_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function serveApi(req, res, pathname) {
  const name = pathname.replace(/^\/api\//, '').replace(/\/$/, '');
  if (!/^[a-z0-9-]+$/i.test(name)) {
    res.writeHead(400).end('bad api path');
    return;
  }

  let mod;
  try {
    mod = await import(path.join(root, 'api', `${name}.js`));
  } catch (err) {
    if (err.code === 'ERR_MODULE_NOT_FOUND') {
      res.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'not_found' }));
      return;
    }
    console.error('[api]', name, err);
    res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error: 'handler_crash' }));
    return;
  }

  const raw = await readRequestBody(req);
  const type = req.headers['content-type'] || '';
  req.body = raw.length && type.includes('application/json') ? raw.toString('utf8') : raw;

  const started = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - started;
    console.log(`${req.method} /api/${name} → ${res.statusCode} ${ms}ms`);
  });

  try {
    await mod.default(req, res);
  } catch (err) {
    console.error('[api]', name, err);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'handler_error' }));
  }
}

const PRETTY = { '/admin': 'admin.html' };

async function serveStatic(req, res, pathname) {
  const target = PRETTY[pathname] ?? (pathname === '/' ? 'index.html' : pathname);
  let filePath = path.join(publicDir, target);
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
    return;
  }

  try {
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

await loadEnv();

// Local runs are demos: tag WhatsApp drafts so nobody mistakes them for real ones.
if (!('DEMO_TAG' in process.env)) process.env.DEMO_TAG = 'on';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname.startsWith('/api/')) {
    await serveApi(req, res, pathname);
    return;
  }
  await serveStatic(req, res, pathname);
});

server.listen(PORT, HOST, () => {
  const configured = [
    ['LLM', process.env.GROQ_API_KEY || process.env.LLM_API_KEY],
    ['STT', process.env.GROQ_API_KEY || process.env.STT_API_KEY],
    ['TTS', process.env.AZURE_SPEECH_KEY || process.env.ELEVENLABS_API_KEY],
  ]
    .map(([k, v]) => `${v ? 'on ' : 'off'} ${k}`)
    .join('  ');

  console.log(`\n  TK Dent voice · dev server`);
  console.log(`  http://${HOST}:${PORT}`);
  console.log(`  providers: ${configured}\n`);
});
