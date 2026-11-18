import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, runTool } from '../lib/tools.mjs';
import { addDaysKey, humanTime, isFutureSlot, openSlots, todayKey } from '../lib/schedule.mjs';
import { speakable } from '../lib/tts.mjs';
import { _reset } from '../lib/store.mjs';
import { buildSystemPrompt } from '../lib/clinic.mjs';

test('phone numbers normalise to E.164', () => {
  assert.equal(normalizePhone('0300 1234567'), '+923001234567');
  assert.equal(normalizePhone('03001234567'), '+923001234567');
  assert.equal(normalizePhone('+92 300 1234567'), '+923001234567');
  assert.equal(normalizePhone('00923001234567'), '+923001234567');
  assert.equal(normalizePhone('3001234567'), '+923001234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
});

test('times read naturally for speech', () => {
  assert.equal(humanTime('10:00'), '10:00 AM');
  assert.equal(humanTime('13:00'), '1:00 PM');
  assert.equal(humanTime('17:30'), '5:30 PM');
});

test('open slots skip Sundays and past times', () => {
  const from = '2026-11-22'; // a Sunday
  const days = openSlots({ days: 2, from });
  assert.ok(days.length > 0);
  for (const day of days) {
    assert.notEqual(new Date(`${day.date}T00:00:00Z`).getUTCDay(), 0, 'Sunday must be skipped');
    for (const slot of day.slots) assert.ok(isFutureSlot(slot));
  }
});

test('slot ids are stable and ordered', () => {
  const slots = openSlots({ days: 1, from: addDaysKey(todayKey(), 1) })[0];
  assert.match(slots.slots[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  const times = slots.slots.map((s) => s.split('T')[1]);
  assert.deepEqual(times, [...times].sort());
});

test('booking writes a slot and refuses a second booking', async () => {
  _reset();
  const slot = openSlots({ days: 1 })[0].slots[0];

  const first = await runTool('book_appointment', {
    name: 'Ali Raza',
    phone: '03001234567',
    treatment: 'checkup',
    slot_id: slot,
  });
  assert.equal(first.ok, true);
  assert.match(first.booking.id, /^[A-Z0-9]{8}$/);
  assert.equal(first.card.type, 'booking');
  assert.ok(first.card.waLink.startsWith('https://wa.me/923123329479'));

  const second = await runTool('book_appointment', {
    name: 'Sara Khan',
    phone: '03211234567',
    treatment: 'rct',
    slot_id: slot,
  });
  assert.equal(second.ok, false);
  assert.match(second.speak, /slot/i);
});

test('booking validates the phone before touching the store', async () => {
  _reset();
  const slot = openSlots({ days: 1 })[0].slots[0];
  const res = await runTool('book_appointment', {
    name: 'Test Patient',
    phone: '123',
    treatment: 'checkup',
    slot_id: slot,
  });
  assert.equal(res.ok, false);
  assert.match(res.speak, /number/i);
});

test('emergency handoff returns a fixed, spoken call script', async () => {
  const res = await runTool(
    'escalate_to_human',
    { reason: 'uncontrolled bleeding', urgency: 'emergency' },
    { lang: 'en' },
  );
  assert.equal(res.card.urgency, 'emergency');
  assert.ok(res.card.tel.startsWith('tel:+92'));
  assert.equal(res.final, true, 'emergencies bypass the model');
  assert.match(res.speak, /call the clinic/i);
  assert.match(res.speak, /\+92 312 3329479/);

  const ur = await runTool('escalate_to_human', { reason: 'khoon', urgency: 'emergency' }, { lang: 'ur' });
  assert.match(ur.speak, /کلینک/);
});

test('availability needs a treatment first', async () => {
  _reset();
  const res = await runTool('get_availability', { days: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'treatment_required');
  assert.equal(res.card.type, 'treatments');
  assert.equal(res.card.items.length, 11);
});

test('availability returns real slot ids once the treatment is known', async () => {
  _reset();
  const res = await runTool('get_availability', { days: 1, treatment: 'checkup' });
  assert.equal(res.ok, true);
  assert.match(res.days[0].slots[0].id, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  assert.equal(res.card.type, 'slots');
});

test('tts text is stripped of markdown, emoji and urls', () => {
  assert.equal(
    speakable('**Bilkul!** Visit https://example.com \u2605 abhi'),
    'Bilkul! Visit abhi',
  );
});

test('system prompt pins the safety rules', () => {
  const prompt = buildSystemPrompt({ lang: 'ur', nowLocal: 'Monday' });
  assert.match(prompt, /No diagnosis/);
  assert.match(prompt, /feminine/);
  assert.match(prompt, /escalate_to_human/);
  assert.match(prompt, /Urdu script/);
  assert.match(prompt, /Bani Gala/);
});
