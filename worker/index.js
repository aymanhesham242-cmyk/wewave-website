/**
 * WeWave — Worker in front of the static site.
 *
 * Everything that isn't /api/* is handed straight to the static assets, so the
 * site behaves exactly as before. The API adds:
 *
 *   POST  /api/meeting        public — a visitor submitting the booking form
 *   POST  /api/a              public — analytics ingest (see analytics.js)
 *   GET   /api/meetings       admin  — list requests
 *   PATCH /api/meetings/:id   admin  — set status / notes
 *   GET   /api/a/*            admin  — analytics queries
 *   /api/cases, /api/cases/:id admin — case study store
 *
 * Admin routes require `Authorization: Bearer <ADMIN_TOKEN>`, where ADMIN_TOKEN
 * is a Worker secret. They fail closed: with no secret set, nothing is
 * readable. The /admin page itself is a static shell containing no data — it
 * is useless without a token, so it does not need protecting separately.
 * Failed token checks are throttled per address — see `requireAdmin`.
 *
 * Both public routes are rate limited through `submit_log`, which costs one
 * indexed read per request and keeps only a SHA-256 of the address.
 *
 * Secrets:
 *   ADMIN_TOKEN       required — every admin route fails closed without it
 *   LEAD_WEBHOOK_URL  optional — where to announce a new lead; see notifyLead
 */

import { collect as collectAnalytics, query as queryAnalytics } from './analytics.js';
import { handle as handleCases } from './case-studies.js';

const MAX_BODY = 16 * 1024;          /* a booking request is ~1KB; anything larger is abuse */
const STATUSES = ['new', 'contacted', 'booked', 'archived'];

/* Sliding-window limits, per address, per bucket. Windows are in seconds.
 *
 *   meeting   — a human books once; five tries in ten minutes is already
 *               generous, and the mailto fallback catches anyone blocked.
 *   analytics — one visitor flushes at most every 5s per tab, so ~60 requests
 *               in five minutes per tab. 240 leaves room for several tabs and
 *               a shared office address while still capping a flood.
 *   adminfail — only *failed* token checks are counted, so a legitimate owner
 *               never writes a row here.
 */
const RATE = {
  meeting:   { max: 5,   window: 10 * 60 },
  analytics: { max: 240, window: 5 * 60 },
  adminfail: { max: 10,  window: 15 * 60 }
};
const RATE_KEEP = 60 * 60;          /* how long log rows are worth keeping */

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
   one source, without keeping a log of visitors' IP addresses. The bucket is
   folded into the hash so two limits can share `submit_log` without one
   bucket's traffic counting against another's. */
async function addressKey(bucket, ip) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bucket + '|' + ip));
  return [...new Uint8Array(buf)].slice(0, 16).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sliding-window limit, shared by every rate-limited route.
 *
 * Fails OPEN on any storage error, in all three buckets. A booking from a real
 * customer is worth more than a strictly enforced limit; locking the owner out
 * of their own admin panel because D1 hiccuped would be worse than the brute
 * force it is meant to slow down.
 */
/**
 * Create the booking tables if they are not there.
 *
 * `meetings` and `submit_log` predate this file and were made by hand in the
 * D1 console, so they existed in production and nowhere else: a restored
 * database, a second environment or a local `wrangler dev` all answered the
 * booking form with "no such table: meetings" — a 500 on the one route the
 * business depends on. The analytics tables never had that problem because
 * they build themselves, so the booking tables now do too.
 *
 * Every statement is IF NOT EXISTS, and `schema/meetings.sql` holds the same
 * DDL in readable form. Runs once per isolate, not once per request.
 */
let coreReady = false;
async function ensureCoreSchema(env) {
  if (coreReady || !env.DB) return;
  try {
    await env.DB.batch([
      env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS meetings (
           id TEXT PRIMARY KEY, created_at TEXT NOT NULL, name TEXT NOT NULL,
           brand_link TEXT NOT NULL, phone TEXT NOT NULL, services TEXT NOT NULL,
           meeting_date TEXT NOT NULL, message TEXT,
           status TEXT NOT NULL DEFAULT 'new', notes TEXT NOT NULL DEFAULT '')`),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_meetings_created ON meetings (created_at DESC)'),
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings (status)'),
      env.DB.prepare('CREATE TABLE IF NOT EXISTS submit_log (ip TEXT NOT NULL, at INTEGER NOT NULL)'),
      /* `submit_log` used to be read once per booking, so a scan was fine. The
         analytics bucket reads it on every ingest request, which is not. */
      env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_submit_log_ip_at ON submit_log (ip, at)')
    ]);
    coreReady = true;
  } catch (e) {
    /* Leave coreReady false so the next request tries again. */
    console.error('core schema check failed: ' + (e && e.message));
  }
}

async function overRateLimit(request, env, bucket, record = true) {
  const limit = RATE[bucket];
  const ip = request.headers.get('CF-Connecting-IP');
  if (!limit || !ip || !env.DB) return false;     /* nothing to key on */
  try {
    await ensureCoreSchema(env);
    const key = await addressKey(bucket, ip);
    const now = Math.floor(Date.now() / 1000);

    const row = await env.DB
      .prepare('SELECT COUNT(*) AS n FROM submit_log WHERE ip = ? AND at >= ?')
      .bind(key, now - limit.window).first();
    if (row && row.n >= limit.max) return true;

    /* `record: false` is for buckets where only some outcomes count. The admin
       bucket counts failures only — charging a row for every successful call
       would let the dashboard's own polling lock the owner out of it. */
    if (!record) return false;
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

/** Record one failed admin token check, so repeats can be throttled. */
async function noteAuthFailure(request, env) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip || !env.DB) return;
  try {
    const key = await addressKey('adminfail', ip);
    await env.DB.prepare('INSERT INTO submit_log (ip, at) VALUES (?, ?)')
      .bind(key, Math.floor(Date.now() / 1000)).run();
  } catch { /* a missed count must never break the response */ }
}

/**
 * Admin gate with brute-force throttling.
 *
 * The token is the only thing standing in front of every lead's name, phone
 * number and message, and the endpoints answer in milliseconds, so an
 * unthrottled guess is cheap. Only failures are counted: a correct token never
 * writes a row, so normal use costs one read and nothing else.
 */
async function requireAdmin(request, env) {
  /* The token is checked first, and only a failure consults the throttle.
     Checking the throttle first meant ten wrong guesses from any address --
     an office, a mobile carrier's NAT, a bored visitor -- locked the owner
     out of their own dashboard for fifteen minutes with the correct token in
     hand. Comparing the token costs nothing and leaks nothing: it is a
     constant-time compare against a secret the guesser does not have, so a
     brute-forcer still gets 429 and learns no more than before. */
  if (isAdmin(request, env)) return null;

  if (await overRateLimit(request, env, 'adminfail', false)) {
    return json({ error: 'Too many attempts. Please try again later.' }, 429);
  }
  await noteAuthFailure(request, env);
  return json({ error: 'Unauthorised.' }, 401);                                     /* null means: allowed */
}

/**
 * Tell someone a lead arrived.
 *
 * Until this is configured a meeting request lands in D1 and nothing happens:
 * the only way to learn about it is to open /admin and look. That is the
 * single biggest gap between this site and a working lead pipeline.
 *
 * Set the `LEAD_WEBHOOK_URL` secret to any endpoint that accepts a JSON POST
 * — a Slack or Discord incoming webhook, or a free Make/Zapier/n8n scenario
 * that turns it into an email or a WhatsApp message. With no secret set this
 * is inert and the behaviour is exactly as before; it is never the system of
 * record, which is always the `meetings` table.
 *
 * Deliberately omitted from the payload: the phone number and the free-text
 * message. Those are the visitor's personal details and they stay in D1
 * behind the admin token rather than being copied into a chat history. The
 * notification says who got in touch and links to the panel holding the rest.
 */
async function notifyLead(env, value, id) {
  const url = (env.LEAD_WEBHOOK_URL || '').trim();
  if (!url || !/^https:\/\//i.test(url)) return;

  const text =
    `New meeting request from ${value.name}\n` +
    `Brand: ${value.brandLink}\n` +
    `Services: ${value.services.join(', ')}\n` +
    `Preferred date: ${value.meetingDate}\n` +
    `Phone and message are in the panel: /admin  (ref ${id.slice(0, 8)})`;

  /* Abort rather than hang: a slow third party must not hold a Worker open. */
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      /* `text` and `content` cover Slack and Discord; anything else can read
         the structured fields beside them. */
      body: JSON.stringify({
        text, content: text,
        lead: {
          id, name: value.name, brandLink: value.brandLink,
          services: value.services, meetingDate: value.meetingDate
        }
      }),
      signal: ctl.signal
    });
    if (!res.ok) console.warn('lead webhook returned ' + res.status);
  } catch (e) {
    /* The lead is already stored. A failed ping is worth a log line, not an error. */
    console.warn('lead webhook failed: ' + (e && e.name));
  } finally {
    clearTimeout(timer);
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

async function createMeeting(request, env, ctx) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);

  if (await overRateLimit(request, env, 'meeting')) {
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
  try {
    await ensureCoreSchema(env);
    await env.DB.prepare(
      `INSERT INTO meetings
         (id, created_at, name, brand_link, phone, services, meeting_date, message, status, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'new', '')`
    ).bind(
      id, new Date().toISOString(), value.name, value.brandLink, value.phone,
      JSON.stringify(value.services), value.meetingDate, value.message
    ).run();
  } catch (e) {
    /* An unhandled throw here became a bare 500, which the modal could only
       report as "could not send that". The visitor sees the same friendly
       fallback either way, but now the cause is in the logs and the status
       code says it is us, not them. Never echo `e` to the client: it carries
       table and column names. */
    console.error('meeting insert failed: ' + (e && e.message));
    return json({ error: 'We could not save that just now. Please try again shortly.' }, 503);
  }

  /* The lead is safely stored before anything else is attempted. The ping goes
     out after the response, so a slow or broken webhook costs the visitor
     nothing and can never turn a captured lead into an error on the page. */
  const ping = notifyLead(env, value, id);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(ping);

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
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith('/api/')) {
      return env.ASSETS.fetch(request);          /* the site, untouched */
    }

    if (path === '/api/meeting' && request.method === 'POST') {
      return createMeeting(request, env, ctx);
    }

    /* Liveness, and -- with a token -- readiness.
       The public form answers from the Worker alone and touches no storage,
       so an uptime monitor hitting it every minute cannot cost D1 reads or be
       turned into a probe against the database. `?deep=1` runs a trivial
       query and is admin-only for the same reason. Neither form returns
       anything about visitors, the schema, or the environment. */
    if (path === '/api/health') {
      if (url.searchParams.get('deep') !== '1') {
        return json({ ok: true, service: 'wewave', time: new Date().toISOString() });
      }
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      let db = 'down';
      try {
        if (env.DB) { await env.DB.prepare('SELECT 1 AS ok').first(); db = 'up'; }
        else db = 'unbound';
      } catch { db = 'down'; }
      return json({ ok: db === 'up', db, time: new Date().toISOString() }, db === 'up' ? 200 : 503);
    }

    /* Analytics ingest — public, like the booking form. It answers 204 on any
       problem so a storage fault can never surface as an error on the site.
       Rate-limited because it shares a database with the bookings: an
       unthrottled writer here could spend the day's D1 write allowance and
       take the lead form down with it. */
    if (path === '/api/a' && request.method === 'POST') {
      try {
        if (await overRateLimit(request, env, 'analytics')) {
          return new Response(null, { status: 204 });
        }
        return await collectAnalytics(request, env);
      } catch {
        return new Response(null, { status: 204 });
      }
    }

    /* Analytics reads are admin-only, on the same token as the meetings API. */
    if (path.startsWith('/api/a/')) {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      return queryAnalytics(request, env, path);
    }

    /* Case study simulator storage — admin-only, same token. These documents
       are hypothetical figures for internal case studies; there is no public
       read path and nothing here connects to any ad platform. */
    if (path === '/api/cases' || path.startsWith('/api/cases/')) {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
      return handleCases(request, env, path);
    }

    /* everything below is admin-only */
    if (path.startsWith('/api/meetings')) {
      const denied = await requireAdmin(request, env);
      if (denied) return denied;
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
