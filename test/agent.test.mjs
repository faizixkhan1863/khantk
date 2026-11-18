/**
 * Exercises the real agent loop (streaming + tool calling) against a fake
 * OpenAI-compatible server, so the live path is tested without any API key.
 *
 *   node test/agent.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const LLM_PORT = 4281;
const APP_PORT = 4282;
const BASE = `http://127.0.0.1:${APP_PORT}`;

const sseChunk = (obj) => `data: ${JSON.stringify(obj)}\n\n`;

/** First call asks for a tool; once the tool result is in, it answers. */
const fakeLlm = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const payload = JSON.parse(body || '{}');
    const hasToolResult = payload.messages?.some((m) => m.role === 'tool');

    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(': keep-alive\n\n');

    if (!hasToolResult) {
      res.write(
        sseChunk({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: 'call_abc',
                    type: 'function',
                    function: { name: 'get_availability', arguments: '{"days":1}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        }),
      );
      res.write(sseChunk({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }));
    } else {
      res.write(sseChunk({ choices: [{ delta: { content: 'Ji,' } }] }));
      res.write(sseChunk({ choices: [{ delta: { content: ' kal 11:30 khaali hai.' } }] }));
      res.write(sseChunk({ choices: [{ delta: {}, finish_reason: 'stop' }] }));
    }
    res.write('data: [DONE]\n\n');
    res.end();
  });
});

function parseSse(text) {
  return text
    .split('\n\n')
    .map((f) => f.split('\n').find((l) => l.startsWith('data:')))
    .filter(Boolean)
    .map((l) => JSON.parse(l.slice(5).trim()));
}

await new Promise((r) => fakeLlm.listen(LLM_PORT, '127.0.0.1', r));

const app = spawn('node', ['scripts/dev.mjs'], {
  cwd: new URL('..', import.meta.url).pathname,
  env: {
    ...process.env,
    PORT: String(APP_PORT),
    HOST: '127.0.0.1',
    GROQ_ENABLED: '1',
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: `http://127.0.0.1:${LLM_PORT}/v1`,
    LLM_MODEL: 'fake-model',
    AZURE_SPEECH_KEY: '',
    ELEVENLABS_API_KEY: '',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});

test.after(() => {
  app.kill('SIGTERM');
  fakeLlm.close();
});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('agent streams, calls a tool and answers', async () => {
  for (let i = 0; i < 40; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {}
    await wait(150);
  }

  const health = await (await fetch(`${BASE}/api/health`)).json();
  assert.equal(health.mode, 'live', 'health should report live mode with a key present');

  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: 'kal slot hai?' }], lang: 'ur' }),
  });
  assert.equal(res.status, 200);

  const events = parseSse(await res.text());
  const tool = events.find((e) => e.type === 'tool');
  assert.equal(tool?.name, 'get_availability', 'tool call should be surfaced to the UI');

  const done = events.find((e) => e.type === 'done');
  assert.equal(done.text, 'Ji, kal 11:30 khaali hai.');

  const deltas = events.filter((e) => e.type === 'delta').map((e) => e.text).join('');
  assert.equal(deltas, done.text);

  const meta = events.find((e) => e.type === 'meta');
  assert.equal(meta.mode, 'live');
});
