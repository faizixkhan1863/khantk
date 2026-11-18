/**
 * Pakistan-time helpers. Pakistan is UTC+05:00 all year (no DST since 2009),
 * so shifting the epoch by the offset and reading UTC parts is exact.
 */
import { PK_OFFSET_MIN, SLOT_TIMES } from './clinic.mjs';

const OFFSET_MS = PK_OFFSET_MIN * 60_000;
const DAY_MS = 86_400_000;

/** A Date whose UTC getters read as Karachi wall-clock time. */
export function nowKarachi() {
  return new Date(Date.now() + OFFSET_MS);
}

/** Shift any real epoch into the same "UTC getters are Karachi" frame. */
export function toKarachi(date = new Date()) {
  return new Date(date.getTime() + OFFSET_MS);
}

export function dateKey(karachiDate) {
  return karachiDate.toISOString().slice(0, 10);
}

export function todayKey() {
  return dateKey(nowKarachi());
}

export function addDaysKey(key, days) {
  const d = new Date(`${key}T00:00:00.000Z`);
  return dateKey(new Date(d.getTime() + days * DAY_MS));
}

export function weekdayIndex(key) {
  return new Date(`${key}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Thursday 20 November" — good for a voice prompt. */
export function humanDate(key, locale = 'en-GB') {
  const d = new Date(`${key}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(d);
}

/** "11:30 AM" */
export function humanTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function prettyNow() {
  const k = nowKarachi();
  return `${humanDate(dateKey(k))}, ${humanTime(k.toISOString().slice(11, 16))}`;
}

/** Is this slot still in the future? Needs at least 45 minutes of lead time. */
export function isFutureSlot(slotId) {
  const [date, time] = slotId.split('T');
  const slotTs = Date.parse(`${date}T${time}:00.000+05:00`);
  return Number.isFinite(slotTs) && slotTs > Date.now() + 45 * 60_000;
}

function isClinicDay(key) {
  return weekdayIndex(key) !== 0; // closed Sunday, by appointment only
}

/**
 * Open slots for the next `days` days, skipping Sundays, past slots and
 * anything already in `taken` (a Set of slot ids or of slot ids per doctor).
 */
export function openSlots({ days = 3, taken = new Set(), from = todayKey() } = {}) {
  const out = [];
  for (let i = 0; i < days + 4 && out.length < days; i += 1) {
    const key = addDaysKey(from, i);
    if (!isClinicDay(key)) continue;
    const slots = SLOT_TIMES.map((t) => `${key}T${t}`).filter(
      (id) => isFutureSlot(id) && !taken.has(id),
    );
    if (!slots.length) continue;
    out.push({ date: key, label: humanDate(key), slots });
  }
  return out;
}

/** Format a slot id for speech: "Thursday 20 November at 11:30 AM". */
export function speakSlot(slotId) {
  const [date, time] = slotId.split('T');
  return `${humanDate(date)} at ${humanTime(time)}`;
}

const UR_WEEKDAYS = ['اتوار', 'پیر', 'منگل', 'بدھ', 'جمعرات', 'جمعہ', 'ہفتہ'];
const UR_MONTHS = [
  'جنوری', 'فروری', 'مارچ', 'اپریل', 'مئی', 'جون',
  'جولائی', 'اگست', 'ستمبر', 'اکتوبر', 'نومبر', 'دسمبر',
];

/** Same slot, written the way an Urdu speaker would say it. */
export function speakSlotUr(slotId) {
  const [date, time] = slotId.split('T');
  const d = new Date(`${date}T00:00:00.000Z`);
  const day = UR_WEEKDAYS[d.getUTCDay()];
  const month = UR_MONTHS[d.getUTCMonth()];
  const [h, m] = time.split(':').map(Number);
  const part = h < 12 ? 'صبح' : h < 16 ? 'دوپہر' : 'شام';
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  const clock = m === 0 ? `${hour12} بجے` : `${hour12}:${String(m).padStart(2, '0')}`;
  return `${day} ${d.getUTCDate()} ${month}، ${part} ${clock}`;
}

export function speakSlotIn(slotId, lang) {
  return lang === 'ur' ? speakSlotUr(slotId) : speakSlot(slotId);
}
