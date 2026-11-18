/**
 * End-to-end smoke test against the local dev server, in demo mode (no keys).
 *   node test/smoke.mjs
 */
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';

const PORT = 4271;
const BASE = `http://127.0.0.1:${PORT}`;

const server = spawn('node', ['scripts/dev.mjs'], {
  env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', GROQ_API_KEY: '', AZURE_SPEECH_KEY: '' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

server.stdout.on('data', (d) => process.stdout.write(`  · ${d}`));
server.stderr.on('data', (d) => process.stderr.write(`  ! ${d}`));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function ready() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await wait(150);
  }
  throw new Error('server did not start');
}

function parseSse(text) {
  return text
    .split('\n\n')
    .map((frame) => frame.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((line) => JSON.parse(line.slice(5).trim()));
}

try {
  await ready();
  console.log('→ health');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.ok, true);
  assert.equal(health.mode, 'demo');
  assert.equal(health.providers.llm, null);

  console.log('→ static widget');
  const widget = await fetch(`${BASE}/widget.js`);
  assert.equal(widget.status, 200);
  assert.match(await widget.text(), /TKDentVoice/);

  console.log('→ chat (demo brain, SSE)');
  const chatRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'clinic ke timings kya hain?' }], lang: 'ur' }),
  });
  assert.equal(chatRes.status, 200);
  assert.match(chatRes.headers.get('content-type'), /event-stream/);
  const events = parseSse(await chatRes.text());
  const done = events.find((e) => e.type === 'done');
  assert.ok(done, 'expected a done event');
  assert.match(done.text, /ہفتے|اتوار|Saturday/, 'expected the clinic hours in Urdu script');
  assert.ok(events.some((e) => e.type === 'delta'));

  console.log('→ chat booking flow');
  const bookingChat = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'user', content: 'Mujhe appointment book karni hai' },
        { role: 'assistant', content: 'Kis treatment ke liye?' },
        { role: 'user', content: 'checkup' },
        { role: 'assistant', content: 'Apna naam bataiye' },
        { role: 'user', content: 'Ali Raza' },
        { role: 'assistant', content: 'Number?' },
        { role: 'user', content: '03001234567' },
      ],
      lang: 'ur',
    }),
  });
  const bookingEvents = parseSse(await bookingChat.text());
  const card = bookingEvents.find((e) => e.type === 'card' && e.card?.type === 'booking');
  assert.ok(card, 'expected a booking card');
  assert.match(card.card.ref, /^[A-Z0-9]{8}$/);

  console.log('→ availability');
  const slots = await (await fetch(`${BASE}/api/book`)).json();
  assert.ok(slots.slots.length > 0);

  console.log('→ keyless demo voice');
  const tts = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'Assalam o alaikum, appointment book karni hai?', lang: 'ur' }),
  });
  assert.equal(tts.status, 200);
  assert.match(tts.headers.get('content-type'), /audio\/mpeg/);
  assert.ok((await tts.arrayBuffer()).byteLength > 8000, 'expected a real mp3');

  console.log('→ pashto needs the Azure key');
  const ps = await fetch(`${BASE}/api/tts?t=test&l=ps`);
  assert.equal(ps.status, 501);

  console.log('→ stt without a key');
  const stt = await fetch(`${BASE}/api/stt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ audio: 'AAAA', mime: 'audio/webm' }),
  });
  assert.equal(stt.status, 501);

  console.log('\nAll smoke checks passed.\n');
} finally {
  server.kill('SIGTERM');
}
