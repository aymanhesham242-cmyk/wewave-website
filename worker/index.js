/**
 * WeWave — Worker in front of the static site.
 *
 * Everything that isn't /api/* is handed straight to the static assets, so the
 * site behaves exactly as before. The API adds:
 *
 *   POST  /api/meeting        public — a visitor submitting the booking form
 *   GET   /api/meetings       admin  — list requests
 *   PATCH /api/meetings/:id   admin  — set status / notes
 *
 * Admin routes require `Authorization: Bearer <ADMIN_TOKEN>`, where ADMIN_TOKEN
 * is a Worker secret. They fail closed: with no secret set, nothing is
 * readable. The /admin page itself is a static shell containing no data — it
 * is useless without a token, so it does not need protecting separately.
 */

const MAX_BODY = 16 * 1024;          /* a booking request is ~1KB; anything larger is abuse */
const STATUSES = ['new', 'contacted', 'booked', 'archived'];

const RATE_MAX    = 5;              /* submissions allowed per window, per address */
const RATE_WINDOW = 10 * 60;        /* seconds */
const RATE_KEEP   = 60 * 60;        /* how long log rows are worth keeping */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

/** Compare without leaking length/prefix through timing. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAdmin(request, env) {
  /* Trim both sides: a secret pasted into the dashboard can pick up a stray
     space or newline, which would otherwise fail on length alone. */
  const secret = (env.ADMIN_TOKEN || '').trim();
  if (!secret) return false;                        /* fail closed */
  const header = request.headers.get('Authorization') || '';
  const m = header.match(/^Bearer\s+([\s\S]+)$/i);
  return !!m && safeEqual(m[1].trim(), secret);
}

/* Addresses are hashed before they are stored: enough to count repeats from
   one source, without keeping a log of visitors' IP addresses. */
async function addressKey(ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sliding-window limit on the public submit route.
 *
 * Fails OPEN on any storage error: a booking from a real customer is worth
 * more than a strictly enforced limit, and the validation above still stands.
 */
async function overRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) return false;                          /* nothing to key on */
  try {
    const key = await addressKey(ip);
    const now = Math.floor(Date.now() / 1000);

    const row = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM submit_log WHERE ip = ? AND at >= ?')
      .bind(key, now - RATE_WINDOW).first();
    if (row && row.n >= RATE_MAX) return true;

    await env.DB.prepare('INSERT INTO submit_log (ip, at) VALUES (?, ?)').bind(key, now).run();
    /* prune occasionally rather than on every request */
    if (Math.random() < 0.05) {
      await env.DB.prepare('DELETE FROM submit_log WHERE at < ?').bind(now - RATE_KEEP).run();
    }
    return false;
  } catch {
    return false;
  }
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Server-side validation — the client's checks are for UX, not trust. */
function validate(b) {
  const out = {
    name:        str(b.name, 120),
    brandLink:   str(b.brandLink, 300),
    phone:       str(b.phone, 40),
    meetingDate: str(b.meetingDate, 10),
    message:     str(b.message, 2000),
    services:    Array.isArray(b.services)
      ? b.services.filter(s => typeof s === 'string').slice(0, 20).map(s => s.trim().slice(0, 80))
      : []
  };

  if (out.name.length < 2)                    return { error: 'A name is required.' };
  if (!out.brandLink)                         return { error: 'A brand or website link is required.' };
  if (out.phone.replace(/\D/g, '').length < 8) return { error: 'A usable phone number is required.' };
  if (!out.services.length)                   return { error: 'Choose at least one service.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.meetingDate)) return { error: 'A valid meeting date is required.' };

  /* reject dates in the past (one day of slack for timezone drift) */
  const picked = new Date(out.meetingDate + 'T00:00:00Z');
  if (Number.isNaN(picked.getTime())) return { error: 'A valid meeting date is required.' };
  if (picked.getTime() < Date.now() - 86400000) return { error: 'That date is in the past.' };

  return { value: out };
}

async function createMeeting(request, env) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);

  if (await overRateLimit(request, env)) {
    return json({ error: 'Too many requests. Please try again shortly.' }, 429);
  }

  /* Content-Length is absent on a chunked request, so the header alone is not
     a cap. Read the body and measure what actually arrived. */
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return json({ error: 'Payload too large.' }, 413);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ error: 'Payload too large.' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'Expected JSON.' }, 400); }

  const { error, value } = validate(body);
  if (error) return json({ error }, 400);

  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO meetings
       (id, created_at, name, brand_link, phone, services, meeting_date, message, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', '')`
  ).bind(
    id, new Date().toISOString(), value.name, value.brandLink, value.phone,
    JSON.stringify(value.services), value.meetingDate, value.message
  ).run();

  return json({ ok: true, id }, 201);
}

async function listMeetings(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 500);

  const q = STATUSES.includes(status)
    ? env.DB.prepare('SELECT * FROM meetings WHERE status = ? ORDER BY created_at DESC LIMIT ?').bind(status, limit)
    : env.DB.prepare('SELECT * FROM meetings ORDER BY created_at DESC LIMIT ?').bind(limit);

  const { results } = await q.all();
  const counts = await env.DB.prepare(
    'SELECT status, COUNT(*) AS n FROM meetings GROUP BY status'
  ).all();

  return json({
    meetings: (results || []).map(r => ({ ...r, services: JSON.parse(r.services || '[]') })),
    counts: Object.fromEntries((counts.results || []).map(r => [r.status, r.n]))
  });
}

async function updateMeeting(request, env, id) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Expected JSON.' }, 400); }

  const sets = [], vals = [];
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return json({ error: 'Unknown status.' }, 400);
    sets.push('status = ?'); vals.push(body.status);
  }
  if (body.notes !== undefined) { sets.push('notes = ?'); vals.push(str(body.notes, 4000)); }
  if (!sets.length) return json({ error: 'Nothing to update.' }, 400);

  vals.push(id);
  const res = await env.DB.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  if (!res.meta.changes) return json({ error: 'Not found.' }, 404);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);          /* the site, untouched */
    }

    if (path === '/api/meeting' && request.method === 'POST') {
      return createMeeting(request, env);
    }

    /* everything below is admin-only */
    if (path.startsWith('/api/meetings')) {
      if (!isAdmin(request, env)) {
        return json({ error: 'Unauthorised.' }, 401);
      }
      if (path === '/api/meetings' && request.method === 'GET') {
        return listMeetings(request, env);
      }
      const m = path.match(/^\/api\/meetings\/([A-Za-z0-9-]{6,40})$/);
      if (m && request.method === 'PATCH') {
        return updateMeeting(request, env, m[1]);
      }
    }

    return json({ error: 'Not found.' }, 404);
  }
};
