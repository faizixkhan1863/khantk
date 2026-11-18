import { CLINIC, treatmentById } from '../lib/clinic.mjs';
import { cors, rateLimit, readJson, sendJson } from '../lib/http.mjs';
import { normalizePhone, runTool } from '../lib/tools.mjs';
import { addDaysKey, openSlots, speakSlot, todayKey } from '../lib/schedule.mjs';
import { bookedSlotIds } from '../lib/store.mjs';

/**
 * The clinic's own booking form can post here instead of going through chat.
 *   POST /api/book  { name, phone, treatment, slotId?, date?, time?, notes? }
 * GET /api/book returns the next open slots (used by the widget's "show times").
 */
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.end();

  if (req.method === 'GET') {
    try {
      const from = todayKey();
      const slots = openSlots({ days: 3, taken: await bookedSlotIds({ from, to: addDaysKey(from, 12) }) });
      return sendJson(res, 200, {
        ok: true,
        clinic: CLINIC.shortName,
        slots: slots.map((d) => ({
          date: d.date,
          label: d.label,
          times: d.slots.map((s) => ({ id: s, label: speakSlot(s) })),
        })),
      });
    } catch {
      return sendJson(res, 503, { error: 'schedule_unavailable' });
    }
  }

  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method_not_allowed' });
  if (!rateLimit(req, { key: 'book', limit: 12, windowMs: 60_000 }).ok) {
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  let body;
  try {
    body = await readJson(req, 32 * 1024);
  } catch {
    return sendJson(res, 400, { error: 'bad_request' });
  }

  const treatment = treatmentById(body.treatment);
  const phone = normalizePhone(body.phone);
  const slotId = body.slotId || (body.date && body.time ? `${body.date}T${body.time}` : '');

  if (!body.name || String(body.name).trim().length < 2) return sendJson(res, 400, { error: 'name_required' });
  if (!phone) return sendJson(res, 400, { error: 'phone_invalid' });
  if (!treatment) return sendJson(res, 400, { error: 'treatment_unknown' });
  if (!slotId) return sendJson(res, 400, { error: 'slot_required' });

  const result = await runTool('book_appointment', {
    name: String(body.name).trim(),
    phone,
    treatment: treatment.id,
    slot_id: slotId,
    notes: body.notes ?? '',
  });

  if (!result.ok) return sendJson(res, 409, { error: 'slot_unavailable', speak: result.speak });
  return sendJson(res, 201, { ok: true, booking: result.booking, card: result.card });
}
