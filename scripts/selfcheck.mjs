#!/usr/bin/env node
/**
 * One-command health check for the demo: hits the running server and prints a
 * pass/fail table. Useful before showing the bot to a client.
 *
 *   node scripts/selfcheck.mjs
 *   BASE=http://127.0.0.1:4173 node scripts/selfcheck.mjs
 */
const BASE = (process.env.BASE || 'http://127.0.0.1:4173').replace(/\/$/, '');

const results = [];
let failures = 0;

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  if (!ok) failures += 1;
}

async function json(path, init) {
  const res = await fetch(`${BASE}${path}`, init);
  return { res, body: await res.json().catch(() => null) };
}

function parseSse(text) {
  return text
    .split('\n\n')
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((l) => JSON.parse(l.slice(5).trim()));
}

const BUSY = /line is busy|lost the connection/i;

async function chat(messages, lang, { retry = true } = {}) {
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages, lang }),
  });
  const events = parseSse(await res.text());
  const result = {
    status: res.status,
    text: events.find((e) => e.type === 'done')?.text ?? '',
    cards: events.filter((e) => e.type === 'card').map((e) => e.card),
    tools: events.filter((e) => e.type === 'tool').map((e) => e.name),
  };

  // The free Groq tier is 8k tokens/minute; a burst of checks can trip it.
  // Wait out the window once instead of reporting a false failure.
  if (retry && BUSY.test(result.text)) {
    await new Promise((r) => setTimeout(r, 22_000));
    return chat(messages, lang, { retry: false });
  }
  return result;
}

const t0 = Date.now();

// 1. health
try {
  const { res, body } = await json('/api/health');
  const tts = body?.providers?.tts;
  record('server up', res.ok, `mode=${body?.mode}`);
  record('voice provider', Boolean(tts), tts || 'none');
  record('brain provider', Boolean(body?.providers?.llm) || body?.mode === 'demo', body?.providers?.llm || 'demo brain');
} catch (err) {
  console.error(`\n  Cannot reach ${BASE} — run "npm run dev" first.\n`);
  process.exit(1);
}

// 2. Urdu
const ur = await chat([{ role: 'user', content: 'clinic ke timings kya hain?' }], 'auto');
record('urdu reply', /ہفتے|اتوار|بجے/.test(ur.text), ur.text.slice(0, 60));
record('urdu is a real answer', ur.text.length > 20);

await new Promise((r) => setTimeout(r, 1500));

// 3. English
const en = await chat([{ role: 'user', content: 'what are your timings?' }], 'en');
record('english reply', /monday|saturday|10|7/i.test(en.text), en.text.slice(0, 60));

await new Promise((r) => setTimeout(r, 1500));

// 4. Urdu booking — two turns, the way a patient actually books
const bookingHistory = [
  { role: 'user', content: 'mujhe kal appointment book karni hai' },
  { role: 'assistant', content: 'کس علاج کے لیے؟' },
  { role: 'user', content: 'checkup' },
  { role: 'assistant', content: 'آپ کا نام؟' },
  { role: 'user', content: 'Bilal Ahmed' },
  { role: 'assistant', content: 'فون نمبر؟' },
  { role: 'user', content: '03009998877' },
];
const step1 = await chat(bookingHistory, 'ur');
record('urdu availability', step1.tools.includes('get_availability') || /بجے|وقت/.test(step1.text), step1.text.slice(0, 50));

// Confirm whichever time the bot actually offered, not a hard-coded one.
const offered = step1.text.match(/(\d{1,2}:\d{2})/)?.[1] ?? '10:00';

await new Promise((r) => setTimeout(r, 1500));
const step2 = await chat(
  [
    ...bookingHistory,
    { role: 'assistant', content: step1.text },
    { role: 'user', content: `جی ${offered} بجے ٹھیک ہے، وہی بک کر دیں` },
  ],
  'ur',
);
const bookingCard = step2.cards.find((c) => c.type === 'booking');
record('urdu booking card', Boolean(bookingCard), bookingCard ? `ref ${bookingCard.ref}` : step2.text.slice(0, 50));
record('booking writes a slot', Boolean(bookingCard?.when), bookingCard?.when ?? '');

await new Promise((r) => setTimeout(r, 1500));

// 5. English — the same tool path, English wording
const bookingEn = await chat(
  [
    { role: 'user', content: 'I want to book a root canal appointment' },
    { role: 'assistant', content: 'Could I have your name?' },
    { role: 'user', content: 'Sara Khan' },
    { role: 'assistant', content: 'And your mobile number?' },
    { role: 'user', content: '03211112222' },
  ],
  'en',
);
record(
  'english booking flow',
  bookingEn.tools.includes('get_availability') || /time|slot|when/i.test(bookingEn.text),
  bookingEn.text.slice(0, 50),
);

await new Promise((r) => setTimeout(r, 1500));

// 6. Emergency stops the sales flow
const emergency = await chat([{ role: 'user', content: 'mere daant se khoon aa raha hai' }], 'ur');
record('emergency handoff', emergency.cards.some((c) => c.type === 'handoff'));

await new Promise((r) => setTimeout(r, 1500));

// 7. Human handoff
const human = await chat([{ role: 'user', content: 'doctor se baat karni hai' }], 'ur');
record('human handoff', human.cards.some((c) => c.type === 'handoff'));

// 8. Voice, both languages
for (const [lang, sample] of [
  ['ur', 'السلام علیکم، اپائنٹمنٹ بک کرنی ہے'],
  ['en', 'Hello, I would like to book an appointment'],
]) {
  const started = Date.now();
  const res = await fetch(`${BASE}/api/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: sample, lang }),
  });
  const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0;
  record(`${lang} voice`, res.ok && bytes > 5000, `${bytes} bytes, ${Date.now() - started} ms`);
}

// 9. Widget asset
const widget = await fetch(`${BASE}/widget.js`);
const source = widget.ok ? await widget.text() : '';
record('widget served', widget.ok && source.includes('TKDentVoice'));
record('pashto hidden by default', source.includes("script.dataset.langs || 'ur,en'"));

// report
const pad = Math.max(...results.map((r) => r.name.length)) + 2;
console.log(`\n  TK Dent · self check  (${BASE})\n`);
for (const r of results) {
  const mark = r.ok ? 'PASS' : 'FAIL';
  console.log(`  ${mark}  ${r.name.padEnd(pad)} ${r.detail}`);
}
console.log(`\n  ${results.length - failures}/${results.length} passed in ${Date.now() - t0} ms\n`);
process.exit(failures ? 1 : 0);
