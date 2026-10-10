/**
 * WeWave — Case Study Analytics: the calculation engine.
 *
 * This module is pure. It touches no DOM, no storage and no network, so it can
 * be unit-tested on its own (`node tools/test_case_engine.mjs`). Everything the
 * UI displays is derived here, which is what stops the interface from ever
 * showing two numbers that disagree.
 *
 * THE MODEL
 *
 *   CaseStudy -> Campaign[] -> AdSet[] -> Ad[]
 *
 * Every node carries an `own` bucket of CORE metrics. A node's true total is
 *
 *   total(node) = own(node) + sum(total(child) for each child)
 *
 * with one rule enforced everywhere: **a node with children keeps `own` at
 * zero**. That single rule is what makes totals unambiguous. A freshly created
 * campaign with no ad sets can be typed into directly (the numbers land in
 * `own`); the moment it gains a child, its `own` is pushed down into that child
 * so nothing is double-counted and no figure is silently lost.
 *
 * Editing a parent total therefore never stores a second copy of the truth --
 * it redistributes the new total across the descendants in their existing
 * proportions (see `setCore`). Leaves are always the source of truth.
 *
 * CALCULATED metrics are never stored. They are recomputed from CORE on every
 * read. An impossible calculation (divide by zero, missing input) returns
 * `null`, which the UI renders as an em dash -- never NaN, never Infinity.
 */

/* ------------------------------------------------------------------ metrics */

/** Metrics the user types. Everything else is derived from these. */
export const CORE = [
  'spend', 'impressions', 'reach', 'clicks', 'results', 'conversions', 'revenue'
];

/** Metrics the engine computes. Never stored, always recalculated. */
export const CALC = [
  'ctr', 'cpc', 'cpm', 'costPerResult', 'cvr', 'roas', 'frequency', 'cpmReach'
];

/**
 * One description per metric, shared by the engine and the UI so a label or a
 * rounding rule can never drift between them.
 *
 *   kind  core | calc
 *   fmt   money | int | pct | ratio | money4 (cost-per figures, finer rounding)
 *   int   true when the value has no meaningful fractional part
 */
export const METRICS = {
  spend:       { label: 'Amount spent',     short: 'Spend',   kind: 'core', fmt: 'money', int: false },
  impressions: { label: 'Impressions',      short: 'Impr.',   kind: 'core', fmt: 'int',   int: true  },
  reach:       { label: 'Reach',            short: 'Reach',   kind: 'core', fmt: 'int',   int: true  },
  clicks:      { label: 'Link clicks',      short: 'Clicks',  kind: 'core', fmt: 'int',   int: true  },
  results:     { label: 'Results',          short: 'Results', kind: 'core', fmt: 'int',   int: true  },
  conversions: { label: 'Conversions',      short: 'Conv.',   kind: 'core', fmt: 'int',   int: true  },
  revenue:     { label: 'Conversion value', short: 'Value',   kind: 'core', fmt: 'money', int: false },

  ctr:           { label: 'CTR',                    short: 'CTR',   kind: 'calc', fmt: 'pct'    },
  cpc:           { label: 'CPC',                    short: 'CPC',   kind: 'calc', fmt: 'money4' },
  cpm:           { label: 'CPM',                    short: 'CPM',   kind: 'calc', fmt: 'money4' },
  costPerResult: { label: 'Cost per result',        short: 'CPR',   kind: 'calc', fmt: 'money4' },
  cvr:           { label: 'Conversion rate',        short: 'CVR',   kind: 'calc', fmt: 'pct'    },
  roas:          { label: 'ROAS',                   short: 'ROAS',  kind: 'calc', fmt: 'ratio'  },
  frequency:     { label: 'Frequency',              short: 'Freq.', kind: 'calc', fmt: 'ratio'  },
  cpmReach:      { label: 'Cost per 1,000 reached', short: 'CP1K',  kind: 'calc', fmt: 'money4' }
};

/* ------------------------------------------------------------------ numbers */

/** Coerce anything the user or storage hands us into a finite, non-negative number. */
export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n;                      /* negative spend or clicks is nonsense */
}

/** Round to `dp` without the float drift that makes 1.005 round down. */
export function round(n, dp = 2) {
  if (!Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round((n + Number.EPSILON) * f) / f;
}

/**
 * Divide, refusing to invent a number.
 *
 * Returns null whenever the result would be meaningless -- a zero denominator,
 * or a non-finite operand. The UI shows null as an em dash, exactly as Ads
 * Manager shows a metric it cannot compute.
 */
export function safeDiv(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return null;
  const r = a / b;
  return Number.isFinite(r) ? r : null;
}

/* ------------------------------------------------------------------- shapes */

let seq = 0;
/** Ids are only ever compared for equality, so this is enough and stays offline. */
export function uid(prefix) {
  seq += 1;
  return (prefix || 'n') + '_' + Date.now().toString(36) + seq.toString(36) +
         Math.random().toString(36).slice(2, 6);
}

export function emptyMetrics() {
  const m = {};
  for (const k of CORE) m[k] = 0;
  return m;
}

/** Normalise an incoming metrics bag: known keys only, all finite, all >= 0. */
export function cleanMetrics(src) {
  const s = src || {};
  const m = emptyMetrics();
  for (const k of CORE) m[k] = num(s[k]);
  return m;
}

/**
 * Overrides let a power user pin a CALCULATED metric to a value the inputs do
 * not produce. Only CALC keys are accepted -- a "pinned" core metric would just
 * be the core metric.
 */
function cleanOverrides(src) {
  const o = {};
  if (!src) return o;
  for (const k of CALC) {
    if (src[k] !== null && src[k] !== undefined && src[k] !== '') {
      const n = num(src[k]);
      if (Number.isFinite(n)) o[k] = n;
    }
  }
  return o;
}

export const STATUSES = ['active', 'paused', 'completed', 'draft'];
const status = s => (STATUSES.includes(s) ? s : 'active');

export function makeAd(o) {
  const s = o || {};
  return {
    id: s.id || uid('ad'),
    name: s.name || 'New ad',
    status: status(s.status),
    format: s.format || 'Single image',
    own: cleanMetrics(s.own || s.metrics),
    overrides: cleanOverrides(s.overrides)
  };
}

export function makeAdSet(o) {
  const s = o || {};
  return {
    id: s.id || uid('as'),
    name: s.name || 'New ad set',
    status: status(s.status),
    budget: num(s.budget),
    budgetType: s.budgetType === 'lifetime' ? 'lifetime' : 'daily',
    optimisation: s.optimisation || 'Conversions',
    placement: s.placement || 'Advantage+ placements',
    platform: s.platform || 'Facebook, Instagram',
    audience: s.audience || '',
    own: cleanMetrics(s.own),
    overrides: cleanOverrides(s.overrides),
    ads: Array.isArray(s.ads) ? s.ads.map(makeAd) : []
  };
}

export function makeCampaign(o) {
  const s = o || {};
  return {
    id: s.id || uid('cmp'),
    name: s.name || 'New campaign',
    status: status(s.status),
    objective: s.objective || 'Sales',
    budget: num(s.budget),
    budgetType: s.budgetType === 'lifetime' ? 'lifetime' : 'daily',
    startDate: s.startDate || '',
    endDate: s.endDate || '',
    own: cleanMetrics(s.own),
    overrides: cleanOverrides(s.overrides),
    adsets: Array.isArray(s.adsets) ? s.adsets.map(makeAdSet) : []
  };
}

export const CURRENCIES = {
  EGP: { symbol: 'E£', code: 'EGP' },
  USD: { symbol: '$',       code: 'USD' },
  SAR: { symbol: 'SR',      code: 'SAR' },
  AED: { symbol: 'AED',     code: 'AED' },
  EUR: { symbol: '€',  code: 'EUR' },
  GBP: { symbol: '£',  code: 'GBP' }
};

/** How the modelled daily curve is shaped across the date range. */
export const TREND_SHAPES = ['steady', 'ramp-up', 'ramp-down', 'spike', 'scaling'];

/** Objectives, and the result each one counts — mirrors how Ads Manager labels them. */
export const OBJECTIVES = {
  'Sales':         'Purchases',
  'Leads':         'Leads',
  'Engagement':    'Messaging conversations started',
  'Traffic':       'Link clicks',
  'Awareness':     'Reach',
  'App promotion': 'App installs',
  'Video views':   'ThruPlays'
};

export function makeCaseStudy(o) {
  const s = o || {};
  const now = new Date().toISOString();
  return {
    id: s.id || uid('cs'),
    brand: s.brand || 'Untitled brand',
    title: s.title || '',
    industry: s.industry || '',
    objective: s.objective || 'Sales',
    resultLabel: s.resultLabel || OBJECTIVES[s.objective] || 'Purchases',
    currency: CURRENCIES[s.currency] ? s.currency : 'EGP',
    startDate: s.startDate || monthStart(),
    endDate: s.endDate || monthEnd(),
    trend: TREND_SHAPES.includes(s.trend) ? s.trend : 'steady',
    notes: s.notes || '',
    createdAt: s.createdAt || now,
    updatedAt: s.updatedAt || now,
    campaigns: Array.isArray(s.campaigns) ? s.campaigns.map(makeCampaign) : []
  };
}

function pad(n) { return String(n).padStart(2, '0'); }
export function isoDate(d) {
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
function monthStart() { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth(), 1)); }
function monthEnd()   { const d = new Date(); return isoDate(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }

/* --------------------------------------------------------------- traversal */

/** The children of any node, whatever level it sits at. */
export function childrenOf(node) {
  if (!node) return [];
  if (Array.isArray(node.campaigns)) return node.campaigns;
  if (Array.isArray(node.adsets))    return node.adsets;
  if (Array.isArray(node.ads))       return node.ads;
  return [];
}

/** The key under which a node stores its children, or null for a leaf. */
export function childKey(node) {
  if (!node) return null;
  if (Array.isArray(node.campaigns)) return 'campaigns';
  if (Array.isArray(node.adsets))    return 'adsets';
  if (Array.isArray(node.ads))       return 'ads';
  return null;
}

export function levelOf(node) {
  if (!node) return 'unknown';
  if (Array.isArray(node.campaigns)) return 'case';
  if (Array.isArray(node.adsets))    return 'campaign';
  if (Array.isArray(node.ads))       return 'adset';
  return 'ad';
}

/** `levelOf` values are keys; these are what a person should read. */
export const LEVEL_LABELS = {
  case: 'case study', campaign: 'campaign', adset: 'ad set', ad: 'ad', unknown: 'item'
};

export const levelLabel = node => LEVEL_LABELS[levelOf(node)] || 'item';

/** Depth-first walk over every node beneath (and including) `node`. */
export function walk(node, fn, parent) {
  if (!node) return;
  fn(node, parent || null);
  for (const c of childrenOf(node)) walk(c, fn, node);
}

/** Find a node and its parent anywhere in the tree. */
export function findNode(root, id) {
  let hit = null;
  walk(root, (n, p) => { if (!hit && n && n.id === id) hit = { node: n, parent: p }; });
  return hit;
}

/* --------------------------------------------------------------- aggregation */

/**
 * Total CORE metrics for a node: its own bucket plus every descendant's.
 *
 * `reach` is summed like the rest, then capped at impressions. Real Ads Manager
 * deduplicates reach across ad sets and cannot tell us the overlap, so a plain
 * sum is the honest simplification -- but a reach above impressions is
 * arithmetically impossible, so the cap keeps frequency at 1.00 or above. When
 * the cap bites, `validate()` raises it rather than hiding it.
 */
export function rollup(node) {
  const t = emptyMetrics();
  if (!node) return t;

  const kids = childrenOf(node);
  if (kids.length) {
    for (const c of kids) {
      const ct = rollup(c);
      for (const k of CORE) t[k] += ct[k];
    }
  } else {
    const own = cleanMetrics(node.own);
    for (const k of CORE) t[k] += own[k];
  }

  if (t.reach > t.impressions) t.reach = t.impressions;

  /* Money carries cents; counts are whole. Round once per rollup so a deep
     tree cannot accumulate float dust. */
  t.spend   = round(t.spend, 2);
  t.revenue = round(t.revenue, 2);
  for (const k of ['impressions', 'reach', 'clicks', 'results', 'conversions']) {
    t[k] = Math.round(t[k]);
  }
  return t;
}

function mulOrNull(v, by) { return v === null ? null : v * by; }
function pctOf(v)         { return v === null ? null : round(v * 100, 2); }

/**
 * The calculated metrics for a set of CORE totals.
 *
 * Every one of these can be impossible, and each returns null when it is.
 */
export function derive(core) {
  const c = cleanMetrics(core);
  return {
    ctr:           pctOf(safeDiv(c.clicks, c.impressions)),
    cpc:           round(safeDiv(c.spend, c.clicks), 2),
    cpm:           round(mulOrNull(safeDiv(c.spend, c.impressions), 1000), 2),
    costPerResult: round(safeDiv(c.spend, c.results), 2),
    cvr:           pctOf(safeDiv(c.conversions, c.clicks)),
    roas:          round(safeDiv(c.revenue, c.spend), 2),
    frequency:     round(safeDiv(c.impressions, c.reach), 2),
    cpmReach:      round(mulOrNull(safeDiv(c.spend, c.reach), 1000), 2)
  };
}

/**
 * Everything the UI needs for one row: core totals, derived metrics, and which
 * of the derived ones have been pinned by hand.
 *
 * An override applies only to the node that carries it. A parent recomputes
 * from its own aggregate inputs, so pinning a child's CTR does not silently
 * rewrite the campaign above it -- the two are shown as what they are.
 */
export function metricsOf(node) {
  const core = rollup(node);
  const computed = derive(core);
  const calc = { ...computed };
  const over = cleanOverrides(node && node.overrides);
  const overridden = [];

  for (const k of CALC) {
    if (Object.prototype.hasOwnProperty.call(over, k)) {
      calc[k] = over[k];
      overridden.push(k);
    }
  }
  return { ...core, ...calc, overridden, computed };
}

/** Account-level totals for the whole case study. */
export function totals(caseStudy) { return metricsOf(caseStudy); }

/** Sum of every campaign budget — what the case study is nominally working with. */
export function totalBudget(caseStudy) {
  if (!caseStudy || !Array.isArray(caseStudy.campaigns)) return 0;
  return round(caseStudy.campaigns.reduce((a, c) => a + num(c.budget), 0), 2);
}

/* ------------------------------------------------------------- distribution */

/**
 * Split `total` across `weights`, keeping the parts summing to exactly `total`.
 *
 * Largest-remainder: floor every share, then hand the leftover units to the
 * entries with the biggest discarded fraction. Without this, rounding each
 * share independently lets a campaign's ads sum to something other than the
 * campaign, which is precisely the contradiction this module exists to prevent.
 */
export function distribute(total, weights, dp) {
  const places = dp === undefined ? 2 : dp;
  const n = weights.length;
  if (!n) return [];

  const f = Math.pow(10, places);
  const units = Math.round(num(total) * f);
  let sum = weights.reduce((a, w) => a + Math.max(0, num(w)), 0);

  /* Nothing to go on -- an untouched tree, or every child at zero. Split evenly
     so the edit still lands somewhere sensible. */
  const w = sum > 0 ? weights.map(x => Math.max(0, num(x))) : weights.map(() => 1);
  if (sum <= 0) sum = n;

  const exact = w.map(x => (units * x) / sum);
  const base  = exact.map(Math.floor);
  let left    = units - base.reduce((a, b) => a + b, 0);

  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);

  for (let k = 0; k < order.length && left > 0; k++) { base[order[k].i] += 1; left -= 1; }
  /* `left` can only go negative through float noise; give the units back the
     same way so the total still reconciles. */
  for (let k = order.length - 1; k >= 0 && left < 0; k--) {
    if (base[order[k].i] > 0) { base[order[k].i] -= 1; left += 1; }
  }

  return base.map(v => v / f);
}

/** Add to a node's total, recursing so the value always lands on leaves. */
function addCore(node, key, amount) {
  const kids = childrenOf(node);
  if (!kids.length) {
    node.own = cleanMetrics(node.own);
    node.own[key] = round(num(node.own[key]) + num(amount), METRICS[key].int ? 0 : 2);
    return;
  }
  const parts = distribute(amount, kids.map(c => rollup(c)[key] || 1), METRICS[key].int ? 0 : 2);
  kids.forEach((c, i) => addCore(c, key, parts[i]));
}

/**
 * Push a node's `own` bucket down into its children.
 *
 * Called when a childless node gains its first child. Without it, the numbers
 * typed into an empty campaign would be double-counted the moment an ad set
 * appeared beneath it (own + child) or -- if we simply zeroed them -- would
 * vanish without the user being told.
 */
function pushOwnDown(node) {
  const kids = childrenOf(node);
  if (!kids.length) return;

  const own = cleanMetrics(node.own);
  if (CORE.some(k => own[k] > 0)) {
    for (const k of CORE) {
      if (!own[k]) continue;
      const parts = distribute(own[k], kids.map(() => 1), METRICS[k].int ? 0 : 2);
      kids.forEach((c, i) => addCore(c, k, parts[i]));
    }
  }
  node.own = emptyMetrics();
}

/**
 * Set one CORE metric on a node, at any level.
 *
 * A leaf simply stores it. A node with children has no store of its own, so the
 * new total is redistributed across those children in their current
 * proportions -- edit a campaign's spend and its ad sets keep their relative
 * shares while summing to exactly what was typed.
 */
export function setCore(node, key, value) {
  if (!node || !CORE.includes(key)) return;
  const dp = METRICS[key].int ? 0 : 2;
  const next = round(num(value), dp);

  const kids = childrenOf(node);
  if (!kids.length) {
    node.own = cleanMetrics(node.own);
    node.own[key] = next;
    return;
  }

  const weights = kids.map(c => rollup(c)[key]);
  const parts = distribute(next, weights, dp);
  kids.forEach((c, i) => setCore(c, key, parts[i]));
}

/** Pin a calculated metric by hand. Pass null to hand it back to the engine. */
export function setOverride(node, key, value) {
  if (!node || !CALC.includes(key)) return;
  node.overrides = cleanOverrides(node.overrides);
  if (value === null || value === undefined || value === '') delete node.overrides[key];
  else node.overrides[key] = num(value);
}

export function clearOverrides(node) {
  if (node) node.overrides = {};
}

/* ------------------------------------------------------- structure editing */

/** Attach a child, first pushing any direct numbers down so nothing doubles. */
export function addChild(parent, child) {
  const key = childKey(parent);
  if (!key) return null;

  const had = parent[key].length;
  parent[key].push(child);
  /* Only on the FIRST child: after that `own` is already empty by the rule. */
  if (!had) pushOwnDown(parent);
  return child;
}

export function removeChild(parent, id) {
  const key = childKey(parent);
  if (!key) return false;
  const i = parent[key].findIndex(c => c.id === id);
  if (i < 0) return false;
  parent[key].splice(i, 1);
  return true;
}

/** Deep copy with every id reissued — used by duplicate, at any level. */
export function cloneNode(node, rename) {
  const copy = JSON.parse(JSON.stringify(node));
  walk(copy, n => { n.id = uid(String(n.id || 'n').split('_')[0]); });
  if (rename) copy.name = rename;
  return copy;
}

export function duplicateCaseStudy(cs, name) {
  const copy = makeCaseStudy(JSON.parse(JSON.stringify(cs)));
  copy.id = uid('cs');
  walk(copy, n => { if (n !== copy) n.id = uid(String(n.id || 'n').split('_')[0]); });
  copy.brand = name || (cs.brand + ' (copy)');
  copy.createdAt = copy.updatedAt = new Date().toISOString();
  return copy;
}

/* ------------------------------------------------------------- validation */

/** Reach before the impressions cap — only validate() needs to see this. */
function rawReach(node) {
  const kids = childrenOf(node);
  if (!kids.length) return num(node.own && node.own.reach);
  return kids.reduce((a, c) => a + rawReach(c), 0);
}

/**
 * Flag figures that cannot be true, so a case study is never presented with
 * arithmetic a client could pick apart.
 *
 * Returns a flat list -- the UI shows a count and the detail on demand.
 */
export function validate(caseStudy) {
  const out = [];
  if (!caseStudy) return out;

  walk(caseStudy, (node) => {
    const label = node === caseStudy ? (node.brand || 'Case study') : (node.name || 'Untitled');
    const level = levelOf(node);
    const t = rollup(node);
    const raw = rawReach(node);
    const push = (severity, text) => out.push({ id: node.id, level, label, severity, text });

    if (raw > t.impressions && t.impressions > 0) {
      push('warn', 'Reach (' + raw.toLocaleString('en-US') + ') exceeds impressions; shown capped at ' +
                   t.impressions.toLocaleString('en-US') + ' so frequency stays at 1.00 or above.');
    }
    if (t.clicks > t.impressions && t.impressions > 0) {
      push('error', 'More clicks than impressions — CTR would exceed 100%.');
    }
    if (t.conversions > t.clicks && t.clicks > 0) {
      push('warn', 'More conversions than link clicks — conversion rate is above 100%.');
    }
    if (t.spend > 0 && t.impressions === 0) {
      push('warn', 'Spend recorded with no impressions — CPM and CTR cannot be shown.');
    }
    if (t.revenue > 0 && t.spend === 0) {
      push('warn', 'Conversion value recorded with no spend — ROAS cannot be shown.');
    }
    if (node.budget !== undefined && num(node.budget) > 0 && t.spend > num(node.budget) * 1.0001) {
      push('warn', 'Amount spent is above the budget set for this ' +
                   (LEVEL_LABELS[level] || 'item') + '.');
    }
    for (const k of Object.keys(cleanOverrides(node.overrides))) {
      push('info', METRICS[k].label + ' is pinned by hand and no longer follows the inputs.');
    }
  });

  if (caseStudy.startDate && caseStudy.endDate && caseStudy.endDate < caseStudy.startDate) {
    out.push({ id: caseStudy.id, level: 'case', label: caseStudy.brand, severity: 'error',
      text: 'The end date falls before the start date.' });
  }
  return out;
}

/* ------------------------------------------------------------- time series */

/** Every ISO date from start to end inclusive, capped so a typo cannot hang the page. */
export function dateRange(start, end, cap) {
  const limit = cap || 400;
  const out = [];
  const a = new Date(start + 'T00:00:00');
  const b = new Date(end + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime()) || b < a) return out;
  const d = new Date(a);
  while (d <= b && out.length < limit) {
    out.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function daysBetween(start, end) {
  return dateRange(start, end).length || 1;
}

/** A small deterministic hash, so the same node always draws the same curve. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/**
 * Daily weights for one node across `n` days.
 *
 * The case study stores period totals, not a day-by-day log, so the shape of
 * the curve is modelled: a chosen trend plus a small wobble seeded from the
 * node's id, so it reads like real delivery and never changes between reloads.
 *
 * The weights are then used to distribute the real totals, so every chart sums
 * to exactly the figure on the summary card above it. The UI labels these as a
 * modelled daily shape — they are not per-day input.
 */
export function dailyWeights(n, shape, seed) {
  const w = [];
  for (let i = 0; i < n; i++) {
    const p = n === 1 ? 0.5 : i / (n - 1);
    let base;
    switch (shape) {
      case 'ramp-up':   base = 0.45 + 1.10 * p; break;
      case 'ramp-down': base = 1.55 - 1.10 * p; break;
      case 'spike':     base = 0.55 + 1.60 * Math.exp(-Math.pow((p - 0.62) / 0.16, 2)); break;
      case 'scaling':   base = 0.40 + 1.30 * Math.pow(p, 1.6); break;
      default:          base = 1;
    }
    /* Two offset sine terms give a believable weekly rhythm without randomness
       that would move every time the page is opened. */
    const s = hash(String(seed) + ':' + i);
    const wobble = 1 + 0.16 * Math.sin((i + s * 6) * 0.9) + 0.09 * Math.sin(i * 2.3 + s * 5);
    w.push(Math.max(0.05, base * wobble));
  }
  return w;
}

/**
 * A daily series for the given node and metric list.
 *
 * CORE metrics are distributed across the range; CALCULATED metrics are then
 * derived per day from those distributed cores, so a charted CPC is the real
 * CPC of that day's modelled spend and clicks rather than a separate invention.
 *
 * Each core metric gets its OWN wobble, seeded from the node id and the metric
 * name. That detail matters: with one shared curve every metric rises and falls
 * by the same proportion each day, so every ratio built from them — ROAS, CTR,
 * CPC, frequency — comes out as a dead flat line. Giving spend and clicks
 * slightly different days is what makes "CTR over time" a chart worth drawing,
 * and because each metric is still distributed across its own weights, every
 * series continues to add up to exactly the period total.
 */
export function series(node, caseStudy, keys) {
  const dates = dateRange(caseStudy.startDate, caseStudy.endDate);
  const out = { dates, values: {} };
  const n = dates.length;
  if (!n) return out;

  const core = rollup(node);
  const id = node.id || 'seed';
  const daily = {};
  for (const k of CORE) {
    const w = dailyWeights(n, caseStudy.trend, id + ':' + k);
    daily[k] = distribute(core[k], w, METRICS[k].int ? 0 : 2);
  }

  /* The same impossibility the rollup guards against, applied per day: reach
     above impressions would put a day's frequency below 1. */
  for (let i = 0; i < n; i++) {
    if (daily.reach[i] > daily.impressions[i]) daily.reach[i] = daily.impressions[i];
  }

  for (const key of keys) {
    if (CORE.includes(key)) {
      out.values[key] = daily[key];
    } else {
      out.values[key] = dates.map((_, i) => {
        const day = {};
        for (const k of CORE) day[k] = daily[k][i];
        return derive(day)[key];
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------- formatting */

function trim(v) {
  return (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: 1 });
}

function group(v, compact) {
  if (compact && Math.abs(v) >= 1000000) return trim(v / 1000000) + 'M';
  if (compact && Math.abs(v) >= 10000)   return trim(v / 1000) + 'K';
  const dp = Number.isInteger(v) ? 0 : 2;
  return v.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/**
 * Meta-style presentation. `compact` is for the summary cards, where a seven
 * figure spend would otherwise push the card out of shape.
 */
export function fmt(value, kind, currency, compact) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  const v = Number(value);
  const sym = (CURRENCIES[currency] || CURRENCIES.EGP).symbol;

  switch (kind) {
    case 'money':
      return sym + ' ' + group(compact ? v : round(v, 2), compact);
    case 'money4':
      /* Cost-per figures below a unit need more precision to stay useful. */
      return sym + ' ' + (Math.abs(v) < 1 && v !== 0
        ? round(v, 3).toFixed(3)
        : group(round(v, 2), false));
    case 'pct':   return round(v, 2).toFixed(2) + '%';
    case 'ratio': return round(v, 2).toFixed(2);
    case 'int':   return group(Math.round(v), compact);
    default:      return String(v);
  }
}

/** Format a metric by name, picking up its own rounding rule. */
export function fmtMetric(key, value, currency, compact) {
  const def = METRICS[key];
  return def ? fmt(value, def.fmt, currency, compact) : String(value);
}

export function fmtDateRange(start, end) {
  const a = new Date(start + 'T00:00:00'), b = new Date(end + 'T00:00:00');
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 'No date range';
  const o = { day: 'numeric', month: 'short' };
  const ay = a.getFullYear(), by = b.getFullYear();
  const left = a.toLocaleDateString('en-US', ay === by ? o : { day: 'numeric', month: 'short', year: 'numeric' });
  const right = b.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
  return left + ' – ' + right;
}
