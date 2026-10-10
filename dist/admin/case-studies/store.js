/**
 * WeWave — Case Study Analytics: persistence.
 *
 * D1 is the store, reached through the admin API on the same token as the rest
 * of the admin area. On top of it sits a local mirror in `localStorage`, which
 * exists for one reason: a case study represents real work, and losing half an
 * hour of it to a dropped connection is worse than the small cost of keeping a
 * second copy.
 *
 * The rules that keep the two from drifting:
 *
 *   - Every save writes the local mirror FIRST and synchronously. That write
 *     cannot fail on a network, so the editing experience is never blocked.
 *   - The remote write follows. If it fails the record is marked dirty and
 *     retried, and the UI says so rather than showing a tick it has not earned.
 *   - On load, the server wins. A dirty local record is pushed up before the
 *     list is read, so the newer local edit is not quietly overwritten by the
 *     older server copy.
 *
 * Every method resolves to a result object rather than throwing, so a storage
 * fault surfaces as a visible state in the interface instead of a dead page.
 */

import { makeCaseStudy, totals, num } from './engine.js';

const TOKEN_KEY = 'wewave_admin_token';    /* shared with the other admin pages */
const CACHE_KEY = 'wewave_cases_v1';
const DIRTY_KEY = 'wewave_cases_dirty_v1';

/**
 * Standalone mode — the single-file build (`tools/build_case_standalone.py`).
 *
 * That copy is opened straight from disk with no server and no Worker behind
 * it, so there is no API to reach and no token to hold. Browser storage is not
 * a fallback there, it is the whole store: nothing is ever "pending sync", and
 * the interface says "Saved in this browser" rather than implying a server
 * copy exists somewhere.
 */
const STANDALONE = typeof window !== 'undefined' && window.__WEWAVE_CASE_STANDALONE__ === true;

export const isStandalone = () => STANDALONE;

/* ------------------------------------------------------------ local mirror */

/**
 * Local storage can be absent, full, or disabled outright — private windows, a
 * browser set to block site data, an embedded preview pane, or a `file://` page
 * in a browser that treats it as an opaque origin.
 *
 * Falling back to nothing is what an earlier build did, and the result was the
 * worst kind of failure: every save silently evaporated and the library came up
 * empty with no explanation. So the fallback is an in-memory store. The tool
 * still works for the session, Export still gets the work out, and
 * `storageAvailable()` lets the interface say plainly that nothing will survive
 * a reload rather than pretending it saved.
 */
let memory = {};
let persists = null;          /* null until probed, then true/false */

/** Probe once with a real write — feature detection alone misses blocked writes. */
function probe() {
  if (persists !== null) return persists;
  try {
    const k = '__ww_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    persists = true;
  } catch {
    persists = false;
  }
  return persists;
}

/** True when changes survive a reload. False means memory-only for this session. */
export function storageAvailable() { return probe(); }

function readLocal(key, fallback) {
  if (!probe()) {
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : fallback;
  }
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function writeLocal(key, value) {
  if (!probe()) {
    /* Clone so a later mutation of the caller's object cannot rewrite history. */
    memory[key] = JSON.parse(JSON.stringify(value));
    return true;
  }
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch { return false; }
}

const cache      = () => readLocal(CACHE_KEY, {});
const dirtySet   = () => readLocal(DIRTY_KEY, {});
const setCache   = v => writeLocal(CACHE_KEY, v);
const setDirty   = v => writeLocal(DIRTY_KEY, v);

function markDirty(id, on) {
  if (STANDALONE) return;          /* nothing to sync to, so nothing is dirty */
  const d = dirtySet();
  if (on) d[id] = Date.now(); else delete d[id];
  setDirty(d);
}

export function isDirty(id) {
  return Object.prototype.hasOwnProperty.call(dirtySet(), id);
}

export function dirtyCount() {
  return Object.keys(dirtySet()).length;
}

/* --------------------------------------------------------------- the token */

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

export function setToken(t) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch { /* remote-only session */ }
}

export function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing to clear */ }
}

/* ----------------------------------------------------------------- the API */

/** Raised only for a rejected token, so the caller can re-gate the page. */
export class Unauthorised extends Error {
  constructor() { super('unauthorised'); this.name = 'Unauthorised'; }
}

async function api(path, opts) {
  if (STANDALONE) throw new Error('This copy stores case studies in this browser.');
  const o = opts || {};
  const res = await fetch(path, {
    ...o,
    headers: {
      'Authorization': 'Bearer ' + getToken(),
      'Content-Type': 'application/json',
      ...(o.headers || {})
    }
  });
  if (res.status === 401) throw new Unauthorised();
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* handled below */ }
  if (!res.ok) {
    const msg = (data && data.error) || ('Request failed (' + res.status + ')');
    throw new Error(msg);
  }
  if (!data) throw new Error('The server sent an unreadable response.');
  return data;
}

/** The headline figures stored alongside a document for the library list. */
function summarise(cs) {
  const t = totals(cs);
  return {
    spend: num(t.spend),
    results: num(t.results),
    revenue: num(t.revenue),
    roas: t.roas === null ? null : num(t.roas)
  };
}

/** The library row for a case study held only in the local mirror. */
function localSummary(cs) {
  const s = summarise(cs);
  return {
    id: cs.id, brand: cs.brand, title: cs.title, industry: cs.industry,
    objective: cs.objective, currency: cs.currency,
    start_date: cs.startDate, end_date: cs.endDate,
    created_at: cs.createdAt, updated_at: cs.updatedAt,
    campaigns: (cs.campaigns || []).length,
    spend: s.spend, results: s.results, revenue: s.revenue, roas: s.roas
  };
}

/* -------------------------------------------------------------- operations */

/**
 * Push anything the mirror is still holding, then list what the server has.
 *
 * Returns `{ cases, online, error }`. `online: false` is not a failure -- it
 * means the list came from the local mirror and the UI should say so.
 */
export async function list() {
  let pushError = null;
  try { await syncDirty(); } catch (e) {
    if (e instanceof Unauthorised) throw e;
    pushError = e.message;
  }

  try {
    const data = await api('/api/cases');
    const cases = data.cases || [];

    /* Anything held locally that the server has never seen still belongs in
       the list -- it is usually a save made while the connection was down. */
    const seen = new Set(cases.map(c => c.id));
    const extras = Object.values(cache())
      .filter(cs => cs && cs.id && !seen.has(cs.id))
      .map(localSummary);

    return {
      cases: [...cases, ...extras].sort((a, b) =>
        String(b.updated_at || '').localeCompare(String(a.updated_at || ''))),
      online: true,
      error: pushError
    };
  } catch (e) {
    if (e instanceof Unauthorised) throw e;
    const local = Object.values(cache()).filter(Boolean).map(localSummary)
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    return { cases: local, online: false, error: e.message };
  }
}

/**
 * Load one case study.
 *
 * A dirty local copy is newer than the server's by definition, so it wins.
 * Otherwise the server is authoritative, and the mirror is refreshed from it.
 */
export async function get(id) {
  if (isDirty(id)) {
    const local = cache()[id];
    if (local) return { case: makeCaseStudy(local), online: false, error: null };
  }

  try {
    const data = await api('/api/cases/' + encodeURIComponent(id));
    const cs = makeCaseStudy(data.case);
    const c = cache(); c[id] = cs; setCache(c);
    return { case: cs, online: true, error: null };
  } catch (e) {
    if (e instanceof Unauthorised) throw e;
    const local = cache()[id];
    if (local) return { case: makeCaseStudy(local), online: false, error: e.message };
    return { case: null, online: false, error: e.message };
  }
}

/**
 * Save a case study.
 *
 * The local write happens first and always. The return value reports what
 * actually reached the server, so the interface can show "saved" and "saved
 * locally, not yet synced" as the different things they are.
 */
export async function save(cs) {
  cs.updatedAt = new Date().toISOString();

  const c = cache(); c[cs.id] = cs;
  const localOk = setCache(c);
  markDirty(cs.id, true);

  /* In standalone the local write IS the save, so report it as done rather
     than as something still waiting to reach a server. */
  if (STANDALONE) return { synced: true, local: localOk, error: null };

  try {
    await api('/api/cases/' + encodeURIComponent(cs.id), {
      method: 'PUT',
      body: JSON.stringify({ case: cs, summary: summarise(cs) })
    });
    markDirty(cs.id, false);
    return { synced: true, local: localOk, error: null };
  } catch (e) {
    if (e instanceof Unauthorised) throw e;
    return { synced: false, local: localOk, error: e.message };
  }
}

export async function remove(id) {
  const c = cache(); delete c[id]; setCache(c);
  markDirty(id, false);

  if (STANDALONE) return { synced: true, error: null };

  try {
    await api('/api/cases/' + encodeURIComponent(id), { method: 'DELETE' });
    return { synced: true, error: null };
  } catch (e) {
    if (e instanceof Unauthorised) throw e;
    /* A 404 means it was never on the server — the local delete was the whole
       job, so that is a success, not a failure to report. */
    if (/not found/i.test(e.message)) return { synced: true, error: null };
    return { synced: false, error: e.message };
  }
}

/** Retry every pending local write. Called before a list, and by the UI. */
export async function syncDirty() {
  if (STANDALONE) return { pushed: 0, failed: 0 };
  const d = dirtySet();
  const ids = Object.keys(d);
  if (!ids.length) return { pushed: 0, failed: 0 };

  const c = cache();
  let pushed = 0, failed = 0, lastError = null;

  for (const id of ids) {
    const cs = c[id];
    if (!cs) { markDirty(id, false); continue; }
    try {
      await api('/api/cases/' + encodeURIComponent(id), {
        method: 'PUT',
        body: JSON.stringify({ case: cs, summary: summarise(cs) })
      });
      markDirty(id, false);
      pushed++;
    } catch (e) {
      if (e instanceof Unauthorised) throw e;
      failed++; lastError = e.message;
    }
  }

  if (failed) {
    const err = new Error(lastError || 'Some changes could not be synced.');
    err.pushed = pushed; err.failed = failed;
    throw err;
  }
  return { pushed, failed };
}

/** Seed the library on a genuinely empty first run. */
export async function seed(cases) {
  for (const cs of cases) await save(cs);
}
