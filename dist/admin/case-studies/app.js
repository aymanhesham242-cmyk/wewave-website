/**
 * WeWave — Case Study Analytics: the interface.
 *
 * This file renders and wires. It holds no formulas: every number it shows
 * comes from `engine.js`, which is the only place arithmetic happens. That
 * separation is what the brief asks for, and it is also what makes the
 * consistency guarantee cheap to keep -- there is no second code path that
 * could round, sum or divide differently from the first.
 *
 * Rendering is a full redraw from state. At the sizes involved (a few hundred
 * rows at most) that is far cheaper than the bugs a diffing layer would invite,
 * and it means the table can never display a value the model no longer holds.
 *
 * Nothing here contacts any advertising platform. The only network calls are
 * to this site's own admin API, described in `store.js`.
 */

import * as E from './engine.js';
import * as Store from './store.js';
import { TEMPLATES, fromTemplate, blankCaseStudy, demoLibrary } from './presets.js';
import { lineChart, sparkline } from './charts.js';

/* --------------------------------------------------------------- shorthand */

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const esc = s => String(s === null || s === undefined ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

function elem(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/* ------------------------------------------------------------------- state */

const state = {
  cs: null,              /* the open case study */
  library: [],           /* summary rows for the sidebar */
  online: true,
  level: 'campaign',     /* which tab the table is showing */
  view: 'performance',   /* performance | charts | both */
  expanded: new Set(),   /* ids of expanded rows in the campaign view */
  selected: new Set(),
  sort: { key: 'spend', dir: 'desc' },
  search: '',
  libSearch: '',
  filters: { status: 'all', objective: 'all', platform: 'all', placement: 'all',
             minSpend: '', minResults: '' },
  columns: ['delivery','budget','spend','results','costPerResult','reach','impressions','ctr','cpc','cpm','roas'],
  present: false,
  saving: false,
  dirty: false,

  /* Display-order cache — see `sortRows`. `structureV` is bumped whenever a
     row is added, removed or a different case study is opened, which is what
     invalidates the remembered order. */
  structureV: 0,
  orderSig: '',
  order: new Map(),

  /* Breakdown groups the current level by a dimension and prints a subtotal
     header above each group. It changes how rows are ARRANGED, never what they
     contain -- the figures are the same `rollup` values either way. */
  breakdown: 'none',
  libraryOpen: window.matchMedia('(min-width: 981px)').matches,
  libraryUserSet: false
};

/** Rows were added or removed: the remembered display order no longer applies. */
function structureChanged() { state.structureV++; }

/** Columns the user can switch on, beyond the identity columns. */
const COLUMN_DEFS = [
  { key:'delivery',      label:'Delivery',     kind:'meta' },
  { key:'budget',        label:'Budget',       kind:'meta' },
  { key:'objective',     label:'Objective',    kind:'meta' },
  { key:'spend',         label:'Amount spent', kind:'metric' },
  { key:'results',       label:'Results',      kind:'metric' },
  { key:'costPerResult', label:'Cost per result', kind:'metric' },
  { key:'reach',         label:'Reach',        kind:'metric' },
  { key:'impressions',   label:'Impressions',  kind:'metric' },
  { key:'frequency',     label:'Frequency',    kind:'metric' },
  { key:'clicks',        label:'Link clicks',  kind:'metric' },
  { key:'ctr',           label:'CTR',          kind:'metric' },
  { key:'cpc',           label:'CPC',          kind:'metric' },
  { key:'cpm',           label:'CPM',          kind:'metric' },
  { key:'conversions',   label:'Conversions',  kind:'metric' },
  { key:'cvr',           label:'Conversion rate', kind:'metric' },
  { key:'revenue',       label:'Conversion value', kind:'metric' },
  { key:'roas',          label:'ROAS',         kind:'metric' },
  { key:'cpmReach',      label:'Cost per 1,000 reached', kind:'metric' }
];

const colDef = key => COLUMN_DEFS.find(c => c.key === key);

/* -------------------------------------------------------------- formatting */

const cur = () => (state.cs ? state.cs.currency : 'EGP');
const f  = (key, value, compact) => E.fmtMetric(key, value, cur(), compact);

/* ------------------------------------------------------------------ toasts */

function toast(message, kind) {
  const t = elem('div', 'toast' + (kind ? ' ' + kind : ''), message);
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 320);
  }, kind === 'bad' ? 5200 : 2400);
}

/* ------------------------------------------------------------------ saving */

let saveTimer = null;

/**
 * Persist after a short pause.
 *
 * Every edit calls this. The debounce means holding a key down or dragging
 * through several cells is one write, not twenty, and `store.save` has already
 * put the change in the local mirror synchronously -- so the delay costs
 * nothing that could be lost.
 */
function scheduleSave() {
  state.dirty = true;
  renderSync();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(commitSave, 700);
}

async function commitSave() {
  if (!state.cs) return;
  state.saving = true;
  renderSync();
  try {
    const res = await Store.save(state.cs);
    state.dirty = !res.synced;
    state.online = res.synced;
    if (!res.synced) {
      if (!res.local) toast('This browser is blocking local storage, and the server could not be reached. Copy your work out with Export.', 'bad');
    }
    await refreshLibrary();
  } catch (err) {
    if (err instanceof Store.Unauthorised) return lock('That token was not accepted.');
    state.online = false;
  } finally {
    state.saving = false;
    renderSync();
  }
}

/** The edit-then-save cycle every mutation goes through. */
function mutate(fn) {
  if (!state.cs) return;
  fn(state.cs);
  scheduleSave();
  render();
}

/* ------------------------------------------------------------------ popover */

let openPopEl = null;

function closePop() {
  if (openPopEl) { openPopEl.remove(); openPopEl = null; }
  document.removeEventListener('mousedown', onDocDown, true);
  document.removeEventListener('keydown', onPopKey, true);
}

function onDocDown(e) {
  if (openPopEl && !openPopEl.contains(e.target)) closePop();
}
function onPopKey(e) {
  if (e.key === 'Escape') closePop();
}

/** Open a popover anchored under `anchor`, kept inside the viewport. */
function popover(anchor, build) {
  closePop();
  const pop = elem('div', 'pop');
  build(pop, closePop);
  document.body.appendChild(pop);

  const r = anchor.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  let left = r.left;
  if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
  let top = r.bottom + window.scrollY + 5;
  if (r.bottom + h > window.innerHeight - 8 && r.top > h + 12) {
    top = r.top + window.scrollY - h - 5;
  }
  pop.style.left = left + 'px';
  pop.style.top = top + 'px';

  openPopEl = pop;
  /* Deferred so the click that opened it does not immediately close it. */
  setTimeout(() => {
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onPopKey, true);
  }, 0);
  return pop;
}

function popItem(pop, label, onClick, opts) {
  const o = opts || {};
  const b = elem('button', 'pop-item' + (o.on ? ' on' : '') + (o.danger ? ' danger' : ''), label);
  b.onclick = () => { onClick(); };
  pop.appendChild(b);
  return b;
}

/* ------------------------------------------------------------------- modal */

function modal(title, bodyBuild, footBuild) {
  const scrim = elem('div', 'scrim');
  const box = elem('div', 'modal');
  const head = elem('div', 'modal-head');
  head.appendChild(elem('h2', null, title));
  const body = elem('div', 'modal-body');
  const foot = elem('div', 'modal-foot');

  box.append(head, body, foot);
  bodyBuild(body);

  const close = () => { scrim.remove(); box.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };

  footBuild(foot, close);
  scrim.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, box);
  return close;
}

function confirmBox(title, message, confirmLabel, onYes) {
  modal(title, body => {
    body.appendChild(elem('p', null, message));
  }, (foot, close) => {
    const cancel = elem('button', 'btn', 'Cancel');
    cancel.onclick = close;
    const go = elem('button', 'btn btn-danger', confirmLabel);
    go.onclick = () => { close(); onYes(); };
    foot.append(cancel, go);
  });
}

/* ---------------------------------------------------------------- inline edit */

/**
 * Turn a cell into an input, commit on Enter or blur, abandon on Escape.
 *
 * `commit` receives the raw string. Returning false rejects the value and
 * leaves the old one in place.
 */
function editCell(cell, current, commit, opts) {
  const o = opts || {};
  if (cell.querySelector('input')) return;

  const prev = cell.innerHTML;
  const input = elem('input', 'edit');
  input.type = 'text';
  input.value = current === null || current === undefined ? '' : String(current);
  if (o.placeholder) input.placeholder = o.placeholder;

  cell.textContent = '';
  cell.appendChild(input);
  input.focus();
  input.select();

  let done = false;
  const finish = save => {
    if (done) return;
    done = true;
    const value = input.value;
    /* Restore first: `commit` triggers a full re-render, and leaving a live
       input in the DOM while that happens is how focus gets stranded. */
    cell.innerHTML = prev;
    if (save) commit(value);
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  input.addEventListener('blur', () => finish(true));
}

/* ------------------------------------------------------------------- rows */

/** Flatten the tree into the rows the current level should show. */
function visibleRows() {
  const cs = state.cs;
  if (!cs) return [];
  const rows = [];
  const q = state.search.trim().toLowerCase();

  const matches = node => {
    if (!q) return true;
    return String(node.name || '').toLowerCase().includes(q);
  };
  /**
   * Placement and platform live on ad sets, so a campaign has none of its own.
   * A parent therefore matches when any ad set beneath it matches — otherwise
   * filtering by placement in the Campaigns view would empty the table.
   */
  const fieldMatches = (node, field, want) => {
    if (want === 'all') return true;
    if (node[field] !== undefined) return node[field] === want;
    let hit = false;
    E.walk(node, n => { if (!hit && n[field] === want) hit = true; });
    return hit;
  };

  const passesFilters = node => {
    const f = state.filters;
    if (f.status !== 'all' && node.status !== f.status) return false;
    if (f.objective !== 'all' && node.objective && node.objective !== f.objective) return false;
    if (!fieldMatches(node, 'platform', f.platform)) return false;
    if (!fieldMatches(node, 'placement', f.placement)) return false;

    if (f.minSpend !== '' || f.minResults !== '') {
      const t = E.rollup(node);
      if (f.minSpend !== '' && t.spend < E.num(f.minSpend)) return false;
      if (f.minResults !== '' && t.results < E.num(f.minResults)) return false;
    }
    return true;
  };

  if (state.level === 'campaign') {
    for (const c of cs.campaigns) {
      /* A campaign stays visible when a descendant matches the search, so the
         search never hides the path to the thing it found. */
      const deepMatch = q && (c.adsets.some(s => matches(s) || s.ads.some(matches)));
      if (!passesFilters(c)) continue;
      if (!matches(c) && !deepMatch) continue;

      rows.push({ node: c, parent: cs, depth: 1, kind: 'Campaign' });
      if (state.expanded.has(c.id)) {
        for (const s of c.adsets) {
          rows.push({ node: s, parent: c, depth: 2, kind: 'Ad set' });
          if (state.expanded.has(s.id)) {
            for (const a of s.ads) rows.push({ node: a, parent: s, depth: 3, kind: 'Ad' });
          }
        }
      }
    }
  } else if (state.level === 'adset') {
    for (const c of cs.campaigns) {
      for (const s of c.adsets) {
        if (!passesFilters(s) || !matches(s)) continue;
        rows.push({ node: s, parent: c, depth: 1, kind: 'Ad set', under: c.name });
      }
    }
  } else {
    for (const c of cs.campaigns) {
      for (const s of c.adsets) {
        for (const a of s.ads) {
          if (!passesFilters(a) || !matches(a)) continue;
          rows.push({ node: a, parent: s, depth: 1, kind: 'Ad', under: c.name + ' › ' + s.name });
        }
      }
    }
  }

  sortRows(rows);
  return rows;
}

/**
 * What the current display order depends on.
 *
 * Deliberately excludes the metric values themselves. See `sortRows`.
 */
function orderSignature() {
  return [state.level, state.sort.key, state.sort.dir, state.search,
          JSON.stringify(state.filters), state.breakdown, state.structureV].join('|');
}

/**
 * Sort within a level, then hold that order steady.
 *
 * Sorting on every render sounds right and is not: the table is sorted by
 * amount spent, you edit a row's spend, and the row you are working on leaps to
 * the far end of the table. In a tool whose whole purpose is editing numbers
 * that happens constantly, and you lose your place every time.
 *
 * So the order is computed once per "situation" -- a level, sort column, search,
 * filter and structure -- and cached per parent. Editing a value re-renders
 * every figure but leaves the rows where they are. Changing the sort, adding or
 * deleting something, or switching level recomputes it.
 *
 * The cache is keyed per parent rather than as one flat list so that expanding
 * a row mid-session sorts its newly revealed children properly instead of
 * dumping them at the bottom.
 */
function sortRows(rows) {
  const sig = orderSignature();
  if (sig !== state.orderSig) {
    state.orderSig = sig;
    state.order = new Map();
  }

  const { key, dir } = state.sort;
  const sign = dir === 'asc' ? 1 : -1;

  const value = node => {
    if (key === 'name') return String(node.name || '').toLowerCase();
    if (key === 'delivery') return String(node.status || '');
    if (key === 'budget') return E.num(node.budget);
    if (key === 'objective') return String(node.objective || '');
    const v = E.metricsOf(node)[key];
    return v === null || v === undefined ? -Infinity : v;
  };

  const cmp = (a, b) => {
    const va = value(a.node), vb = value(b.node);
    if (typeof va === 'string' || typeof vb === 'string') {
      return String(va).localeCompare(String(vb)) * sign;
    }
    return (va - vb) * sign;
  };

  /* Order one sibling group: replay the cached order if we have one, otherwise
     sort by the chosen column and remember it. */
  const orderGroup = (groupId, list) => {
    const cached = state.order.get(groupId);
    if (cached) {
      const at = new Map(cached.map((id, i) => [id, i]));
      list.sort((a, b) => {
        const ia = at.has(a.node.id) ? at.get(a.node.id) : Infinity;
        const ib = at.has(b.node.id) ? at.get(b.node.id) : Infinity;
        return ia === ib ? cmp(a, b) : ia - ib;
      });
    } else {
      list.sort(cmp);
    }
    state.order.set(groupId, list.map(r => r.node.id));
  };

  if (state.level !== 'campaign') { orderGroup('flat', rows); return; }

  /* Group-aware: order each parent's children among themselves, then rebuild
     the flat list so an ad can never sort out from under its ad set. */
  const byParent = new Map();
  for (const r of rows) {
    const pid = r.parent ? r.parent.id : 'root';
    if (!byParent.has(pid)) byParent.set(pid, []);
    byParent.get(pid).push(r);
  }
  for (const [pid, list] of byParent) orderGroup(pid, list);

  const out = [];
  const emit = pid => {
    for (const r of (byParent.get(pid) || [])) {
      out.push(r);
      emit(r.node.id);
    }
  };
  emit(state.cs.id);
  rows.length = 0;
  rows.push(...out);
}

/** The dimensions a row can be grouped by, and where each one is read from. */
const BREAKDOWNS = {
  none:      { label: 'None',      of: null },
  status:    { label: 'Delivery',  of: n => n.status && n.status.charAt(0).toUpperCase() + n.status.slice(1) },
  objective: { label: 'Objective', of: n => n.objective },
  platform:  { label: 'Platform',  of: n => n.platform },
  placement: { label: 'Placement', of: n => n.placement },
  format:    { label: 'Ad format', of: n => n.format }
};

/**
 * Split rows into labelled groups for the Breakdown control.
 *
 * Returns a flat list with `{ group: label, rows: [...] }` markers, or null
 * when no breakdown is active. A node that does not carry the dimension (an ad
 * has no placement, for instance) falls into "Not set" rather than vanishing.
 */
function groupRows(rows) {
  const def = BREAKDOWNS[state.breakdown];
  if (!def || !def.of) return null;

  const groups = new Map();
  for (const r of rows) {
    const key = def.of(r.node) || 'Not set';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    .map(([label, list]) => ({ label, rows: list }));
}

/* ------------------------------------------------------------------ render */

function render() {
  if (!state.cs) { renderEmptyApp(); renderToolbar(); return; }
  renderHeader();
  renderCounts();
  renderCards();
  renderCharts();
  renderTable();
  renderIssues();
  renderLibrary();
  renderSync();
  renderToolbar();
}

/** Bulk actions only mean anything with a selection, so they follow it. */
function renderToolbar() {
  const n = state.selected.size;
  for (const id of ['#dupRowBtn', '#delRowBtn', '#statusBtn']) $(id).disabled = n === 0;
  $('#editRowBtn').disabled = n !== 1;      /* Edit acts on exactly one row */
  $('#dupRowBtn').textContent = n > 1 ? 'Duplicate (' + n + ')' : 'Duplicate';
  $('#delRowBtn').textContent = n > 1 ? 'Delete (' + n + ')' : 'Delete';

  /* Say how many filters are on. A table that looks empty because of a filter
     set three minutes ago is otherwise indistinguishable from lost data. */
  const active = Object.values(state.filters).filter(v => v !== 'all' && v !== '').length;
  const btn = $('#filterBtn');
  btn.textContent = active ? 'Filters (' + active + ')' : 'Filters';
  btn.classList.toggle('btn-primary', active > 0);

  /* Name the active breakdown on the control, so grouped rows are never a
     mystery the user has to open a menu to explain. */
  const bd = $('#breakdownBtn');
  const on = state.breakdown !== 'none';
  bd.textContent = on ? 'Breakdown: ' + BREAKDOWNS[state.breakdown].label : 'Breakdown';
  bd.classList.toggle('btn-primary', on);
}

function renderEmptyApp() {
  $('#cards').innerHTML = '';
  $('#charts').innerHTML = '';
  $('#gridHead').innerHTML = '';
  $('#gridBody').innerHTML = '';
  $('#gridFoot').innerHTML = '';

  /* Clear the header too. Deleting the last case study used to leave its brand
     name, counts and date range sitting in the top bar above an empty table. */
  $('#acctAvatar').textContent = '–';
  $('#acctName').textContent = 'No case study open';
  $('#acctMeta').textContent = '';
  $('#dateLabel').textContent = '—';
  $('#cntCampaigns').textContent = '0';
  $('#cntAdsets').textContent = '0';
  $('#cntAds').textContent = '0';
  $('#issuesCount').textContent = '0';
  $('#issuesCount').classList.add('zero');

  const empty = $('#emptyState');
  empty.hidden = false;
  empty.innerHTML =
    '<h3>No case study open</h3>' +
    '<p>Create one from scratch, or start from a preset and edit every number afterwards.</p>';
  const row = elem('div');
  const a = elem('button', 'btn btn-primary', 'New case study');
  a.onclick = newCaseStudy;
  const b = elem('button', 'btn', 'Start from a preset');
  b.onclick = e => presetsPopover(e.currentTarget);
  row.append(a, document.createTextNode(' '), b);
  empty.appendChild(row);
  renderLibrary();
  renderSync();
}

function renderHeader() {
  const cs = state.cs;
  $('#acctAvatar').textContent = (cs.brand || '?').trim().charAt(0).toUpperCase() || '?';
  $('#acctName').textContent = cs.brand;
  $('#acctMeta').textContent = cs.industry ? '· ' + cs.industry : '';
  $('#dateLabel').textContent = E.fmtDateRange(cs.startDate, cs.endDate);
}

function renderCounts() {
  const cs = state.cs;
  const adsets = cs.campaigns.reduce((a, c) => a + c.adsets.length, 0);
  const ads = cs.campaigns.reduce((a, c) => a + c.adsets.reduce((b, s) => b + s.ads.length, 0), 0);
  $('#cntCampaigns').textContent = cs.campaigns.length;
  $('#cntAdsets').textContent = adsets;
  $('#cntAds').textContent = ads;
}

/**
 * Show or hide the case study library panel.
 *
 * `byUser` marks a deliberate toggle, which then survives window resizes --
 * otherwise a resize would keep overriding a choice the user just made.
 */
function setLibrary(open, byUser) {
  state.libraryOpen = open;
  if (byUser) state.libraryUserSet = true;
  const side = $('#side');
  if (side) side.classList.toggle('collapsed', !open);
  const btn = $('#railLibrary');
  if (btn) btn.classList.toggle('on', open);
}

function renderSync() {
  const el = $('#sync');
  const text = $('#syncText');
  const standalone = Store.isStandalone();
  el.classList.toggle('is-saving', state.saving);
  el.classList.toggle('is-dirty', !standalone && !state.saving && state.dirty);
  el.classList.toggle('is-off', !standalone && !state.saving && !state.dirty && !state.online);

  /* No persistence at all — say so outright. An earlier build let this fail
     silently, and the library simply came up empty every time. */
  if (!Store.storageAvailable()) {
    text.textContent = 'Not saving — this session only';
    el.classList.remove('is-saving', 'is-dirty');
    el.classList.add('is-off');
    el.title = 'This browser is blocking storage for this page, so nothing will ' +
               'survive a reload. Use Export to keep your work.';
    return;
  }

  if (state.saving) text.textContent = 'Saving…';
  else if (Store.isStandalone()) text.textContent = 'Saved in this browser';
  else if (state.dirty) text.textContent = 'Saved on this device';
  else if (!state.online) text.textContent = 'Offline';
  else text.textContent = 'Saved';

  el.title = Store.isStandalone()
    ? 'This copy saves to this browser. Use Export to take a case study elsewhere.'
    : state.dirty
      ? 'Your changes are stored in this browser and will sync when the server is reachable again.'
      : 'Changes are stored in the site database.';
}

/* -------------------------------------------------------------- top cards */

const CARD_METRICS = ['spend','results','reach','impressions','ctr','cpc','cpm','roas'];

function renderCards() {
  const cs = state.cs;
  const t = E.totals(cs);
  const host = $('#cards');
  host.innerHTML = '';

  const s = E.series(cs, cs, CARD_METRICS);

  for (const key of CARD_METRICS) {
    const card = elem('div', 'card');
    const label = elem('div', 'card-label');
    label.appendChild(document.createTextNode(
      key === 'results' ? (cs.resultLabel || 'Results') : E.METRICS[key].label));
    card.appendChild(label);

    card.appendChild(elem('div', 'card-value', f(key, t[key], true)));

    const foot = elem('div', 'card-foot');
    foot.appendChild(elem('span', 'card-sub', cardSub(key, t)));
    const spark = elem('div', 'card-spark');
    foot.appendChild(spark);
    card.appendChild(foot);

    host.appendChild(card);
    sparkline(spark, s.values[key] || [], '#0866FF');
  }
}

/** The small line under each card — a second, related figure rather than a repeat. */
function cardSub(key, t) {
  const days = E.daysBetween(state.cs.startDate, state.cs.endDate);
  switch (key) {
    case 'spend':       return f('spend', E.round(t.spend / days, 2), true) + ' / day';
    case 'results':     return f('costPerResult', t.costPerResult) + ' per result';
    case 'reach':       return t.frequency === null ? '—' : f('frequency', t.frequency) + ' frequency';
    case 'impressions': return f('clicks', t.clicks, true) + ' link clicks';
    case 'ctr':         return f('cvr', t.cvr) + ' conversion rate';
    case 'cpc':         return f('clicks', t.clicks, true) + ' clicks';
    case 'cpm':         return f('cpmReach', t.cpmReach) + ' per 1k reached';
    case 'roas':        return f('revenue', t.revenue, true) + ' value';
    default:            return '';
  }
}

/* ----------------------------------------------------------------- charts */

const CHART_DEFS = [
  { key: 'spend',   title: 'Amount spent over time' },
  { key: 'results', title: 'Results over time' },
  { key: 'revenue', title: 'Conversion value over time' },
  { key: 'roas',    title: 'ROAS over time' },
  { key: 'ctr',     title: 'CTR over time' }
];

function renderCharts() {
  const host = $('#charts');
  /* The three views are table only, charts only, and both. */
  host.hidden = state.view === 'performance';
  const table = document.querySelector('.table-wrap');
  if (table) table.hidden = state.view === 'charts';
  if (host.hidden) return;

  const cs = state.cs;
  const keys = CHART_DEFS.map(c => c.key);
  const s = E.series(cs, cs, keys);
  const t = E.totals(cs);
  host.innerHTML = '';

  for (const def of CHART_DEFS) {
    const card = elem('div', 'chart-card');
    const head = elem('div', 'chart-head');
    head.appendChild(elem('div', 'chart-title',
      def.key === 'results' ? (cs.resultLabel || 'Results') + ' over time' : def.title));
    head.appendChild(elem('div', 'chart-total',
      (E.METRICS[def.key].kind === 'core' ? 'Total ' : 'Overall ') + f(def.key, t[def.key], true)));
    card.appendChild(head);

    const body = elem('div', 'chart-body');
    card.appendChild(body);
    host.appendChild(card);

    lineChart(body, {
      dates: s.dates,
      values: s.values[def.key] || [],
      label: def.title,
      colour: '#0866FF',
      format: v => f(def.key, v, true)
    });
  }

  const note = elem('p', 'chart-note',
    'Daily shape is modelled from the period totals using the trend set in Case study settings — ' +
    'each series adds up to exactly the figure on the card above. The case study stores period ' +
    'totals, not a day-by-day log.');
  note.style.gridColumn = '1 / -1';
  host.appendChild(note);
}

/* ------------------------------------------------------------------ table */

function renderTable() {
  const rows = visibleRows();
  const empty = $('#emptyState');

  $('#gridHead').innerHTML = '';
  $('#gridBody').innerHTML = '';
  $('#gridFoot').innerHTML = '';

  if (!rows.length) {
    empty.hidden = false;
    const has = state.cs.campaigns.length > 0;
    empty.innerHTML = has
      ? '<h3>Nothing matches</h3><p>No ' + levelWord(true) + ' match the current search or filters. Filtering never changes the stored data.</p>'
      : '<h3>No campaigns yet</h3><p>Add a campaign to start building this case study.</p>';
    const b = elem('button', 'btn btn-primary', has ? 'Clear search and filters' : '+ Add campaign');
    b.onclick = has
      ? () => {
          state.search = '';
          $('#rowSearch').value = '';
          state.filters = { status: 'all', objective: 'all', platform: 'all',
                            placement: 'all', minSpend: '', minResults: '' };
          render();
        }
      : addAtLevel;
    empty.appendChild(b);
    return;
  }
  empty.hidden = true;

  renderHead(rows);
  const body = $('#gridBody');
  const groups = groupRows(rows);

  if (groups) {
    for (const g of groups) {
      body.appendChild(groupHeaderRow(g));
      for (const r of g.rows) body.appendChild(renderRow(r));
    }
  } else {
    for (const r of rows) body.appendChild(renderRow(r));
  }
  renderFoot(rows);
}

/**
 * One subtotal row per breakdown group.
 *
 * The subtotal is summed from the same `rollup` the rows themselves display,
 * so a group can never disagree with the rows under it.
 */
function groupHeaderRow(g) {
  const tr = elem('tr', 'group-row');

  const core = E.emptyMetrics();
  for (const r of g.rows) {
    const t = E.rollup(r.node);
    for (const k of E.CORE) core[k] += t[k];
  }
  const calc = E.derive(core);
  const all = { ...core, ...calc };

  const label = elem('td', 'sticky-1');
  label.colSpan = 3;
  label.textContent = g.label + '  (' + g.rows.length + ')';
  tr.appendChild(label);

  for (const key of state.columns) {
    const def = colDef(key);
    const td = elem('td', def && def.kind === 'metric' ? 'cell-num' : '');
    if (def && def.kind === 'metric') td.textContent = f(key, all[key]);
    tr.appendChild(td);
  }
  return tr;
}

function levelWord(plural) {
  const w = state.level === 'campaign' ? 'campaign' : state.level === 'adset' ? 'ad set' : 'ad';
  return plural ? w + 's' : w;
}

function renderHead(rows) {
  const tr = elem('tr');

  const th0 = elem('th', 'col-check sticky-1');
  const all = elem('input');
  all.type = 'checkbox';
  all.checked = rows.length > 0 && rows.every(r => state.selected.has(r.node.id));
  all.onchange = () => {
    if (all.checked) rows.forEach(r => state.selected.add(r.node.id));
    else state.selected.clear();
    render();
  };
  th0.appendChild(all);
  tr.appendChild(th0);

  tr.appendChild(elem('th', 'col-toggle sticky-2', 'Off / On'));

  const thName = elem('th', 'col-name sticky-3 sortable' +
    (state.sort.key === 'name' ? ' is-sorted' : ''));
  thName.appendChild(headInner(levelWord(false) === 'campaign' ? 'Campaign'
    : levelWord(false) === 'ad set' ? 'Ad set' : 'Ad', 'name'));
  thName.onclick = () => toggleSort('name');
  tr.appendChild(thName);

  for (const key of state.columns) {
    const def = colDef(key);
    if (!def) continue;
    const th = elem('th', (def.kind === 'metric' ? 'cell-num ' : '') + 'sortable' +
      (state.sort.key === key ? ' is-sorted' : ''));
    th.appendChild(headInner(
      key === 'results' ? (state.cs.resultLabel || 'Results') : def.label, key));
    th.onclick = () => toggleSort(key);
    tr.appendChild(th);
  }

  $('#gridHead').appendChild(tr);
}

function headInner(label, key) {
  const span = elem('span', 'th-in');
  span.appendChild(document.createTextNode(label));
  const mark = elem('span', 'sort-mark',
    state.sort.key === key ? (state.sort.dir === 'asc' ? '▲' : '▼') : '⇅');
  span.appendChild(mark);
  return span;
}

function toggleSort(key) {
  if (state.sort.key === key) {
    state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    state.sort.key = key;
    state.sort.dir = (key === 'name' || key === 'delivery' || key === 'objective') ? 'asc' : 'desc';
  }
  render();
}

function renderRow(r) {
  const node = r.node;
  const m = E.metricsOf(node);
  const tr = elem('tr', 'row-indent-' + r.depth + ' lvl-' +
    (r.kind === 'Campaign' ? 'campaign' : r.kind === 'Ad set' ? 'adset' : 'ad'));
  tr.dataset.id = node.id;
  if (state.selected.has(node.id)) tr.classList.add('is-selected');

  /* checkbox */
  const tdC = elem('td', 'col-check sticky-1');
  const cb = elem('input');
  cb.type = 'checkbox';
  cb.checked = state.selected.has(node.id);
  cb.onchange = () => {
    if (cb.checked) state.selected.add(node.id); else state.selected.delete(node.id);
    render();
  };
  tdC.appendChild(cb);
  tr.appendChild(tdC);

  /* on / off */
  const tdT = elem('td', 'col-toggle sticky-2');
  const tg = elem('button', 'toggle' + (node.status === 'active' ? ' on' : '') +
                            (node.status === 'paused' ? ' paused' : ''));
  tg.title = 'Status: ' + node.status;
  tg.onclick = () => mutate(() => {
    node.status = node.status === 'active' ? 'paused' : 'active';
  });
  tdT.appendChild(tg);
  tr.appendChild(tdT);

  /* name + hover actions */
  const tdN = elem('td', 'col-name sticky-3');
  const wrap = elem('div', 'name-cell');
  const line = elem('div', 'row-name');

  const hasKids = E.childrenOf(node).length > 0;
  const tw = elem('button', 'twisty' +
    (state.level === 'campaign' && hasKids ? '' : ' leaf') +
    (state.expanded.has(node.id) ? ' open' : ''));
  tw.innerHTML = '<svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 1l4 4-4 4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  tw.onclick = () => {
    if (state.expanded.has(node.id)) state.expanded.delete(node.id);
    else state.expanded.add(node.id);
    render();
  };
  line.appendChild(tw);

  const name = elem('span', 'name-link', node.name);
  name.title = 'Click to rename';
  name.onclick = () => editCell(name, node.name, v => mutate(() => {
    node.name = String(v).trim().slice(0, 160) || node.name;
  }));
  line.appendChild(name);

  if (r.under) {
    const under = elem('span', 'row-kind', r.under.length > 34 ? r.under.slice(0, 33) + '…' : r.under);
    under.title = r.under;
    line.appendChild(under);
  }
  wrap.appendChild(line);

  const actions = elem('div', 'row-actions');
  const addLabel = r.kind === 'Campaign' ? '+ Ad set' : r.kind === 'Ad set' ? '+ Ad' : null;
  if (addLabel) {
    const add = elem('button', 'btn btn-sm', addLabel);
    add.onclick = () => addUnder(node);
    actions.appendChild(add);
  }
  const dup = elem('button', 'btn btn-sm', 'Duplicate');
  dup.onclick = () => duplicateNode(node, r.parent);
  const del = elem('button', 'btn btn-sm', 'Delete');
  del.onclick = () => deleteNode(node, r.parent, r.kind);
  actions.append(dup, del);
  wrap.appendChild(actions);

  tdN.appendChild(wrap);
  tr.appendChild(tdN);

  for (const key of state.columns) tr.appendChild(renderCell(node, key, m));
  return tr;
}

function renderCell(node, key, m) {
  const def = colDef(key);

  if (key === 'delivery') {
    const td = elem('td');
    const d = elem('span', 'delivery ' + node.status);
    d.appendChild(elem('span', 'dot ' + node.status));
    d.appendChild(document.createTextNode(
      node.status.charAt(0).toUpperCase() + node.status.slice(1)));
    d.style.cursor = 'pointer';
    d.onclick = e => statusPopover(e.currentTarget, [node]);
    td.appendChild(d);
    return td;
  }

  if (key === 'objective') {
    const td = elem('td');
    if (node.objective === undefined) { td.appendChild(elem('span', 'cell-empty', '—')); return td; }
    const v = elem('span', 'editable', node.objective);
    v.onclick = e => objectivePopover(e.currentTarget, node);
    td.appendChild(v);
    return td;
  }

  if (key === 'budget') {
    const td = elem('td');
    const box = elem('div', 'budget-cell');
    if (node.budget === undefined) {
      /* An ad has no budget of its own — the ad set above it holds it, exactly
         as the reference shows. */
      box.appendChild(elem('span', 'cell-empty', '—'));
      box.appendChild(elem('span', 'budget-sub', 'Using ad set budget'));
    } else if (!E.num(node.budget)) {
      const v = elem('span', 'editable cell-empty', 'Set budget');
      v.onclick = () => editCell(v, '', val => mutate(() => { node.budget = E.num(val); }));
      box.appendChild(v);
      box.appendChild(elem('span', 'budget-sub', 'Shared'));
    } else {
      const v = elem('span', 'editable', E.fmt(node.budget, 'money', cur()));
      v.title = 'Click to edit the budget';
      v.onclick = () => editCell(v, node.budget, val => mutate(() => { node.budget = E.num(val); }));
      box.appendChild(v);
      const sub = elem('span', 'budget-sub',
        node.budgetType === 'lifetime' ? 'Lifetime' : 'Daily');
      sub.style.cursor = 'pointer';
      sub.title = 'Click to switch between daily and lifetime';
      sub.onclick = () => mutate(() => {
        node.budgetType = node.budgetType === 'lifetime' ? 'daily' : 'lifetime';
      });
      box.appendChild(sub);
    }
    td.appendChild(box);
    return td;
  }

  /* a metric */
  const td = elem('td', 'cell-num');
  const isCore = E.METRICS[key].kind === 'core';
  const pinned = m.overridden.includes(key);
  const value = m[key];

  const span = elem('span', 'editable' + (pinned ? ' is-pinned' : isCore ? '' : ' is-derived'));
  span.textContent = f(key, value);

  if (isCore) {
    const kids = E.childrenOf(node).length;
    span.title = kids
      ? 'Click to edit. This is a total — the new value is shared out across the ' +
        kids + ' ' + (kids === 1 ? 'child' : 'children') + ' below in their current proportions.'
      : 'Click to edit.';
    span.onclick = () => editCell(span, value, v => mutate(() => E.setCore(node, key, v)));
  } else {
    span.title = pinned
      ? 'Pinned by hand. The calculated value is ' + f(key, m.computed[key]) +
        '. Clear the box to hand it back to the engine.'
      : 'Calculated from ' + formulaFor(key) + '. Click to pin a value by hand.';
    span.onclick = () => editCell(span, value, v => mutate(() => {
      E.setOverride(node, key, String(v).trim() === '' ? null : v);
    }), { placeholder: 'auto' });
  }

  td.appendChild(span);
  if (pinned) {
    const b = elem('span', 'badge pin', 'pinned');
    b.style.marginLeft = '5px';
    td.appendChild(b);
  }
  return td;
}

function formulaFor(key) {
  return ({
    ctr: 'link clicks ÷ impressions × 100',
    cpc: 'amount spent ÷ link clicks',
    cpm: 'amount spent ÷ impressions × 1,000',
    costPerResult: 'amount spent ÷ results',
    cvr: 'conversions ÷ link clicks × 100',
    roas: 'conversion value ÷ amount spent',
    frequency: 'impressions ÷ reach',
    cpmReach: 'amount spent ÷ reach × 1,000'
  })[key] || 'the core inputs';
}

/**
 * The summary strip under the table.
 *
 * Its widths are read from the header cells rather than duplicated, so it stays
 * aligned with the columns however they are configured.
 */
function renderFoot(rows) {
  const foot = $('#gridFoot');
  const t = E.totals(state.cs);
  const heads = Array.from($('#gridHead').querySelectorAll('th'));
  if (!heads.length) return;

  const cell = (width, build, cls) => {
    const c = elem('div', 'tf-cell' + (cls ? ' ' + cls : ''));
    c.style.width = width + 'px';
    c.style.flex = '0 0 ' + width + 'px';
    build(c);
    return c;
  };

  const idWidth = heads.slice(0, 3).reduce((a, h) => a + h.offsetWidth, 0);
  foot.appendChild(cell(idWidth, c => {
    const n = rows.length;
    c.appendChild(elem('div', 'tf-label',
      'Results from ' + n + ' ' + (n === 1 ? levelWord(false) : levelWord(true))));
  }));

  state.columns.forEach((key, i) => {
    const def = colDef(key);
    const w = heads[3 + i] ? heads[3 + i].offsetWidth : 100;
    foot.appendChild(cell(w, c => {
      if (def.kind !== 'metric') {
        if (key === 'budget') {
          c.appendChild(elem('div', 'tf-value', E.fmt(E.totalBudget(state.cs), 'money', cur())));
          c.appendChild(elem('div', 'tf-sub', 'Total budget'));
        }
        return;
      }
      c.appendChild(elem('div', 'tf-value', f(key, t[key])));
      c.appendChild(elem('div', 'tf-sub',
        E.METRICS[key].kind === 'core' ? 'Total' : 'Overall'));
    }));
  });
}

/* ------------------------------------------------------------ structure ops */

function addAtLevel() {
  const cs = state.cs;
  structureChanged();
  if (state.level === 'campaign') {
    mutate(() => {
      const c = E.addChild(cs, E.makeCampaign({
        name: 'Campaign ' + (cs.campaigns.length + 1),
        objective: cs.objective,
        startDate: cs.startDate, endDate: cs.endDate
      }));
      state.expanded.add(c.id);
    });
    toast('Campaign added');
    return;
  }

  if (state.level === 'adset') {
    const c = cs.campaigns[cs.campaigns.length - 1];
    if (!c) return toast('Add a campaign first', 'bad');
    mutate(() => E.addChild(c, E.makeAdSet({ name: 'Ad set ' + (c.adsets.length + 1) })));
    toast('Ad set added to “' + c.name + '”');
    return;
  }

  const lastC = cs.campaigns[cs.campaigns.length - 1];
  const s = lastC && lastC.adsets[lastC.adsets.length - 1];
  if (!s) return toast('Add a campaign and an ad set first', 'bad');
  mutate(() => E.addChild(s, E.makeAd({ name: 'Ad ' + (s.ads.length + 1) })));
  toast('Ad added to “' + s.name + '”');
}

function addUnder(node) {
  const level = E.levelOf(node);
  structureChanged();
  mutate(() => {
    if (level === 'campaign') {
      E.addChild(node, E.makeAdSet({ name: 'Ad set ' + (node.adsets.length + 1) }));
    } else if (level === 'adset') {
      E.addChild(node, E.makeAd({ name: 'Ad ' + (node.ads.length + 1) }));
    }
    state.expanded.add(node.id);
  });
}

function duplicateNode(node, parent) {
  structureChanged();
  mutate(() => {
    const copy = E.cloneNode(node, node.name + ' (copy)');
    const key = E.childKey(parent);
    const at = parent[key].findIndex(c => c.id === node.id);
    parent[key].splice(at + 1, 0, copy);
  });
  toast('Duplicated');
}

function deleteNode(node, parent, kind) {
  const kids = E.childrenOf(node).length;
  const detail = kids
    ? ' This also removes the ' + kids + ' ' + (kids === 1 ? 'item' : 'items') + ' beneath it.'
    : '';
  confirmBox('Delete this ' + String(kind).toLowerCase() + '?',
    '“' + node.name + '” will be removed and the totals above it will drop by its share.' + detail,
    'Delete', () => {
      structureChanged();
      mutate(() => E.removeChild(parent, node.id));
      state.selected.delete(node.id);
      toast('Deleted');
    });
}

/** Everything currently ticked, with the parent each one hangs from. */
function selectedEntries() {
  const out = [];
  for (const id of state.selected) {
    const hit = E.findNode(state.cs, id);
    if (hit && hit.parent) out.push(hit);
  }
  return out;
}

function bulkDelete() {
  const items = selectedEntries();
  if (!items.length) return;
  confirmBox('Delete ' + items.length + ' selected ' + (items.length === 1 ? 'item' : 'items') + '?',
    'They will be removed and every total above them recalculated.',
    'Delete', () => {
      structureChanged();
      mutate(() => { for (const { node, parent } of items) E.removeChild(parent, node.id); });
      state.selected.clear();
      toast('Deleted ' + items.length);
    });
}

function bulkDuplicate() {
  const items = selectedEntries();
  if (!items.length) return;
  structureChanged();
  mutate(() => {
    for (const { node, parent } of items) {
      const key = E.childKey(parent);
      const at = parent[key].findIndex(c => c.id === node.id);
      parent[key].splice(at + 1, 0, E.cloneNode(node, node.name + ' (copy)'));
    }
  });
  state.selected.clear();
  toast('Duplicated ' + items.length);
}

/* --------------------------------------------------------------- popovers */

function statusPopover(anchor, nodes) {
  popover(anchor, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'Status'));
    for (const s of E.STATUSES) {
      popItem(pop, s.charAt(0).toUpperCase() + s.slice(1), () => {
        mutate(() => nodes.forEach(n => { n.status = s; }));
        close();
      }, { on: nodes.length === 1 && nodes[0].status === s });
    }
  });
}

function objectivePopover(anchor, node) {
  popover(anchor, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'Objective'));
    for (const o of Object.keys(E.OBJECTIVES)) {
      popItem(pop, o, () => {
        mutate(() => { node.objective = o; });
        close();
      }, { on: node.objective === o });
    }
  });
}

function presetsPopover(anchor) {
  popover(anchor, (pop, close) => {
    pop.style.minWidth = '260px';
    pop.appendChild(elem('div', 'pop-title', 'Start from a preset'));
    for (const t of TEMPLATES) {
      const b = elem('button', 'pop-item');
      const box = elem('div');
      box.appendChild(elem('div', null, t.name));
      const sub = elem('div', null, t.blurb);
      sub.style.cssText = 'font-size:11px;color:var(--dim);line-height:1.35;margin-top:1px';
      box.appendChild(sub);
      b.appendChild(box);
      b.onclick = () => { close(); openCase(fromTemplate(t.key, { seed: t.key + Date.now() }), true); };
      pop.appendChild(b);
    }
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Blank case study', () => { close(); newCaseStudy(); });
  });
}

/** Every distinct value of `field` anywhere in the tree, for a filter list. */
function valuesInTree(field) {
  const seen = new Set();
  E.walk(state.cs, n => { if (n[field]) seen.add(n[field]); });
  return ['all', ...[...seen].sort()];
}

function filterPopover(anchor) {
  popover(anchor, (pop, close) => {
    pop.style.minWidth = '250px';
    const reopen = () => { render(); filterPopover(anchor); };

    const group = (title, field, options, labeller) => {
      pop.appendChild(elem('div', 'pop-title', title));
      for (const v of options) {
        popItem(pop, v === 'all' ? 'All' : (labeller ? labeller(v) : v), () => {
          state.filters[field] = v; reopen();
        }, { on: state.filters[field] === v });
      }
      pop.appendChild(elem('div', 'pop-sep'));
    };

    group('Status', 'status', ['all', ...E.STATUSES],
          s => s.charAt(0).toUpperCase() + s.slice(1));
    group('Objective', 'objective',
          ['all', ...new Set(state.cs.campaigns.map(c => c.objective).filter(Boolean))]);
    group('Platform', 'platform', valuesInTree('platform'));
    group('Placement', 'placement', valuesInTree('placement'));

    /* Numeric thresholds, applied to the row's own rolled-up totals. */
    pop.appendChild(elem('div', 'pop-title', 'At least'));
    const grid = elem('div', 'pop-grid');
    for (const [field, label] of [['minSpend', 'Spend'], ['minResults', 'Results']]) {
      const box = elem('div');
      box.appendChild(elem('label', 'lbl', label));
      const i = elem('input', 'field');
      i.type = 'number';
      i.min = '0';
      i.placeholder = 'any';
      i.value = state.filters[field];
      i.onchange = () => { state.filters[field] = i.value; render(); };
      box.appendChild(i);
      grid.appendChild(box);
    }
    pop.appendChild(grid);

    const clear = elem('button', 'btn btn-sm', 'Clear all filters');
    clear.style.cssText = 'width:calc(100% - 8px);margin:8px 4px 2px';
    clear.onclick = () => {
      state.filters = { status: 'all', objective: 'all', platform: 'all',
                        placement: 'all', minSpend: '', minResults: '' };
      reopen();
    };
    pop.appendChild(clear);

    const note = elem('div', null, 'Filtering changes what is listed, never the stored numbers.');
    note.style.cssText = 'font-size:11px;color:var(--dim);padding:7px 9px 3px;line-height:1.4';
    pop.appendChild(note);
  });
}

function columnsPopover(anchor) {
  popover(anchor, (pop) => {
    pop.style.minWidth = '250px';
    pop.appendChild(elem('div', 'pop-title', 'Columns'));
    for (const def of COLUMN_DEFS) {
      const on = state.columns.includes(def.key);
      const b = elem('button', 'pop-item' + (on ? ' on' : ''));
      const box = elem('input');
      box.type = 'checkbox';
      box.checked = on;
      box.style.pointerEvents = 'none';
      b.appendChild(box);
      b.appendChild(document.createTextNode(
        def.key === 'results' ? (state.cs.resultLabel || 'Results') : def.label));
      b.onclick = () => {
        if (on) state.columns = state.columns.filter(k => k !== def.key);
        else state.columns = COLUMN_DEFS.filter(d =>
          state.columns.includes(d.key) || d.key === def.key).map(d => d.key);
        render();
        columnsPopover(anchor);       /* keep it open for a run of toggles */
      };
      pop.appendChild(b);
    }
  });
}

/* --------------------------------------------------------- date range picker */

function datePopover(anchor) {
  popover(anchor, (pop, close) => {
    pop.style.minWidth = '260px';
    pop.appendChild(elem('div', 'pop-title', 'Date range'));

    const apply = (start, end) => {
      mutate(() => { state.cs.startDate = start; state.cs.endDate = end; });
      close();
    };
    const today = new Date();
    const iso = d => E.isoDate(d);
    const shift = n => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };

    const presets = [
      ['Today',        () => apply(iso(today), iso(today))],
      ['Yesterday',    () => apply(iso(shift(-1)), iso(shift(-1)))],
      ['Last 7 days',  () => apply(iso(shift(-7)), iso(shift(-1)))],
      ['Last 14 days', () => apply(iso(shift(-14)), iso(shift(-1)))],
      ['Last 30 days', () => apply(iso(shift(-30)), iso(shift(-1)))],
      ['This month',   () => apply(iso(new Date(today.getFullYear(), today.getMonth(), 1)),
                                   iso(new Date(today.getFullYear(), today.getMonth() + 1, 0)))],
      ['Last month',   () => apply(iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
                                   iso(new Date(today.getFullYear(), today.getMonth(), 0)))]
    ];
    for (const [label, fn] of presets) popItem(pop, label, fn);

    pop.appendChild(elem('div', 'pop-sep'));
    pop.appendChild(elem('div', 'pop-title', 'Custom'));

    const grid = elem('div', 'pop-grid');
    const a = elem('input', 'field'); a.type = 'date'; a.value = state.cs.startDate;
    const b = elem('input', 'field'); b.type = 'date'; b.value = state.cs.endDate;
    grid.append(a, b);
    pop.appendChild(grid);

    const go = elem('button', 'btn btn-primary btn-sm', 'Apply');
    go.style.cssText = 'width:calc(100% - 8px);margin:6px 4px 2px';
    go.onclick = () => {
      if (!a.value || !b.value) return;
      if (b.value < a.value) return toast('The end date falls before the start date', 'bad');
      apply(a.value, b.value);
    };
    pop.appendChild(go);

    const note = elem('div', null,
      'The range is a property of this case study: it sets the period the totals cover and the span the charts are drawn across.');
    note.style.cssText = 'font-size:11px;color:var(--dim);padding:7px 9px 3px;line-height:1.4';
    pop.appendChild(note);
  });
}

/* ------------------------------------------------------------ builder drawer */

function openBuilder() {
  if (!state.cs) return;
  const cs = state.cs;

  const scrim = elem('div', 'scrim');
  const drawer = elem('div', 'drawer');
  const close = () => { scrim.remove(); drawer.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => { if (e.key === 'Escape') close(); };

  const head = elem('div', 'drawer-head');
  head.appendChild(elem('h2', null, 'Case study settings'));
  const x = elem('button', 'btn btn-sm btn-ghost', 'Close');
  x.onclick = close;
  head.appendChild(x);

  const body = elem('div', 'drawer-body');
  const foot = elem('div', 'drawer-foot');

  /* --- identity ------------------------------------------------------- */
  const field = (label, value, onChange, type) => {
    const row = elem('div', 'form-row');
    row.appendChild(elem('label', 'lbl', label));
    const i = elem('input', 'field');
    i.type = type || 'text';
    i.value = value === null || value === undefined ? '' : value;
    i.onchange = () => { onChange(i.value); };
    row.appendChild(i);
    return row;
  };
  const select = (label, value, options, onChange) => {
    const row = elem('div', 'form-row');
    row.appendChild(elem('label', 'lbl', label));
    const s = elem('select', 'field');
    for (const o of options) {
      const opt = elem('option', null, o.label || o);
      opt.value = o.value !== undefined ? o.value : o;
      if (String(opt.value) === String(value)) opt.selected = true;
      s.appendChild(opt);
    }
    s.onchange = () => { onChange(s.value); };
    row.appendChild(s);
    return row;
  };

  body.appendChild(field('Brand / client name', cs.brand, v => {
    mutate(() => { cs.brand = v.trim().slice(0, 160) || cs.brand; });
    refreshDrawerHeader();
  }));
  body.appendChild(field('Case study title', cs.title, v => mutate(() => { cs.title = v.slice(0, 160); })));
  body.appendChild(field('Industry', cs.industry, v => mutate(() => { cs.industry = v.slice(0, 120); })));

  const grid1 = elem('div', 'form-grid');
  grid1.appendChild(select('Objective', cs.objective, Object.keys(E.OBJECTIVES), v => {
    mutate(() => { cs.objective = v; cs.resultLabel = E.OBJECTIVES[v] || cs.resultLabel; });
    rebuildBody();
  }));
  grid1.appendChild(select('Currency', cs.currency,
    Object.keys(E.CURRENCIES).map(c => ({ value: c, label: c })),
    v => { mutate(() => { cs.currency = v; }); rebuildBody(); }));
  body.appendChild(grid1);

  body.appendChild(field('What a result is called', cs.resultLabel,
    v => mutate(() => { cs.resultLabel = v.slice(0, 60) || 'Results'; })));

  const grid2 = elem('div', 'form-grid');
  grid2.appendChild(field('Start date', cs.startDate, v => mutate(() => { cs.startDate = v; }), 'date'));
  grid2.appendChild(field('End date', cs.endDate, v => mutate(() => { cs.endDate = v; }), 'date'));
  body.appendChild(grid2);

  body.appendChild(select('Daily trend shape', cs.trend,
    E.TREND_SHAPES.map(t => ({ value: t, label: t.replace('-', ' ') })),
    v => { mutate(() => { cs.trend = v; }); }));
  const trendHint = elem('p', 'hint',
    'The case study stores period totals, not a day-by-day log. This shapes the modelled daily curve the charts draw — the series always adds back up to the real totals.');
  body.appendChild(trendHint);

  /* --- headline figures ------------------------------------------------ */
  const sep = elem('div', 'form-sep');
  sep.appendChild(document.createTextNode('Headline figures'));
  body.appendChild(sep);

  const intro = elem('p', 'hint');
  intro.style.marginBottom = '12px';
  intro.textContent = state.cs.campaigns.length
    ? 'These are the account totals. Changing one here shares the new value out across every campaign, ad set and ad below in their current proportions.'
    : 'This case study has no campaigns yet, so these figures are held directly on it. They move down into the first campaign you add.';
  body.appendChild(intro);

  const readoutHost = elem('div');
  const coreHost = elem('div');
  body.appendChild(coreHost);
  body.appendChild(readoutHost);

  function rebuildCore() {
    coreHost.innerHTML = '';
    const t = E.totals(cs);
    const budgetRow = field('Total budget (across campaigns)', E.totalBudget(cs), v => {
      const next = E.num(v);
      mutate(() => {
        const weights = cs.campaigns.map(c => E.num(c.budget));
        const parts = E.distribute(next, weights, 0);
        cs.campaigns.forEach((c, i) => { c.budget = parts[i]; });
      });
      rebuildCore(); rebuildReadout();
    });
    if (!cs.campaigns.length) budgetRow.querySelector('input').disabled = true;
    coreHost.appendChild(budgetRow);

    const pairs = [
      ['spend', 'Amount spent'], ['results', cs.resultLabel || 'Results'],
      ['revenue', 'Conversion value'], ['impressions', 'Impressions'],
      ['reach', 'Reach'], ['clicks', 'Link clicks'], ['conversions', 'Conversions']
    ];
    const g = elem('div', 'form-grid');
    for (const [key, label] of pairs) {
      g.appendChild(field(label, t[key], v => {
        mutate(() => E.setCore(cs, key, v));
        rebuildCore(); rebuildReadout();
      }, 'number'));
    }
    coreHost.appendChild(g);
  }

  function rebuildReadout() {
    readoutHost.innerHTML = '';
    const sep2 = elem('div', 'form-sep');
    sep2.appendChild(document.createTextNode('Calculated from the above'));
    readoutHost.appendChild(sep2);

    const t = E.totals(cs);
    const box = elem('div', 'readout');
    for (const key of E.CALC) {
      const cell = elem('div', 'readout-cell');
      cell.appendChild(elem('div', 'readout-label', E.METRICS[key].label));
      cell.appendChild(elem('div', 'readout-value', f(key, t[key])));
      cell.title = E.METRICS[key].label + ' = ' + formulaFor(key);
      box.appendChild(cell);
    }
    readoutHost.appendChild(box);

    const note = elem('p', 'hint');
    note.textContent = 'These follow the inputs automatically. To pin one to a value of your own, click it in the table and type over it.';
    readoutHost.appendChild(note);

    const pinned = [];
    E.walk(cs, n => {
      const keys = Object.keys(n.overrides || {});
      if (keys.length) pinned.push({ node: n, keys });
    });
    if (pinned.length) {
      const clear = elem('button', 'btn btn-sm', 'Clear all pinned metrics (' + pinned.length + ')');
      clear.style.marginTop = '8px';
      clear.onclick = () => {
        mutate(() => E.walk(cs, n => E.clearOverrides(n)));
        rebuildReadout();
        toast('Pinned metrics cleared');
      };
      readoutHost.appendChild(clear);
    }
  }

  /* --- notes ---------------------------------------------------------- */
  const notesHost = elem('div');
  function rebuildNotes() {
    notesHost.innerHTML = '';
    const sep3 = elem('div', 'form-sep');
    sep3.appendChild(document.createTextNode('Notes'));
    notesHost.appendChild(sep3);
    const ta = elem('textarea', 'field');
    ta.value = cs.notes || '';
    ta.placeholder = 'Context for this case study — the brief, what changed, what you would say about it.';
    ta.onchange = () => mutate(() => { cs.notes = ta.value.slice(0, 4000); });
    notesHost.appendChild(ta);
  }
  body.appendChild(notesHost);

  function rebuildBody() { rebuildCore(); rebuildReadout(); rebuildNotes(); }
  rebuildBody();

  function refreshDrawerHeader() { renderHeader(); }

  /* --- footer actions -------------------------------------------------- */
  const save = elem('button', 'btn btn-primary', 'Save now');
  save.onclick = async () => { clearTimeout(saveTimer); await commitSave(); toast('Saved', 'good'); };

  const dup = elem('button', 'btn', 'Duplicate');
  dup.onclick = () => { close(); duplicateCurrent(); };

  const reset = elem('button', 'btn', 'Reset');
  reset.onclick = () => { close(); resetCurrent(); };

  const del = elem('button', 'btn btn-danger', 'Delete');
  del.onclick = () => { close(); deleteCurrent(); };

  foot.append(save, dup, reset, del);

  drawer.append(head, body, foot);
  scrim.onclick = close;
  document.addEventListener('keydown', onKey);
  document.body.append(scrim, drawer);
}

/* ------------------------------------------------------- case study actions */

function newCaseStudy() {
  openCase(blankCaseStudy('New case study'), true);
  openBuilder();
}

function duplicateCurrent() {
  if (!state.cs) return;
  const copy = E.duplicateCaseStudy(state.cs);
  openCase(copy, true);
  toast('Duplicated — editing the copy');
}

function resetCurrent() {
  if (!state.cs) return;
  confirmBox('Reset this case study?',
    'Every campaign, ad set and ad in “' + state.cs.brand + '” will be removed, leaving the brand, dates and objective in place. This cannot be undone.',
    'Reset', () => {
      structureChanged();
      mutate(() => {
        state.cs.campaigns = [];
        state.expanded.clear();
        state.selected.clear();
      });
      toast('Reset');
    });
}

function deleteCurrent() {
  if (!state.cs) return;
  const cs = state.cs;
  confirmBox('Delete “' + cs.brand + '”?',
    'The whole case study will be removed from the library and from this browser. This cannot be undone.',
    'Delete', async () => {
      const res = await Store.remove(cs.id);
      if (!res.synced) toast(res.error || 'Removed here, but the server could not be reached.', 'bad');
      state.cs = null;
      state.expanded.clear();
      state.selected.clear();
      await refreshLibrary();
      const next = state.library[0];
      if (next) await loadCase(next.id); else render();
      toast('Deleted');
    });
}

/** Put a case study on screen and save it. */
function openCase(cs, save) {
  structureChanged();
  state.cs = cs;
  state.expanded = new Set(cs.campaigns.map(c => c.id));
  state.selected.clear();
  state.search = '';
  const rs = $('#rowSearch');
  if (rs) rs.value = '';
  render();
  if (save) scheduleSave();
}

async function loadCase(id) {
  try {
    const res = await Store.get(id);
    if (!res.case) return toast(res.error || 'That case study could not be opened.', 'bad');
    state.online = res.online;
    state.dirty = Store.isDirty(id);
    openCase(res.case, false);
  } catch (err) {
    if (err instanceof Store.Unauthorised) return lock('That token was not accepted.');
    toast(err.message, 'bad');
  }
}

/* ---------------------------------------------------------------- library */

async function refreshLibrary() {
  try {
    const res = await Store.list();
    state.library = res.cases;
    if (res.online === false) state.online = false;
    renderLibrary();
    renderSync();
    return res;
  } catch (err) {
    if (err instanceof Store.Unauthorised) { lock('That token was not accepted.'); return null; }
    state.online = false;
    renderSync();
    return null;
  }
}

function renderLibrary() {
  const host = $('#libList');
  host.innerHTML = '';
  const q = state.libSearch.trim().toLowerCase();

  const rows = state.library.filter(c => !q ||
    String(c.brand || '').toLowerCase().includes(q) ||
    String(c.title || '').toLowerCase().includes(q) ||
    String(c.industry || '').toLowerCase().includes(q));

  if (!rows.length) {
    const p = elem('p', null, state.library.length ? 'Nothing matches.' : 'No case studies saved yet.');
    p.style.cssText = 'padding:14px 10px;color:var(--dim);font-size:12px';
    host.appendChild(p);
    return;
  }

  for (const c of rows) {
    const item = elem('button', 'case-item' + (state.cs && state.cs.id === c.id ? ' is-open' : ''));

    const top = elem('div', 'case-item-top');
    top.appendChild(elem('span', 'case-item-name', c.brand || 'Untitled'));
    if (Store.isDirty(c.id)) {
      const d = elem('span', 'case-item-dirty');
      d.title = 'Saved on this device, not yet synced';
      top.appendChild(d);
    }
    item.appendChild(top);

    item.appendChild(elem('div', 'case-item-sub',
      [c.title, E.fmtDateRange(c.start_date, c.end_date)].filter(Boolean).join(' · ')));

    const figs = elem('div', 'case-item-figs');
    const money = v => E.fmt(v, 'money', c.currency || 'EGP', true);
    figs.innerHTML =
      '<span>' + esc(money(c.spend)) + '</span>' +
      '<span>' + esc(E.fmt(c.results, 'int', c.currency, true)) + ' res.</span>' +
      '<span><b>' + esc(c.roas === null || c.roas === undefined ? '—' : E.fmt(c.roas, 'ratio')) + '</b> ROAS</span>';
    item.appendChild(figs);

    item.onclick = () => loadCase(c.id);
    item.oncontextmenu = e => {
      e.preventDefault();
      caseMenu(item, c);
    };
    host.appendChild(item);
  }
}

function caseMenu(anchor, row) {
  popover(anchor, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', row.brand || 'Case study'));
    popItem(pop, 'Open', () => { close(); loadCase(row.id); });
    popItem(pop, 'Duplicate', async () => {
      close();
      const res = await Store.get(row.id);
      if (res.case) { openCase(E.duplicateCaseStudy(res.case), true); toast('Duplicated'); }
    });
    popItem(pop, 'Edit settings', async () => { close(); await loadCase(row.id); openBuilder(); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Delete', () => {
      close();
      confirmBox('Delete “' + (row.brand || 'this case study') + '”?',
        'It will be removed from the library and from this browser. This cannot be undone.',
        'Delete', async () => {
          await Store.remove(row.id);
          if (state.cs && state.cs.id === row.id) state.cs = null;
          await refreshLibrary();
          render();
          toast('Deleted');
        });
    }, { danger: true });
  });
}

/* ----------------------------------------------------------------- checks */

function renderIssues() {
  const issues = E.validate(state.cs);
  const pill = $('#issuesCount');
  const bad = issues.filter(i => i.severity !== 'info').length;
  pill.textContent = issues.length;
  pill.classList.toggle('zero', bad === 0);
  $('#issuesBtn').title = bad
    ? bad + ' figure' + (bad === 1 ? '' : 's') + ' worth checking'
    : 'No arithmetic problems found';
}

function openIssues() {
  const issues = E.validate(state.cs);
  modal('Data consistency checks', body => {
    if (!issues.length) {
      body.appendChild(elem('p', null,
        'Everything adds up. No impossible figures, and no metrics pinned by hand.'));
      return;
    }
    const intro = elem('p', null,
      'These are figures a reader could question. Nothing here blocks you — a case study is yours to shape — but each one is arithmetic that does not hold on its own.');
    intro.style.marginBottom = '12px';
    body.appendChild(intro);

    const list = elem('div', 'issues');
    const order = { error: 0, warn: 1, info: 2 };
    for (const i of issues.slice().sort((a, b) => order[a.severity] - order[b.severity])) {
      const row = elem('div', 'issue ' + i.severity);
      row.appendChild(elem('span', 'issue-where', i.label));
      row.appendChild(elem('span', null, i.text));
      list.appendChild(row);
    }
    body.appendChild(list);
  }, (foot, close) => {
    const b = elem('button', 'btn btn-primary', 'Close');
    b.onclick = close;
    foot.appendChild(b);
  });
}

/* ----------------------------------------------------------------- export */

function download(name, text, type) {
  const blob = new Blob([text], { type: type || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = elem('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const slug = s => String(s || 'case-study').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'case-study';

function exportCSV() {
  const rows = visibleRows();
  const cols = state.columns.filter(k => colDef(k));
  const head = ['Level', 'Name', 'Parent', ...cols.map(k =>
    k === 'results' ? (state.cs.resultLabel || 'Results') : colDef(k).label)];

  const cell = v => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const lines = [head.map(cell).join(',')];
  for (const r of rows) {
    const m = E.metricsOf(r.node);
    const out = [r.kind, r.node.name, r.under || (r.parent && r.parent.name) || ''];
    for (const k of cols) {
      if (k === 'delivery') out.push(r.node.status);
      else if (k === 'objective') out.push(r.node.objective || '');
      else if (k === 'budget') out.push(r.node.budget === undefined ? '' : r.node.budget);
      else out.push(m[k] === null || m[k] === undefined ? '' : m[k]);
    }
    lines.push(out.map(cell).join(','));
  }

  const t = E.totals(state.cs);
  const totalRow = ['Total', state.cs.brand, ''];
  for (const k of cols) {
    if (k === 'delivery' || k === 'objective') totalRow.push('');
    else if (k === 'budget') totalRow.push(E.totalBudget(state.cs));
    else totalRow.push(t[k] === null || t[k] === undefined ? '' : t[k]);
  }
  lines.push(totalRow.map(cell).join(','));
  lines.push('');
  lines.push(cell('WeWave case study simulator — hypothetical figures, not reported platform data.'));

  download(slug(state.cs.brand) + '-' + state.level + 's.csv', lines.join('\r\n'), 'text/csv;charset=utf-8');
}

function exportJSON() {
  const payload = {
    format: 'wewave-case-study/1',
    exportedAt: new Date().toISOString(),
    disclaimer: 'Hypothetical case study figures produced in the WeWave case study simulator. Not reported data from any advertising platform.',
    case: state.cs
  };
  download(slug(state.cs.brand) + '.json', JSON.stringify(payload, null, 2), 'application/json');
}

function importJSON() {
  const input = elem('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.onchange = () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const doc = parsed && (parsed.case || parsed);
        if (!doc || typeof doc !== 'object') throw new Error('No case study in that file.');
        /* A fresh id, so importing a file twice gives two case studies rather
           than silently overwriting the first. */
        const cs = E.duplicateCaseStudy(E.makeCaseStudy(doc), doc.brand || 'Imported case study');
        openCase(cs, true);
        toast('Imported');
      } catch (err) {
        toast('That file could not be read as a case study.', 'bad');
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

function exportPopover(anchor) {
  popover(anchor, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'Export'));
    popItem(pop, 'Download CSV (current view)', () => { close(); exportCSV(); });
    popItem(pop, 'Download JSON (whole case study)', () => { close(); exportJSON(); });
    popItem(pop, 'Print / save as PDF', () => { close(); window.print(); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Import a JSON case study…', () => { close(); importJSON(); });
    const note = elem('div', null,
      'Case studies stay inside this admin area — there is no public share link.');
    note.style.cssText = 'font-size:11px;color:var(--dim);padding:7px 9px 3px;line-height:1.4';
    pop.appendChild(note);
  });
}

/* ------------------------------------------------------------------- gate */

/**
 * Keep `--topbar` in step with the real bar.
 *
 * The sidebar sticks directly below the top bar, and that bar wraps to two rows
 * on a narrow screen — so its height is not a constant, and a hard-coded one
 * drifts out of step with the CSS and slides the sidebar underneath it.
 *
 * A zero measurement is discarded rather than written. While the token gate is
 * up, `#app` is hidden and the bar measures 0; storing that would pin the
 * sidebar to the very top of the window. Ignoring it leaves the CSS default in
 * place until there is something real to measure.
 */
function syncTopbarHeight() {
  const bar = $('.topbar');
  const h = bar ? bar.offsetHeight : 0;
  if (h > 0) document.documentElement.style.setProperty('--topbar', h + 'px');
}

function unlock() {
  const gate = $('#gate');
  if (gate) gate.hidden = true;
  $('#app').hidden = false;
  syncTopbarHeight();
  boot();
}

function lock(message) {
  /* The standalone build has no gate to fall back to, so a failure there must
     not blank the page -- there is nothing to authenticate against anyway. */
  const gate = $('#gate');
  if (!gate) { if (message) toast(message, 'bad'); return; }
  Store.clearToken();
  $('#app').hidden = true;
  gate.hidden = false;
  const err = $('#gateErr');
  if (err) err.textContent = message || '';
}

/* ------------------------------------------------------------------- boot */

async function boot() {
  /* Opening this file from disk in a viewer that blocks storage is a real and
     silent trap — it produced an empty library with no reason given. Say it
     once, plainly, at the top of the session. */
  if (!Store.storageAvailable()) {
    const n = $('#notice');
    if (n) {
      n.hidden = false;
      n.innerHTML =
        '<b>Not saving.</b><span>This browser is blocking storage for this page, ' +
        'so case studies will disappear when you reload. Everything still works — ' +
        'use <b>Export</b> to keep your work. Opening the file in Chrome, Edge or ' +
        'Firefox directly usually fixes it.</span>';
    }
  }

  const res = await refreshLibrary();
  if (!res) return;

  /* A genuinely empty library gets the demo set, so the dashboard is never a
     blank table on a first open. It is labelled demo throughout and every row
     can be deleted. */
  if (!res.cases.length) {
    const demo = demoLibrary();
    for (const cs of demo) await Store.save(cs);
    await refreshLibrary();
    toast('Loaded demo case studies — edit or delete them freely');
  }

  const first = state.library[0];
  if (first) await loadCase(first.id);
  else render();
}

/* ------------------------------------------------------------------- wiring */

if ($('#tokGo')) {
  $('#tokGo').onclick = () => {
    const t = $('#tok').value.trim();
    if (!t) return;
    Store.setToken(t);
    $('#gateErr').textContent = '';
    unlock();
  };
  $('#tok').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tokGo').click(); });
}
if ($('#lockBtn')) $('#lockBtn').onclick = () => lock('');

$('#noticeClose').onclick = () => { $('#notice').hidden = true; };

$('#acctBtn').onclick = e => {
  popover(e.currentTarget, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'Case study'));
    popItem(pop, 'Settings…', () => { close(); openBuilder(); });
    popItem(pop, 'Duplicate', () => { close(); duplicateCurrent(); });
    popItem(pop, 'Reset', () => { close(); resetCurrent(); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Delete', () => { close(); deleteCurrent(); }, { danger: true });
  });
};

/* ---- icon rail ---------------------------------------------------------- */

/** The rail mirrors the view tabs, so the two can never disagree. */
function setView(view) {
  state.view = view;
  $$('.view-tab').forEach(t => t.classList.toggle('on', t.dataset.view === view));
  $('#railTable').classList.toggle('on', view === 'performance' || view === 'both');
  $('#railCharts').classList.toggle('on', view === 'charts' || view === 'both');
  render();
}

$('#railTable').onclick    = () => setView('performance');
$('#railCharts').onclick   = () => setView('charts');
$('#railLibrary').onclick  = () => setLibrary(!state.libraryOpen, true);
$('#railPresets').onclick  = e => presetsPopover(e.currentTarget);
$('#railChecks').onclick   = () => { if (state.cs) openIssues(); };
$('#railSettings').onclick = openBuilder;

/* ---- header ------------------------------------------------------------- */

$('#refreshBtn').onclick = async () => {
  if (!state.cs) { await refreshLibrary(); return toast('Reloaded'); }
  clearTimeout(saveTimer);
  await commitSave();                 /* never discard an unsaved edit */
  await loadCase(state.cs.id);
  toast('Reloaded');
};

$('#saveBtn').onclick = async () => {
  if (!state.cs) return;
  clearTimeout(saveTimer);
  await commitSave();
  toast('Saved', 'good');
};

$('#overflowBtn').onclick = e => {
  popover(e.currentTarget, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'Case study'));
    popItem(pop, 'New case study', () => { close(); newCaseStudy(); });
    popItem(pop, 'Settings…', () => { close(); openBuilder(); });
    popItem(pop, 'Duplicate', () => { close(); duplicateCurrent(); });
    popItem(pop, 'Save now', async () => { close(); clearTimeout(saveTimer); await commitSave(); toast('Saved', 'good'); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Export…', () => { close(); exportPopover($('#exportBtn')); });
    popItem(pop, 'Presentation mode', () => { close(); $('#presentBtn').click(); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Reset', () => { close(); resetCurrent(); });
    popItem(pop, 'Delete', () => { close(); deleteCurrent(); }, { danger: true });
  });
};

/* ---- toolbar ------------------------------------------------------------ */

/** Edit acts on the single selected row: rename, status, budget in one place. */
$('#editRowBtn').onclick = e => {
  const items = selectedEntries();
  if (items.length !== 1) return;
  const node = items[0].node;

  popover(e.currentTarget, (pop, close) => {
    pop.style.minWidth = '250px';
    pop.appendChild(elem('div', 'pop-title', 'Edit ' + E.levelLabel(node)));

    const row = elem('div');
    row.style.padding = '3px';
    row.appendChild(elem('label', 'lbl', 'Name'));
    const name = elem('input', 'field');
    name.value = node.name || '';
    name.onchange = () => mutate(() => { node.name = name.value.trim().slice(0, 160) || node.name; });
    row.appendChild(name);
    pop.appendChild(row);

    if (node.budget !== undefined) {
      const b = elem('div');
      b.style.padding = '3px';
      b.appendChild(elem('label', 'lbl', 'Budget'));
      const bi = elem('input', 'field');
      bi.type = 'number';
      bi.value = E.num(node.budget);
      bi.onchange = () => mutate(() => { node.budget = E.num(bi.value); });
      b.appendChild(bi);
      pop.appendChild(b);
    }

    pop.appendChild(elem('div', 'pop-sep'));
    pop.appendChild(elem('div', 'pop-title', 'Status'));
    for (const st of E.STATUSES) {
      popItem(pop, st.charAt(0).toUpperCase() + st.slice(1), () => {
        mutate(() => { node.status = st; });
        close();
      }, { on: node.status === st });
    }
  });
};

$('#moreBtn').onclick = e => {
  popover(e.currentTarget, (pop, close) => {
    const n = state.selected.size;
    pop.appendChild(elem('div', 'pop-title', n ? n + ' selected' : 'Rows'));
    popItem(pop, 'Select all in view', () => {
      visibleRows().forEach(r => state.selected.add(r.node.id));
      render(); close();
    });
    popItem(pop, 'Clear selection', () => { state.selected.clear(); render(); close(); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Expand all', () => { close(); expandAll(true); });
    popItem(pop, 'Collapse all', () => { close(); expandAll(false); });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Add campaign', () => { close(); state.level = 'campaign'; addAtLevel(); });
  });
};

$('#breakdownBtn').onclick = e => {
  popover(e.currentTarget, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'Break down by'));
    for (const key of Object.keys(BREAKDOWNS)) {
      popItem(pop, BREAKDOWNS[key].label, () => {
        state.breakdown = key;
        render();
        close();
      }, { on: state.breakdown === key });
    }
    const note = elem('div', null,
      'Grouping only rearranges the rows. Every figure stays exactly as it is.');
    note.style.cssText = 'font-size:11px;color:var(--dim);padding:6px 8px 2px;line-height:1.4';
    pop.appendChild(note);
  });
};

$('#viewOptBtn').onclick = e => {
  popover(e.currentTarget, (pop, close) => {
    pop.appendChild(elem('div', 'pop-title', 'View'));
    popItem(pop, 'Case study library', () => { setLibrary(!state.libraryOpen, true); close(); },
            { on: state.libraryOpen });
    popItem(pop, 'Presentation mode', () => { close(); $('#presentBtn').click(); },
            { on: state.present });
    pop.appendChild(elem('div', 'pop-sep'));
    popItem(pop, 'Print / save as PDF', () => { close(); window.print(); });
  });
};

$('#builderBtn').onclick = openBuilder;
$('#newBtn').onclick = newCaseStudy;
$('#presetBtn').onclick = e => presetsPopover(e.currentTarget);
$('#issuesBtn').onclick = () => { if (state.cs) openIssues(); };
$('#dateBtn').onclick = e => { if (state.cs) datePopover(e.currentTarget); };
$('#filterBtn').onclick = e => { if (state.cs) filterPopover(e.currentTarget); };
$('#columnsBtn').onclick = e => { if (state.cs) columnsPopover(e.currentTarget); };
$('#exportBtn').onclick = e => { if (state.cs) exportPopover(e.currentTarget); };
$('#addBtn').onclick = () => { if (state.cs) addAtLevel(); };
$('#dupRowBtn').onclick = bulkDuplicate;
$('#delRowBtn').onclick = bulkDelete;
$('#statusBtn').onclick = e => {
  const items = selectedEntries();
  if (items.length) statusPopover(e.currentTarget, items.map(i => i.node));
};

function expandAll(open) {
  if (!state.cs) return;
  state.expanded.clear();
  if (open) {
    E.walk(state.cs, n => { if (E.childrenOf(n).length && n !== state.cs) state.expanded.add(n.id); });
  }
  $('#expandBtn').textContent = open ? 'Collapse all' : 'Expand all';
  render();
}

$('#expandBtn').onclick = () => expandAll(state.expanded.size === 0);

$('#presentBtn').onclick = () => {
  state.present = !state.present;
  document.body.classList.toggle('present', state.present);
  $('#presentBtn').textContent = state.present ? 'Exit presentation' : 'Presentation mode';
  if (state.present) {
    state.expanded.clear();
    toast('Presentation mode — editing controls hidden');
  }
  render();
};

$$('.view-tab').forEach(t => { t.onclick = () => setView(t.dataset.view); });

$$('.level-tab').forEach(t => {
  t.onclick = () => {
    $$('.level-tab').forEach(x => x.classList.remove('on'));
    t.classList.add('on');
    state.level = t.dataset.level;
    state.selected.clear();
    /* Sorting by a column the new level does not show would silently do
       nothing, so fall back to the default. */
    if (!state.columns.includes(state.sort.key) && state.sort.key !== 'name') {
      state.sort = { key: 'spend', dir: 'desc' };
    }
    render();
  };
});

let searchTimer = null;
$('#rowSearch').addEventListener('input', e => {
  clearTimeout(searchTimer);
  const v = e.target.value;
  searchTimer = setTimeout(() => { state.search = v; render(); }, 140);
});
$('#libSearch').addEventListener('input', e => {
  state.libSearch = e.target.value;
  renderLibrary();
});

/**
 * A last chance to push the server copy before the tab closes.
 *
 * Deliberately NOT a "are you sure you want to leave" prompt. The local mirror
 * already holds every change, so nothing is at risk -- and while the server is
 * unreachable the dirty flag stays set, which would mean blocking every single
 * navigation for a warning that is not true. The sidebar dot and the header
 * both say when something has not synced; that is the honest signal.
 */
window.addEventListener('beforeunload', () => {
  if (state.dirty) {
    clearTimeout(saveTimer);
    commitSave();
  }
});

if (window.ResizeObserver) {
  const bar = $('.topbar');
  if (bar) new ResizeObserver(syncTopbarHeight).observe(bar);
} else {
  window.addEventListener('resize', syncTopbarHeight);
}
syncTopbarHeight();
setLibrary(state.libraryOpen);

/**
 * The library is a docked panel on a wide screen and an overlay on a narrow
 * one, so which default is right changes with the window.
 *
 * matchMedia rather than a resize listener: it fires exactly on the breakpoint
 * crossing, and it reports the current state synchronously — a plain resize
 * handler missed the transition entirely under viewport emulation, leaving the
 * overlay sitting on top of the table at phone width.
 *
 * Follow the window until the user expresses a preference, then stop
 * second-guessing them.
 */
const WIDE = window.matchMedia('(min-width: 981px)');
function followWidth(e) {
  if (state.libraryUserSet) return;
  setLibrary(e.matches);
}
if (WIDE.addEventListener) WIDE.addEventListener('change', followWidth);
else if (WIDE.addListener) WIDE.addListener(followWidth);
followWidth(WIDE);

/* The standalone build has no token to check — open straight into the app. */
if (Store.isStandalone() || Store.getToken()) unlock();
