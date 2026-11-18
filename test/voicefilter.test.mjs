import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceFilter } from '../lib/voicefilter.mjs';

test('drops the same sentence said twice', () => {
  const f = createVoiceFilter();
  f.push('And your phone number, please? ');
  const out = f.push('And your phone number, please? ');
  assert.equal(out, '');
  assert.equal(f.count, 1);
});

test('stops after two sentences', () => {
  const f = createVoiceFilter();
  const out = f.push('Sure, I can help. Which treatment do you need? What time suits you? When?');
  assert.equal(out, 'Sure, I can help. Which treatment do you need?');
  assert.equal(f.count, 2);
});

test('a sentence split across chunks stays intact', () => {
  const f = createVoiceFilter();
  assert.equal(f.push('Your appointment is'), '');
  assert.equal(f.push(' booked for ten.'), 'Your appointment is booked for ten.');
});

test('keeps an unterminated tail only on flush', () => {
  const f = createVoiceFilter();
  assert.equal(f.push('Done, you are booked'), '');
  assert.equal(f.flush(), 'Done, you are booked');
});

test('ignores form-style noise that is only punctuation', () => {
  const f = createVoiceFilter();
  const out = f.push('? ? ? ');
  assert.equal(out, '');
});

test('the screenshot case collapses to one question', () => {
  const f = createVoiceFilter();
  const noisy =
    'And your phone number, please? (e.g., 0301xxxxxxx)Your phone number is?' +
    '(Please share your phone number so I can confirm it.)Your phone number, please?';
  const out = f.push(noisy) + f.flush();
  assert.equal(out, 'And your phone number, please?');
});
