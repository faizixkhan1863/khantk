import { listBookings } from '../lib/store.mjs';
import { cors, sendJson } from '../lib/http.mjs';
import { speakSlot } from '../lib/schedule.mjs';

/**
 * GET /api/bookings?key=…  → everything booked, newest first.
 * Protected by a shared key because it contains patient phone numbers.
 */
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.end();

  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const key = url.searchParams.get('key') ?? req.headers['x-admin-key'];
  const expected = process.env.ADMIN_KEY || 'tkdent-demo';

  if (!key || key !== expected) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  try {
    const rows = await listBookings(200);
    return sendJson(res, 200, {
      ok: true,
      count: rows.length,
      bookings: rows.map((b) => ({
        ref: b.id,
        name: b.name,
        phone: b.phone,
        treatment: b.treatment,
        when: b.when ?? speakSlot(b.slotId),
        date: String(b.slotId ?? '').split('T')[0],
        time: String(b.slotId ?? '').split('T')[1] ?? '',
        status: b.status,
        createdAt: b.createdAt ?? b.created_at ?? '',
      })),
    });
  } catch (err) {
    console.error('[bookings]', err?.message);
    return sendJson(res, 503, { error: 'store_unavailable' });
  }
}
