/**
 * WeWave — analytics collection and queries.
 *
 * Storage is D1, not Analytics Engine. The reasoning, since the brief asked for
 * AE by preference:
 *
 *   - AE is a sampled time-series store. It has no joins and no per-row read
 *     back, so a session timeline ("what did this visitor do, in order") and an
 *     exact funnel cannot be built from it.
 *   - Reading AE needs the account-level SQL API over HTTPS with a Cloudflare
 *     API token — a second secret in the Worker and an external round trip per
 *     dashboard load.
 *   - D1 is already bound here, gives exact counts at this site's traffic, and
 *     costs no new credentials.
 *
 * `writeEvent` is the only place rows are created, so adding AE later as a
 * second sink is a change in one function.
 *
 * Privacy: no IP address is stored or used as an identifier. The session id is
 * random and generated in the browser. Form values are never accepted — the
 * ingest endpoint whitelists fields and truncates the rest.
 */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

const MAX_BATCH = 60;                 /* events accepted in one request */
const MAX_BODY  = 64 * 1024;
const SESSION_GAP = 30 * 60 * 1000;   /* a session is continuous within 30 min */

/* Known types are documented; anything else matching the pattern is still
   accepted so new events can be added client-side without a Worker deploy. */
const TYPE_RE = /^[A-Z][A-Z0-9_]{1,40}$/;
const INTERACTION = new Set([
  'CLICK', 'TOUCH', 'CTA_CLICK', 'NAVIGATION_CLICK', 'LOGO_CLICK',
  'EXTERNAL_LINK_CLICK', 'SERVICE_VIEW', 'MEETING_MODAL_OPEN',
  'MEETING_FORM_START', 'MEETING_FORM_SUBMIT'
]);

const s = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : null);
const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);
const clamp01 = (v) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : null);

/* ---------------------------------------------------------------- schema */

let ensured = false;   /* per-isolate: the DDL runs once, not per request */

async function ensureSchema(env) {
  if (ensured) return;
  const stmts = [
    `CREATE TABLE IF NOT EXISTS a_event (
       id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL,
       session_id TEXT NOT NULL, type TEXT NOT NULL, path TEXT, section TEXT,
       element TEXT, label TEXT, x REAL, y REAL, scroll REAL,
       vw INTEGER, vh INTEGER, device TEXT, browser TEXT, os TEXT, country TEXT,
       is_test INTEGER NOT NULL DEFAULT 0, meta TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_a_event_ts ON a_event (ts)`,
    `CREATE INDEX IF NOT EXISTS idx_a_event_session ON a_event (session_id, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_a_event_type_ts ON a_event (type, ts)`,
    `CREATE INDEX IF NOT EXISTS idx_a_event_heat ON a_event (type, section, ts)`,
    `CREATE TABLE IF NOT EXISTS a_session (
       id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, last_at INTEGER NOT NULL,
       entry_path TEXT, exit_path TEXT, pageviews INTEGER NOT NULL DEFAULT 0,
       events INTEGER NOT NULL DEFAULT 0, interactions INTEGER NOT NULL DEFAULT 0,
       max_scroll REAL NOT NULL DEFAULT 0, device TEXT, browser TEXT, os TEXT,
       country TEXT, vw INTEGER, vh INTEGER, referrer TEXT, ref_source TEXT,
       utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT,
       utm_term TEXT, is_test INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS idx_a_session_started ON a_session (started_at)`,
    `CREATE INDEX IF NOT EXISTS idx_a_session_last ON a_session (last_at)`
  ];
  await env.DB.batch(stmts.map(q => env.DB.prepare(q)));

  /* Added after the first release; ALTER fails once the column exists, which
     is fine and is why each runs on its own. */
  for (const alter of [
    `ALTER TABLE a_session ADD COLUMN engaged_ms INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE a_session ADD COLUMN ua TEXT`
  ]) {
    try { await env.DB.prepare(alter).run(); } catch { /* already there */ }
  }
  ensured = true;
}

/* ------------------------------------------------- request fingerprinting */

/* Coarse buckets only. This is for "do mobile users behave differently", not
   for identifying anyone, so nothing here is combined into a fingerprint. */
function parseUA(ua = '') {
  const u = ua.toLowerCase();

  let device = 'desktop';
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(u)) device = 'tablet';
  else if (/mobi|iphone|ipod|android|blackberry|iemobile|opera mini/.test(u)) device = 'mobile';

  let browser = 'Other';
  if (/edg\//.test(u)) browser = 'Edge';
  else if (/opr\/|opera/.test(u)) browser = 'Opera';
  else if (/samsungbrowser/.test(u)) browser = 'Samsung Internet';
  else if (/chrome|crios/.test(u)) browser = 'Chrome';
  else if (/firefox|fxios/.test(u)) browser = 'Firefox';
  else if (/safari/.test(u)) browser = 'Safari';

  let os = 'Other';
  if (/windows/.test(u)) os = 'Windows';
  else if (/iphone|ipad|ipod|ios/.test(u)) os = 'iOS';
  else if (/mac os x|macintosh/.test(u)) os = 'macOS';
  else if (/android/.test(u)) os = 'Android';
  else if (/linux/.test(u)) os = 'Linux';

  return { device, browser, os };
}

/** Group a referrer into something worth putting on a chart. */
function refSource(referrer, host) {
  if (!referrer) return 'direct';
  let h;
  try { h = new URL(referrer).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return 'other'; }
  if (host && h === host.replace(/^www\./, '').toLowerCase()) return 'internal';
  if (/google\./.test(h)) return 'google';
  if (/instagram\./.test(h)) return 'instagram';
  if (/facebook\.|fb\./.test(h)) return 'facebook';
  if (/tiktok\./.test(h)) return 'tiktok';
  if (/linkedin\./.test(h) || h === 'lnkd.in') return 'linkedin';
  if (/t\.co$|twitter\.|x\.com$/.test(h)) return 'twitter';
  if (/youtube\.|youtu\.be/.test(h)) return 'youtube';
  if (/bing\./.test(h)) return 'bing';
  if (/wa\.me|whatsapp/.test(h)) return 'whatsapp';
  return h;
}

/* ------------------------------------------------------------- collection */

export async function collect(request, env) {
  if (!env.DB) return json({ ok: false }, 204);   /* never surface a failure to the page */

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY) return json({ ok: false }, 204);
    body = JSON.parse(raw);
  } catch { return json({ ok: false }, 204); }

  const events = Array.isArray(body && body.events) ? body.events.slice(0, MAX_BATCH) : [];
  if (!events.length) return json({ ok: true, stored: 0 });

  const sid = s(body.sid, 64);
  if (!sid || !/^[A-Za-z0-9_-]{8,64}$/.test(sid)) return json({ ok: false }, 204);

  const now = Date.now();
  const ua = request.headers.get('User-Agent') || '';
  const { device, browser, os } = parseUA(ua);
  const country = (request.cf && request.cf.country) || request.headers.get('CF-IPCountry') || null;
  const isTest = body.test ? 1 : 0;

  /* The client sends its own viewport and UTM values; everything identifying
     (country, device) is derived server-side from the request instead. */
  const ctx = body.ctx && typeof body.ctx === 'object' ? body.ctx : {};
  const host = (() => { try { return new URL(request.url).hostname; } catch { return ''; } })();
  const referrer = s(ctx.referrer, 300);

  try {
    await ensureSchema(env);

    const rows = [];
    let pageviews = 0, interactions = 0, maxScroll = 0, lastPath = null;
    /* A batch can arrive well after the events in it — a beacon at pagehide,
       or a flush that waited out the timer. Deriving the session's first and
       last activity from the events themselves stops a late delivery from
       inflating the session's span. */
    let firstTs = Infinity, lastTs = 0;
    let engaged = 0;

    for (const e of events) {
      if (!e || typeof e !== 'object') continue;
      const type = s(e.type, 42);
      if (!type || !TYPE_RE.test(type)) continue;

      /* The Worker clock is authoritative. The client sends an offset in ms so
         events inside a batch keep their order and spacing. */
      const back = n(e.dt);
      const ts = back !== null && back >= 0 && back < 6 * 60 * 60 * 1000 ? now - Math.round(back) : now;

      const path = s(e.path, 300) || '/';
      const scroll = n(e.scroll);
      if (type === 'PAGE_VIEW') pageviews++;
      if (INTERACTION.has(type)) interactions++;
      if (scroll !== null && scroll > maxScroll) maxScroll = Math.min(100, scroll);
      lastPath = path;
      if (ts < firstTs) firstTs = ts;
      if (ts > lastTs) lastTs = ts;
      /* the client reports cumulative engaged milliseconds; keep the largest */
      if (e.meta && typeof e.meta.engaged === 'number' && e.meta.engaged > engaged) {
        engaged = Math.min(e.meta.engaged, 12 * 60 * 60 * 1000);
      }

      rows.push(env.DB.prepare(
        `INSERT INTO a_event
           (ts, session_id, type, path, section, element, label, x, y, scroll,
            vw, vh, device, browser, os, country, is_test, meta)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      ).bind(
        ts, sid, type, path, s(e.section, 60), s(e.element, 160), s(e.label, 120),
        clamp01(e.x), clamp01(e.y), scroll === null ? null : Math.min(100, Math.max(0, scroll)),
        n(ctx.vw), n(ctx.vh), device, browser, os, country, isTest,
        e.meta && typeof e.meta === 'object' ? JSON.stringify(e.meta).slice(0, 500) : null
      ));
    }

    if (!rows.length) return json({ ok: true, stored: 0 });

    /* Upsert the session. started_at/entry_path stick to their first value;
       the counters accumulate. */
    rows.push(env.DB.prepare(
      `INSERT INTO a_session
         (id, started_at, last_at, entry_path, exit_path, pageviews, events,
          interactions, max_scroll, device, browser, os, country, vw, vh,
          referrer, ref_source, utm_source, utm_medium, utm_campaign,
          utm_content, utm_term, is_test, engaged_ms, ua)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         started_at   = MIN(a_session.started_at, excluded.started_at),
         last_at      = MAX(a_session.last_at, excluded.last_at),
         exit_path    = excluded.exit_path,
         pageviews    = a_session.pageviews + excluded.pageviews,
         events       = a_session.events + excluded.events,
         interactions = a_session.interactions + excluded.interactions,
         max_scroll   = MAX(a_session.max_scroll, excluded.max_scroll),
         engaged_ms   = MAX(a_session.engaged_ms, excluded.engaged_ms),
         ua           = COALESCE(a_session.ua, excluded.ua)`
    ).bind(
      sid, firstTs === Infinity ? now : firstTs, lastTs || now,
      lastPath, lastPath, pageviews, rows.length, interactions,
      maxScroll, device, browser, os, country, n(ctx.vw), n(ctx.vh),
      referrer, refSource(referrer, host),
      s(ctx.utm_source, 120), s(ctx.utm_medium, 120), s(ctx.utm_campaign, 120),
      s(ctx.utm_content, 120), s(ctx.utm_term, 120), isTest,
      engaged, ua.slice(0, 220)
    ));

    await env.DB.batch(rows);
    return json({ ok: true, stored: rows.length - 1 });
  } catch {
    /* Storage trouble must never become a visible failure on the site. */
    return json({ ok: false }, 204);
  }
}

/* ----------------------------------------------------------------- queries */

function window_(url) {
  const to = Number(url.searchParams.get('to')) || Date.now();
  const days = Number(url.searchParams.get('days'));
  const from = Number(url.searchParams.get('from')) ||
    (to - (isFinite(days) && days > 0 ? days : 7) * 86400000);
  const test = url.searchParams.get('test') === '1' ? 1 : 0;
  return { from, to, test };
}

const first = async (stmt) => (await stmt.first()) || {};
const all = async (stmt) => ((await stmt.all()).results || []);

async function overview(env, url) {
  const { from, to, test } = window_(url);

  const k = await first(env.DB.prepare(
    `SELECT COUNT(*) AS sessions,
            SUM(pageviews) AS pageviews,
            SUM(interactions) AS interactions,
            AVG(max_scroll) AS avg_scroll,
            AVG(CASE WHEN engaged_ms > 0 THEN engaged_ms/1000.0 END) AS avg_seconds,
            AVG(CASE WHEN last_at > started_at THEN (last_at - started_at)/1000.0 END) AS avg_span,
            SUM(CASE WHEN interactions = 0 AND engaged_ms < 10000 THEN 1 ELSE 0 END) AS bounced
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?`
  ).bind(test, from, to));

  const ctaRow = await first(env.DB.prepare(
    `SELECT COUNT(*) AS n FROM a_event
      WHERE is_test = ? AND ts BETWEEN ? AND ? AND type = 'CTA_CLICK'`
  ).bind(test, from, to));

  const submitRow = await first(env.DB.prepare(
    `SELECT COUNT(DISTINCT session_id) AS n FROM a_event
      WHERE is_test = ? AND ts BETWEEN ? AND ? AND type = 'MEETING_FORM_SUBMIT'`
  ).bind(test, from, to));

  /* daily buckets, in whole days back from `to` so the chart is stable */
  const trend = await all(env.DB.prepare(
    `SELECT CAST((? - started_at) / 86400000 AS INTEGER) AS days_ago,
            COUNT(*) AS sessions, SUM(pageviews) AS pageviews
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      GROUP BY days_ago ORDER BY days_ago DESC`
  ).bind(to, test, from, to));

  const devices = await all(env.DB.prepare(
    `SELECT COALESCE(device,'unknown') AS device, COUNT(*) AS n
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      GROUP BY device ORDER BY n DESC`
  ).bind(test, from, to));

  const pages = await all(env.DB.prepare(
    `SELECT COALESCE(path,'/') AS path, COUNT(*) AS views,
            COUNT(DISTINCT session_id) AS sessions
       FROM a_event WHERE is_test = ? AND ts BETWEEN ? AND ? AND type = 'PAGE_VIEW'
      GROUP BY path ORDER BY views DESC LIMIT 20`
  ).bind(test, from, to));

  const sources = await all(env.DB.prepare(
    `SELECT COALESCE(ref_source,'direct') AS source, COUNT(*) AS sessions
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      GROUP BY source ORDER BY sessions DESC LIMIT 12`
  ).bind(test, from, to));

  const sessions = k.sessions || 0;
  return json({
    range: { from, to },
    kpi: {
      sessions,
      pageviews: k.pageviews || 0,
      interactions: k.interactions || 0,
      avgSeconds: k.avg_seconds || 0,
      avgSpan: k.avg_span || 0,
      avgScroll: k.avg_scroll || 0,
      bounceRate: sessions ? (k.bounced || 0) / sessions : 0,
      ctaClicks: ctaRow.n || 0,
      meetingRequests: submitRow.n || 0,
      conversionRate: sessions ? (submitRow.n || 0) / sessions : 0
    },
    trend, devices, pages, sources
  });
}

async function heatmap(env, url) {
  const { from, to, test } = window_(url);
  const section = url.searchParams.get('section');
  const device = url.searchParams.get('device');
  const mode = (url.searchParams.get('mode') || 'clicks').toLowerCase();

  const types = mode === 'touch' ? ['TOUCH']
    : mode === 'move' ? ['MOVE']
    : ['CLICK', 'CTA_CLICK', 'NAVIGATION_CLICK', 'LOGO_CLICK', 'EXTERNAL_LINK_CLICK'];

  const where = [`is_test = ?`, `ts BETWEEN ? AND ?`, `x IS NOT NULL`, `y IS NOT NULL`,
    `type IN (${types.map(() => '?').join(',')})`];
  const bind = [test, from, to, ...types];
  if (section && section !== 'all') { where.push('section = ?'); bind.push(section); }
  if (device && device !== 'all') { where.push('device = ?'); bind.push(device); }

  const points = await all(env.DB.prepare(
    `SELECT ROUND(x, 4) AS x, ROUND(y, 4) AS y, COUNT(*) AS w
       FROM a_event WHERE ${where.join(' AND ')}
      GROUP BY ROUND(x, 3), ROUND(y, 3) ORDER BY w DESC LIMIT 4000`
  ).bind(...bind));

  const stats = await first(env.DB.prepare(
    `SELECT COUNT(*) AS total, COUNT(DISTINCT session_id) AS sessions
       FROM a_event WHERE ${where.join(' AND ')}`
  ).bind(...bind));

  const top = await all(env.DB.prepare(
    `SELECT COALESCE(element,'(unknown)') AS element,
            COALESCE(label,'') AS label, COUNT(*) AS n
       FROM a_event WHERE ${where.join(' AND ')}
      GROUP BY element, label ORDER BY n DESC LIMIT 12`
  ).bind(...bind));

  const scroll = await first(env.DB.prepare(
    `SELECT AVG(max_scroll) AS avg_scroll FROM a_session
      WHERE is_test = ? AND started_at BETWEEN ? AND ?
        ${device && device !== 'all' ? 'AND device = ?' : ''}`
  ).bind(...(device && device !== 'all' ? [test, from, to, device] : [test, from, to])));

  return json({ points, total: stats.total || 0, sessions: stats.sessions || 0, top, avgScroll: scroll.avg_scroll || 0 });
}

async function scrollDepth(env, url) {
  const { from, to, test } = window_(url);
  const rows = await all(env.DB.prepare(
    `SELECT max_scroll FROM a_session
      WHERE is_test = ? AND started_at BETWEEN ? AND ?`
  ).bind(test, from, to));

  const total = rows.length;
  const marks = [25, 50, 75, 90, 100];
  const reached = marks.map(m => ({
    depth: m,
    sessions: rows.filter(r => (r.max_scroll || 0) >= m - 0.001).length
  }));

  /* per-stage reach, using the stage windows the site itself is built on */
  const sections = await all(env.DB.prepare(
    `SELECT section, COUNT(DISTINCT session_id) AS sessions
       FROM a_event
      WHERE is_test = ? AND ts BETWEEN ? AND ? AND type = 'SECTION_VIEW' AND section IS NOT NULL
      GROUP BY section ORDER BY sessions DESC`
  ).bind(test, from, to));

  return json({
    total,
    avg: total ? rows.reduce((a, r) => a + (r.max_scroll || 0), 0) / total : 0,
    reached,
    sections
  });
}

async function sessions(env, url) {
  const { from, to, test } = window_(url);
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 300);
  const rows = await all(env.DB.prepare(
    `SELECT id, started_at, last_at, engaged_ms, ua, pageviews, events, interactions,
            max_scroll, device, browser, os, country, ref_source, utm_source, utm_campaign,
            entry_path, exit_path
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      ORDER BY started_at DESC LIMIT ?`
  ).bind(test, from, to, limit));
  return json({ sessions: rows });
}

async function sessionDetail(env, id) {
  const meta = await first(env.DB.prepare('SELECT * FROM a_session WHERE id = ?').bind(id));
  const events = await all(env.DB.prepare(
    `SELECT ts, type, path, section, element, label, scroll
       FROM a_event WHERE session_id = ? ORDER BY ts ASC, id ASC LIMIT 800`
  ).bind(id));
  return json({ session: meta, events });
}

async function pages(env, url) {
  const { from, to, test } = window_(url);
  const rows = await all(env.DB.prepare(
    `SELECT COALESCE(e.path,'/') AS path,
            SUM(CASE WHEN e.type='PAGE_VIEW' THEN 1 ELSE 0 END) AS views,
            COUNT(DISTINCT e.session_id) AS sessions,
            SUM(CASE WHEN e.type='CTA_CLICK' THEN 1 ELSE 0 END) AS cta,
            AVG(e.scroll) AS avg_scroll
       FROM a_event e
      WHERE e.is_test = ? AND e.ts BETWEEN ? AND ?
      GROUP BY path ORDER BY views DESC LIMIT 100`
  ).bind(test, from, to));

  const exits = await all(env.DB.prepare(
    `SELECT COALESCE(exit_path,'/') AS path, COUNT(*) AS exits
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      GROUP BY path`
  ).bind(test, from, to));
  const exitMap = Object.fromEntries(exits.map(r => [r.path, r.exits]));

  const dur = await all(env.DB.prepare(
    `SELECT COALESCE(entry_path,'/') AS path,
            AVG(CASE WHEN engaged_ms > 0 THEN engaged_ms/1000.0 END) AS avg_seconds
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      GROUP BY path`
  ).bind(test, from, to));
  const durMap = Object.fromEntries(dur.map(r => [r.path, r.avg_seconds]));

  return json({
    pages: rows.map(r => ({
      ...r,
      exits: exitMap[r.path] || 0,
      avgSeconds: durMap[r.path] || 0
    }))
  });
}

async function funnel(env, url) {
  const { from, to, test } = window_(url);
  const step = async (sql, ...extra) =>
    (await first(env.DB.prepare(sql).bind(test, from, to, ...extra))).n || 0;

  const visitors = await step(
    `SELECT COUNT(*) AS n FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?`);
  const sectionSeen = async (name) => step(
    `SELECT COUNT(DISTINCT session_id) AS n FROM a_event
      WHERE is_test = ? AND ts BETWEEN ? AND ? AND type='SECTION_VIEW' AND section = ?`, name);
  const evSeen = async (type) => step(
    `SELECT COUNT(DISTINCT session_id) AS n FROM a_event
      WHERE is_test = ? AND ts BETWEEN ? AND ? AND type = ?`, type);

  const steps = [
    { label: 'Visitors',        n: visitors },
    { label: 'Viewed services', n: await sectionSeen('services') },
    { label: 'Reached contact', n: await sectionSeen('contact') },
    { label: 'Clicked a CTA',   n: await evSeen('CTA_CLICK') },
    { label: 'Opened meeting',  n: await evSeen('MEETING_MODAL_OPEN') },
    { label: 'Started form',    n: await evSeen('MEETING_FORM_START') },
    { label: 'Submitted',       n: await evSeen('MEETING_FORM_SUBMIT') }
  ];
  return json({ steps });
}

async function sources(env, url) {
  const { from, to, test } = window_(url);
  const rows = await all(env.DB.prepare(
    `SELECT COALESCE(s.ref_source,'direct') AS source,
            COALESCE(s.utm_medium,'') AS medium,
            COALESCE(s.utm_campaign,'') AS campaign,
            COALESCE(s.utm_content,'') AS content,
            COALESCE(s.utm_term,'') AS term,
            COUNT(*) AS sessions,
            SUM(s.interactions) AS interactions,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM a_event e
               WHERE e.session_id = s.id AND e.type='CTA_CLICK') THEN 1 ELSE 0 END) AS cta_sessions,
            SUM(CASE WHEN EXISTS (
              SELECT 1 FROM a_event e
               WHERE e.session_id = s.id AND e.type='MEETING_FORM_SUBMIT') THEN 1 ELSE 0 END) AS conversions
       FROM a_session s
      WHERE s.is_test = ? AND s.started_at BETWEEN ? AND ?
      GROUP BY source, medium, campaign, content, term
      ORDER BY sessions DESC LIMIT 100`
  ).bind(test, from, to));
  return json({ sources: rows });
}

async function devices(env, url) {
  const { from, to, test } = window_(url);
  const by = async (col) => all(env.DB.prepare(
    `SELECT COALESCE(${col}, 'unknown') AS k, COUNT(*) AS n,
            AVG(max_scroll) AS avg_scroll,
            AVG(CASE WHEN engaged_ms > 0 THEN engaged_ms/1000.0 END) AS avg_seconds,
            SUM(interactions) AS interactions
       FROM a_session WHERE is_test = ? AND started_at BETWEEN ? AND ?
      GROUP BY k ORDER BY n DESC LIMIT 40`
  ).bind(test, from, to));

  const screens = await all(env.DB.prepare(
    `SELECT vw, vh, COUNT(*) AS n FROM a_session
      WHERE is_test = ? AND started_at BETWEEN ? AND ? AND vw IS NOT NULL
      GROUP BY vw, vh ORDER BY n DESC LIMIT 25`
  ).bind(test, from, to));

  return json({
    devices: await by('device'),
    browsers: await by('browser'),
    os: await by('os'),
    countries: await by('country'),
    screens
  });
}

async function events(env, url) {
  const { from, to, test } = window_(url);
  const type = url.searchParams.get('type');
  const bind = [test, from, to];
  let sql = `SELECT type, COUNT(*) AS n, COUNT(DISTINCT session_id) AS sessions
               FROM a_event WHERE is_test = ? AND ts BETWEEN ? AND ?`;
  if (type) { sql += ' AND type = ?'; bind.push(type); }
  sql += ' GROUP BY type ORDER BY n DESC LIMIT 100';
  const rows = await all(env.DB.prepare(sql).bind(...bind));

  const recent = await all(env.DB.prepare(
    `SELECT ts, session_id, type, section, element, label, scroll
       FROM a_event WHERE is_test = ? AND ts BETWEEN ? AND ?
      ORDER BY ts DESC LIMIT 100`
  ).bind(test, from, to));

  return json({ types: rows, recent });
}

/** Near-real-time: everything in the last few minutes. */
async function realtime(env, url) {
  const test = url.searchParams.get('test') === '1' ? 1 : 0;
  const now = Date.now();
  const active = await first(env.DB.prepare(
    `SELECT COUNT(*) AS n FROM a_session WHERE is_test = ? AND last_at >= ?`
  ).bind(test, now - 5 * 60 * 1000));

  const feed = await all(env.DB.prepare(
    `SELECT ts, session_id, type, section, element, label, scroll, device, country
       FROM a_event WHERE is_test = ? AND ts >= ?
      ORDER BY ts DESC LIMIT 40`
  ).bind(test, now - 30 * 60 * 1000));

  return json({ active: active.n || 0, feed, now });
}

/** Deletes development/test rows. Never touches production rows. */
async function purgeTest(env) {
  await ensureSchema(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM a_event WHERE is_test = 1'),
    env.DB.prepare('DELETE FROM a_session WHERE is_test = 1')
  ]);
  return json({ ok: true });
}

/** Removes one session and its events — for clearing out a known bad visit. */
async function deleteSession(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM a_event WHERE session_id = ?').bind(id),
    env.DB.prepare('DELETE FROM a_session WHERE id = ?').bind(id)
  ]);
  return json({ ok: true, deleted: id });
}

/**
 * Wipes live analytics so a launch starts from zero. Requires ?confirm=RESET
 * so it cannot happen by mistake, and leaves `meetings` untouched.
 */
async function resetLive(env, url) {
  if (url.searchParams.get('confirm') !== 'RESET') {
    return json({ error: 'Add ?confirm=RESET to proceed.' }, 400);
  }
  await ensureSchema(env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM a_event WHERE is_test = 0'),
    env.DB.prepare('DELETE FROM a_session WHERE is_test = 0')
  ]);
  return json({ ok: true });
}

/** Admin-only query router. Auth is checked by the caller. */
export async function query(request, env, path) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);
  const url = new URL(request.url);
  try {
    await ensureSchema(env);
    switch (path) {
      case '/api/a/overview':  return overview(env, url);
      case '/api/a/heatmap':   return heatmap(env, url);
      case '/api/a/scroll':    return scrollDepth(env, url);
      case '/api/a/sessions':  return sessions(env, url);
      case '/api/a/pages':     return pages(env, url);
      case '/api/a/funnel':    return funnel(env, url);
      case '/api/a/sources':   return sources(env, url);
      case '/api/a/devices':   return devices(env, url);
      case '/api/a/events':    return events(env, url);
      case '/api/a/realtime':  return realtime(env, url);
      case '/api/a/purge-test':
        if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
        return purgeTest(env);
      case '/api/a/reset-live':
        if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
        return resetLive(env, url);
    }
    const m = path.match(/^\/api\/a\/session\/([A-Za-z0-9_-]{8,64})$/);
    if (m) {
      if (request.method === 'DELETE') return deleteSession(env, m[1]);
      return sessionDetail(env, m[1]);
    }
    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    return json({ error: 'Query failed.', detail: String(err && err.message || err).slice(0, 200) }, 500);
  }
}
