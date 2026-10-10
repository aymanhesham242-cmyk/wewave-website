/**
 * WeWave — Case Study Analytics: storage API.
 *
 * Case studies are internal working documents, so every route here is
 * admin-only. Authentication is checked by the caller in `worker/index.js`
 * against the same ADMIN_TOKEN as the meetings and analytics APIs -- there is
 * no second secret to manage, and no public read path at all.
 *
 *   GET    /api/cases        list — summaries only, no document bodies
 *   GET    /api/cases/:id    one case study, in full
 *   PUT    /api/cases/:id    create or replace
 *   DELETE /api/cases/:id    remove
 *
 * The document itself is stored as JSON in one column. The shape belongs to
 * `admin/case-studies/engine.js`, which normalises whatever it reads back, so
 * the Worker deliberately does not model campaigns, ad sets or ads. What it
 * does keep alongside the document is a handful of denormalised summary
 * columns, so the library list can render without parsing every document.
 * Those summaries are supplied by the client, which computes them with the
 * same engine that renders the dashboard a moment earlier.
 *
 * Nothing here talks to Meta. The figures are hypothetical by design.
 */

const MAX_DOC = 512 * 1024;      /* a large case study is ~40KB; this is abuse-sized */

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });

let ensured = false;   /* per-isolate: the DDL runs once, not per request */

async function ensureSchema(env) {
  if (ensured) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS case_study (
         id          TEXT PRIMARY KEY,
         created_at  TEXT NOT NULL,
         updated_at  TEXT NOT NULL,
         brand       TEXT,
         title       TEXT,
         industry    TEXT,
         objective   TEXT,
         currency    TEXT,
         start_date  TEXT,
         end_date    TEXT,
         spend       REAL    NOT NULL DEFAULT 0,
         results     INTEGER NOT NULL DEFAULT 0,
         revenue     REAL    NOT NULL DEFAULT 0,
         roas        REAL,
         campaigns   INTEGER NOT NULL DEFAULT 0,
         doc         TEXT NOT NULL
       )`
    ),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_case_updated ON case_study (updated_at DESC)')
  ]);
  ensured = true;
}

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const nOrZero = v => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const nOrNull = v => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Ids are minted client-side by the engine; accept only that shape. */
const ID = /^[A-Za-z0-9_-]{3,64}$/;

async function listCases(env) {
  const { results } = await env.DB.prepare(
    `SELECT id, created_at, updated_at, brand, title, industry, objective, currency,
            start_date, end_date, spend, results, revenue, roas, campaigns
       FROM case_study
      ORDER BY updated_at DESC
      LIMIT 500`
  ).all();
  return json({ cases: results || [] });
}

async function getCase(env, id) {
  const row = await env.DB.prepare('SELECT doc FROM case_study WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Not found.' }, 404);
  try {
    return json({ case: JSON.parse(row.doc) });
  } catch {
    /* A document that will not parse is worse than one that is missing: the
       client would render half a case study. Say so plainly instead. */
    return json({ error: 'That case study is stored in an unreadable state.' }, 500);
  }
}

async function putCase(request, env, id) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_DOC) return json({ error: 'Case study too large.' }, 413);

  let body;
  try {
    const raw = await request.text();
    if (raw.length > MAX_DOC) return json({ error: 'Case study too large.' }, 413);
    body = JSON.parse(raw);
  } catch { return json({ error: 'Expected JSON.' }, 400); }

  const doc = body && body.case;
  if (!doc || typeof doc !== 'object') return json({ error: 'No case study in the request.' }, 400);
  if (doc.id !== id) return json({ error: 'The document id does not match the URL.' }, 400);

  const s = body.summary || {};
  const now = new Date().toISOString();
  const created = str(doc.createdAt, 40) || now;

  await env.DB.prepare(
    `INSERT INTO case_study
       (id, created_at, updated_at, brand, title, industry, objective, currency,
        start_date, end_date, spend, results, revenue, roas, campaigns, doc)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       updated_at = excluded.updated_at, brand = excluded.brand, title = excluded.title,
       industry = excluded.industry, objective = excluded.objective,
       currency = excluded.currency, start_date = excluded.start_date,
       end_date = excluded.end_date, spend = excluded.spend, results = excluded.results,
       revenue = excluded.revenue, roas = excluded.roas, campaigns = excluded.campaigns,
       doc = excluded.doc`
  ).bind(
    id, created, now,
    str(doc.brand, 200), str(doc.title, 200), str(doc.industry, 120),
    str(doc.objective, 80), str(doc.currency, 8),
    str(doc.startDate, 10), str(doc.endDate, 10),
    nOrZero(s.spend), Math.round(nOrZero(s.results)), nOrZero(s.revenue), nOrNull(s.roas),
    Array.isArray(doc.campaigns) ? doc.campaigns.length : 0,
    JSON.stringify(doc)
  ).run();

  return json({ ok: true, id, updatedAt: now });
}

async function deleteCase(env, id) {
  const res = await env.DB.prepare('DELETE FROM case_study WHERE id = ?').bind(id).run();
  if (!res.meta.changes) return json({ error: 'Not found.' }, 404);
  return json({ ok: true });
}

/** Admin-only router. Auth is checked by the caller. */
export async function handle(request, env, path) {
  if (!env.DB) return json({ error: 'Storage is not configured.' }, 503);

  try {
    await ensureSchema(env);

    if (path === '/api/cases') {
      if (request.method !== 'GET') return json({ error: 'Use GET.' }, 405);
      return listCases(env);
    }

    const m = path.match(/^\/api\/cases\/([^/]+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (!ID.test(id)) return json({ error: 'Bad case study id.' }, 400);
      if (request.method === 'GET')    return getCase(env, id);
      if (request.method === 'PUT')    return putCase(request, env, id);
      if (request.method === 'DELETE') return deleteCase(env, id);
      return json({ error: 'Use GET, PUT or DELETE.' }, 405);
    }

    return json({ error: 'Not found.' }, 404);
  } catch (err) {
    return json({
      error: 'Case study storage failed.',
      detail: String((err && err.message) || err).slice(0, 200)
    }, 500);
  }
}
