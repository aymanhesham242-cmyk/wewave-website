/**
 * Unit tests for the case-study calculation engine.
 *
 *   node tools/test_case_engine.mjs
 *
 * The engine ships as a browser ES module (`admin/case-studies/engine.js`).
 * Node decides module vs script by file extension and the nearest package.json,
 * and this project deliberately has neither a package.json nor a build step --
 * so importing a `.js` file here would be read as CommonJS and fail on the
 * first `export`. The fix is to copy the sources to a temp folder as `.mjs`,
 * rewriting the one relative import between them. Nothing is transformed
 * beyond the extension, so what is tested is exactly what the browser loads.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC  = path.join(ROOT, 'admin', 'case-studies');
const TMP  = path.join(os.tmpdir(), 'wewave-case-engine-test');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
for (const f of ['engine.js', 'presets.js']) {
  const src = fs.readFileSync(path.join(SRC, f), 'utf8').replace(/'\.\/engine\.js'/g, "'./engine.mjs'");
  fs.writeFileSync(path.join(TMP, f.replace(/\.js$/, '.mjs')), src, 'utf8');
}

const E = await import(pathToFileURL(path.join(TMP, 'engine.mjs')).href);
const P = await import(pathToFileURL(path.join(TMP, 'presets.mjs')).href);

/* ------------------------------------------------------------------ runner */

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failures.push({ name, message: err && err.message ? err.message : String(err) });
  }
}

function eq(actual, expected, what) {
  if (actual !== expected) {
    throw new Error((what ? what + ': ' : '') + 'expected ' + JSON.stringify(expected) +
                    ', got ' + JSON.stringify(actual));
  }
}

function near(actual, expected, tol, what) {
  const t = tol === undefined ? 0.005 : tol;
  if (actual === null || Math.abs(actual - expected) > t) {
    throw new Error((what ? what + ': ' : '') + 'expected ~' + expected + ', got ' + actual);
  }
}

function ok(cond, what) {
  if (!cond) throw new Error(what || 'expected truthy');
}

/* ------------------------------------------------------------- fixtures */

/** The worked example from the brief: spend 10,000 / clicks 500 / impr 50,000. */
function briefCase() {
  return E.makeCaseStudy({
    brand: 'Brief',
    campaigns: [E.makeCampaign({
      name: 'C1',
      adsets: [E.makeAdSet({
        name: 'S1',
        ads: [E.makeAd({
          name: 'A1',
          own: { spend: 10000, impressions: 50000, reach: 25000, clicks: 500,
                 results: 100, conversions: 100, revenue: 30000 }
        })]
      })]
    })]
  });
}

/** Two ads at 2,000 and 3,000 — the tree from section 15 of the brief. */
function twoAdCase() {
  return E.makeCaseStudy({
    brand: 'Tree',
    campaigns: [E.makeCampaign({
      name: 'Campaign A',
      adsets: [E.makeAdSet({
        name: 'Ad Set 1',
        ads: [
          E.makeAd({ name: 'Ad 1', own: { spend: 2000, impressions: 20000, reach: 10000, clicks: 200, results: 20, conversions: 20, revenue: 6000 } }),
          E.makeAd({ name: 'Ad 2', own: { spend: 3000, impressions: 30000, reach: 15000, clicks: 300, results: 30, conversions: 30, revenue: 9000 } })
        ]
      })]
    })]
  });
}

/* ------------------------------------------------------- formula coverage */

check('CTR = clicks / impressions * 100', () => {
  near(E.derive({ clicks: 500, impressions: 50000 }).ctr, 1.00, 0.001);
});

check('CPC = spend / clicks', () => {
  near(E.derive({ spend: 10000, clicks: 500 }).cpc, 20.00, 0.001);
});

check('CPM = spend / impressions * 1000', () => {
  near(E.derive({ spend: 10000, impressions: 50000 }).cpm, 200.00, 0.001);
});

check('Cost per result = spend / results', () => {
  near(E.derive({ spend: 10000, results: 100 }).costPerResult, 100.00, 0.001);
});

check('Conversion rate = conversions / clicks * 100', () => {
  near(E.derive({ conversions: 50, clicks: 500 }).cvr, 10.00, 0.001);
});

check('ROAS = revenue / spend', () => {
  near(E.derive({ revenue: 30000, spend: 10000 }).roas, 3.00, 0.001);
});

check('Frequency = impressions / reach', () => {
  near(E.derive({ impressions: 50000, reach: 25000 }).frequency, 2.00, 0.001);
});

check('Cost per 1,000 reached = spend / reach * 1000', () => {
  near(E.derive({ spend: 10000, reach: 25000 }).cpmReach, 400.00, 0.001);
});

check("the brief's worked example: 10,000 / 500 / 50,000 -> 1%, 20, 200", () => {
  const m = E.totals(briefCase());
  near(m.ctr, 1.00, 0.001, 'CTR');
  near(m.cpc, 20.00, 0.001, 'CPC');
  near(m.cpm, 200.00, 0.001, 'CPM');
});

check('changing spend to 12,000 moves CPC and CPM, not CTR', () => {
  const cs = briefCase();
  const ad = E.findNode(cs, cs.campaigns[0].adsets[0].ads[0].id).node;
  E.setCore(ad, 'spend', 12000);
  const m = E.totals(cs);
  near(m.cpc, 24.00, 0.001, 'CPC');
  near(m.cpm, 240.00, 0.001, 'CPM');
  near(m.ctr, 1.00, 0.001, 'CTR unchanged');
});

check('changing clicks to 600 moves CTR and CPC', () => {
  const cs = briefCase();
  const ad = cs.campaigns[0].adsets[0].ads[0];
  E.setCore(ad, 'clicks', 600);
  const m = E.totals(cs);
  near(m.ctr, 1.20, 0.001, 'CTR');
  near(m.cpc, 16.67, 0.01, 'CPC');
});

check('changing revenue moves ROAS', () => {
  const cs = briefCase();
  E.setCore(cs.campaigns[0].adsets[0].ads[0], 'revenue', 45000);
  near(E.totals(cs).roas, 4.50, 0.001);
});

check('changing results moves cost per result', () => {
  const cs = briefCase();
  E.setCore(cs.campaigns[0].adsets[0].ads[0], 'results', 250);
  near(E.totals(cs).costPerResult, 40.00, 0.001);
});

/* ------------------------------------------------ impossible calculations */

check('zero impressions gives no CTR, CPM or frequency', () => {
  const d = E.derive({ spend: 500, impressions: 0, clicks: 0, reach: 0 });
  eq(d.ctr, null, 'CTR'); eq(d.cpm, null, 'CPM'); eq(d.frequency, null, 'frequency');
});

check('zero clicks gives no CPC and no conversion rate', () => {
  const d = E.derive({ spend: 500, clicks: 0, conversions: 0 });
  eq(d.cpc, null, 'CPC'); eq(d.cvr, null, 'CVR');
});

check('zero spend gives no ROAS', () => {
  eq(E.derive({ revenue: 900, spend: 0 }).roas, null);
});

check('zero results gives no cost per result', () => {
  eq(E.derive({ spend: 900, results: 0 }).costPerResult, null);
});

check('nothing ever returns NaN or Infinity', () => {
  const nasty = [
    {}, { spend: NaN }, { clicks: Infinity }, { impressions: -5 },
    { spend: 'abc', clicks: null, impressions: undefined },
    { spend: 1e12, impressions: 1, reach: 1, clicks: 1, results: 1, conversions: 1, revenue: 1e12 }
  ];
  for (const input of nasty) {
    const d = E.derive(input);
    for (const k of E.CALC) {
      const v = d[k];
      ok(v === null || Number.isFinite(v), k + ' from ' + JSON.stringify(input) + ' was ' + v);
    }
  }
});

check('negative input is clamped to zero rather than inverting a metric', () => {
  eq(E.num(-40), 0);
  const d = E.derive({ spend: -100, clicks: 10 });
  eq(d.cpc, 0);
});

check('an empty case study totals to zero and shows dashes', () => {
  const cs = E.makeCaseStudy({ brand: 'Empty' });
  const m = E.totals(cs);
  for (const k of E.CORE) eq(m[k], 0, k);
  eq(m.ctr, null); eq(m.roas, null);
  eq(E.fmtMetric('ctr', m.ctr, 'EGP'), '—');
});

check('an empty campaign contributes nothing and breaks nothing', () => {
  const cs = twoAdCase();
  E.addChild(cs, E.makeCampaign({ name: 'Empty campaign' }));
  eq(E.totals(cs).spend, 5000);
  eq(E.validate(cs).filter(v => v.severity === 'error').length, 0);
});

/* ------------------------------------------------------------ aggregation */

check('ad set total is the sum of its ads', () => {
  const cs = twoAdCase();
  eq(E.rollup(cs.campaigns[0].adsets[0]).spend, 5000);
});

check('campaign total is the sum of its ad sets', () => {
  const cs = twoAdCase();
  eq(E.rollup(cs.campaigns[0]).spend, 5000);
});

check('account total is the sum of its campaigns', () => {
  const cs = twoAdCase();
  E.addChild(cs, E.makeCampaign({
    name: 'Campaign B',
    adsets: [E.makeAdSet({ name: 'S', ads: [E.makeAd({ name: 'A', own: { spend: 1500 } })] })]
  }));
  eq(E.totals(cs).spend, 6500);
});

check("the brief's example: Ad 2 2,000 -> 3,000 -> 4,000 rolls up to 6,000", () => {
  const cs = twoAdCase();
  E.setCore(cs.campaigns[0].adsets[0].ads[1], 'spend', 4000);
  eq(E.rollup(cs.campaigns[0]).spend, 6000);
  eq(E.totals(cs).spend, 6000);
});

check('every level agrees with every other level', () => {
  const cs = P.fromTemplate('ecommerce', { seed: 'agree' });
  const acct = E.totals(cs).spend;
  const viaCampaigns = cs.campaigns.reduce((a, c) => a + E.rollup(c).spend, 0);
  const viaAdSets = cs.campaigns.flatMap(c => c.adsets).reduce((a, s) => a + E.rollup(s).spend, 0);
  const viaAds = cs.campaigns.flatMap(c => c.adsets).flatMap(s => s.ads)
    .reduce((a, d) => a + d.own.spend, 0);
  near(acct, E.round(viaCampaigns, 2), 0.02, 'campaigns');
  near(acct, E.round(viaAdSets, 2), 0.02, 'ad sets');
  near(acct, E.round(viaAds, 2), 0.02, 'ads');
});

check('deleting an ad removes exactly its contribution', () => {
  const cs = twoAdCase();
  const set = cs.campaigns[0].adsets[0];
  E.removeChild(set, set.ads[1].id);
  eq(E.totals(cs).spend, 2000);
  eq(E.totals(cs).clicks, 200);
});

check('deleting a campaign removes its whole subtree', () => {
  const cs = twoAdCase();
  E.removeChild(cs, cs.campaigns[0].id);
  eq(E.totals(cs).spend, 0);
  eq(cs.campaigns.length, 0);
});

/* --------------------------------------------------- editing above a leaf */

check('editing campaign spend redistributes to ads in proportion', () => {
  const cs = twoAdCase();
  const c = cs.campaigns[0];
  E.setCore(c, 'spend', 10000);                       /* was 5000: 2000 / 3000 */
  eq(E.rollup(c).spend, 10000, 'campaign total');
  eq(c.adsets[0].ads[0].own.spend, 4000, 'ad 1 keeps its 40% share');
  eq(c.adsets[0].ads[1].own.spend, 6000, 'ad 2 keeps its 60% share');
});

check('a parent edit never leaves the children summing to something else', () => {
  const cs = P.fromTemplate('fashion', { seed: 'redistribute' });
  for (const v of [33333.33, 1, 0, 987654.21]) {
    E.setCore(cs, 'spend', v);
    eq(E.totals(cs).spend, E.round(v, 2), 'account spend after setting ' + v);
  }
});

check('integer metrics redistribute without losing or inventing a unit', () => {
  const cs = P.fromTemplate('leadgen', { seed: 'ints' });
  E.setCore(cs, 'clicks', 9997);
  eq(E.totals(cs).clicks, 9997);
  const leafSum = cs.campaigns.flatMap(c => c.adsets).flatMap(s => s.ads)
    .reduce((a, d) => a + d.own.clicks, 0);
  eq(leafSum, 9997, 'leaves sum to the typed total');
});

check('a childless campaign can be typed into directly', () => {
  const cs = E.makeCaseStudy({ brand: 'Direct' });
  const c = E.addChild(cs, E.makeCampaign({ name: 'Solo' }));
  E.setCore(c, 'spend', 7500);
  E.setCore(c, 'clicks', 300);
  eq(E.totals(cs).spend, 7500);
  near(E.totals(cs).cpc, 25.00, 0.001);
});

check('adding the first child pushes direct numbers down, never doubling them', () => {
  const cs = E.makeCaseStudy({ brand: 'Push' });
  const c = E.addChild(cs, E.makeCampaign({ name: 'Solo' }));
  E.setCore(c, 'spend', 6000);
  E.setCore(c, 'results', 30);

  E.addChild(c, E.makeAdSet({ name: 'First set' }));
  eq(E.rollup(c).spend, 6000, 'spend survives the move');
  eq(E.rollup(c).results, 30, 'results survive the move');
  eq(c.own.spend, 0, 'the parent no longer holds its own copy');
  eq(E.rollup(c.adsets[0]).spend, 6000, 'the child now holds it');
});

/* ---------------------------------------------------------- reach and caps */

check('reach is capped at impressions so frequency never drops below 1', () => {
  const cs = E.makeCaseStudy({
    brand: 'Reach',
    campaigns: [E.makeCampaign({
      name: 'C',
      adsets: [E.makeAdSet({
        name: 'S',
        ads: [
          E.makeAd({ name: 'A', own: { impressions: 1000, reach: 900 } }),
          E.makeAd({ name: 'B', own: { impressions: 1000, reach: 900 } })
        ]
      })]
    })]
  });
  const m = E.totals(cs);
  eq(m.impressions, 2000);
  eq(m.reach, 1800, 'under the cap, reach simply sums');
  ok(m.frequency >= 1, 'frequency stays at or above 1');
});

check('an impossible reach is capped and reported rather than hidden', () => {
  const cs = E.makeCaseStudy({
    brand: 'Overreach',
    campaigns: [E.makeCampaign({ name: 'C', adsets: [E.makeAdSet({ name: 'S',
      ads: [E.makeAd({ name: 'A', own: { impressions: 1000, reach: 5000 } })] })] })]
  });
  eq(E.totals(cs).reach, 1000, 'capped');
  ok(E.validate(cs).some(v => /exceeds impressions/.test(v.text)), 'raised as a warning');
});

/* --------------------------------------------------------------- overrides */

check('an override replaces the calculated value and is flagged', () => {
  const cs = briefCase();
  const ad = cs.campaigns[0].adsets[0].ads[0];
  E.setOverride(ad, 'ctr', 3.5);
  const m = E.metricsOf(ad);
  eq(m.ctr, 3.5, 'shown value');
  ok(m.overridden.includes('ctr'), 'flagged as pinned');
  near(m.computed.ctr, 1.00, 0.001, 'the real value is still available');
});

check('an override does not leak into the parent total', () => {
  const cs = briefCase();
  E.setOverride(cs.campaigns[0].adsets[0].ads[0], 'ctr', 99);
  near(E.totals(cs).ctr, 1.00, 0.001, 'account CTR still follows the inputs');
});

check('clearing an override hands the metric back to the engine', () => {
  const cs = briefCase();
  const ad = cs.campaigns[0].adsets[0].ads[0];
  E.setOverride(ad, 'ctr', 3.5);
  E.setOverride(ad, 'ctr', null);
  near(E.metricsOf(ad).ctr, 1.00, 0.001);
  eq(E.metricsOf(ad).overridden.length, 0);
});

check('a core metric cannot be pinned — only calculated ones', () => {
  const ad = E.makeAd({ own: { spend: 100 } });
  E.setOverride(ad, 'spend', 999);
  eq(E.metricsOf(ad).spend, 100);
});

/* ------------------------------------------------------- duplicate / clone */

check('duplicating a case study copies the numbers and reissues every id', () => {
  const a = P.fromTemplate('beauty', { seed: 'dup' });
  const b = E.duplicateCaseStudy(a, 'Copy');
  eq(E.totals(b).spend, E.totals(a).spend, 'same totals');
  ok(b.id !== a.id, 'new case id');

  const ids = new Set();
  E.walk(a, n => ids.add(n.id));
  let clash = 0;
  E.walk(b, n => { if (ids.has(n.id)) clash++; });
  eq(clash, 0, 'no id is shared between the original and the copy');
});

check('editing a duplicate leaves the original alone', () => {
  const a = P.fromTemplate('beauty', { seed: 'dup2' });
  const before = E.totals(a).spend;
  const b = E.duplicateCaseStudy(a, 'Copy');
  E.setCore(b, 'spend', 1);
  eq(E.totals(a).spend, before);
});

/* ------------------------------------------------------ round-trip through storage */

check('a case study survives JSON round-tripping unchanged', () => {
  const a = P.fromTemplate('realestate', { seed: 'json' });
  E.setOverride(a.campaigns[0], 'roas', 7.5);
  const b = E.makeCaseStudy(JSON.parse(JSON.stringify(a)));
  eq(E.totals(b).spend, E.totals(a).spend, 'spend');
  eq(E.totals(b).impressions, E.totals(a).impressions, 'impressions');
  eq(E.metricsOf(b.campaigns[0]).roas, 7.5, 'override survives');
  eq(b.campaigns[0].adsets.length, a.campaigns[0].adsets.length, 'structure');
});

check('malformed stored data is repaired rather than throwing', () => {
  const junk = {
    brand: 'Junk', currency: 'XXX', startDate: 'nonsense',
    campaigns: [{ name: 'C', adsets: 'not an array', own: { spend: 'abc', clicks: -4 } }]
  };
  const cs = E.makeCaseStudy(junk);
  eq(cs.currency, 'EGP', 'unknown currency falls back');
  ok(Array.isArray(cs.campaigns[0].adsets), 'adsets repaired to an array');
  eq(E.rollup(cs).spend, 0, 'unparseable spend becomes zero');
  eq(E.rollup(cs).clicks, 0, 'negative clicks become zero');
});

/* ------------------------------------------------------------- validation */

check('more clicks than impressions is an error', () => {
  const cs = E.makeCaseStudy({ brand: 'Bad', campaigns: [E.makeCampaign({ name: 'C',
    adsets: [E.makeAdSet({ name: 'S', ads: [E.makeAd({ own: { impressions: 100, clicks: 900 } })] })] })] });
  ok(E.validate(cs).some(v => v.severity === 'error'));
});

check('a clean preset raises no errors', () => {
  for (const t of P.TEMPLATES) {
    const cs = P.fromTemplate(t.key, { seed: 'clean-' + t.key });
    const errs = E.validate(cs).filter(v => v.severity === 'error');
    eq(errs.length, 0, t.key + ' raised: ' + errs.map(e => e.text).join('; '));
  }
});

/**
 * Presets are the numbers a case study starts from, so an implausible one is a
 * real defect: it undermines every case study built on top of it. These bounds
 * are ordinary market ranges, and they exist to catch a benchmark edited into
 * fantasy territory — an early draft of these templates produced ROAS figures
 * between 9 and 16, which no client would have believed.
 */
check('presets produce believable metrics', () => {
  for (const t of P.TEMPLATES) {
    const cs = P.fromTemplate(t.key, { seed: 'sane-' + t.key });
    const m = E.totals(cs);
    ok(m.ctr > 0.5 && m.ctr < 4, t.key + ' CTR out of range: ' + m.ctr);
    ok(m.frequency >= 1.2 && m.frequency < 4, t.key + ' frequency out of range: ' + m.frequency);
    ok(m.cpm > 15 && m.cpm < 150, t.key + ' CPM out of range: ' + m.cpm);
    ok(m.clicks < m.impressions, t.key + ' more clicks than impressions');
    ok(m.results < m.clicks, t.key + ' more results than clicks');
    ok(m.spend > 0 && m.results > 0, t.key + ' produced no spend or results');
    ok(m.costPerResult > 5, t.key + ' cost per result is implausibly low: ' + m.costPerResult);
    if (m.revenue > 0) ok(m.roas > 1.5 && m.roas < 8, t.key + ' ROAS out of range: ' + m.roas);
  }
});

/* ------------------------------------------------------------ time series */

check('a daily series sums to exactly the node total', () => {
  const cs = P.fromTemplate('ecommerce', { seed: 'series', startDate: '2026-09-01', endDate: '2026-09-30' });
  const s = E.series(cs, cs, ['spend', 'results']);
  eq(s.dates.length, 30, 'day count');
  near(s.values.spend.reduce((a, b) => a + b, 0), E.totals(cs).spend, 0.02, 'spend');
  eq(s.values.results.reduce((a, b) => a + b, 0), E.totals(cs).results, 'results');
});

check('a calculated series is derived per day, not invented', () => {
  const cs = P.fromTemplate('beauty', { seed: 'calcseries', startDate: '2026-09-01', endDate: '2026-09-10' });
  const s = E.series(cs, cs, ['spend', 'clicks', 'cpc']);
  for (let i = 0; i < s.dates.length; i++) {
    const expected = E.round(s.values.spend[i] / s.values.clicks[i], 2);
    eq(s.values.cpc[i], expected, 'day ' + i);
  }
});

/**
 * Guards a real defect that shipped in a first draft: every core metric shared
 * one daily curve, so all of them moved together and every ratio derived from
 * them came out as a flat line. "ROAS over time" drawn as a straight horizontal
 * line is worse than no chart at all.
 */
check('derived series actually vary day to day', () => {
  const cs = P.fromTemplate('ecommerce', { seed: 'vary', startDate: '2026-09-01', endDate: '2026-09-30' });
  const s = E.series(cs, cs, ['roas', 'ctr', 'cpc']);
  for (const key of ['roas', 'ctr', 'cpc']) {
    const vals = s.values[key].filter(v => v !== null);
    const min = Math.min(...vals), max = Math.max(...vals);
    const spread = (max - min) / ((min + max) / 2);
    ok(spread > 0.05, key + ' is effectively flat (spread ' + (spread * 100).toFixed(1) + '%)');
    ok(spread < 1.5, key + ' swings implausibly (spread ' + (spread * 100).toFixed(1) + '%)');
  }
});

check('a daily series never puts frequency below 1', () => {
  for (const t of P.TEMPLATES) {
    const cs = P.fromTemplate(t.key, { seed: 'freq-' + t.key, startDate: '2026-09-01', endDate: '2026-09-30' });
    const s = E.series(cs, cs, ['frequency']);
    for (const v of s.values.frequency) {
      if (v !== null) ok(v >= 1, t.key + ' produced a daily frequency of ' + v);
    }
  }
});

check('the series is stable across calls', () => {
  const cs = P.fromTemplate('fashion', { seed: 'stable', startDate: '2026-09-01', endDate: '2026-09-20' });
  eq(JSON.stringify(E.series(cs, cs, ['spend'])), JSON.stringify(E.series(cs, cs, ['spend'])));
});

check('a single-day and a reversed range are both handled', () => {
  const cs = P.fromTemplate('local', { seed: 'oneday', startDate: '2026-09-05', endDate: '2026-09-05' });
  eq(E.series(cs, cs, ['spend']).dates.length, 1);
  near(E.series(cs, cs, ['spend']).values.spend[0], E.totals(cs).spend, 0.02);

  cs.endDate = '2026-09-01';
  eq(E.series(cs, cs, ['spend']).dates.length, 0, 'reversed range yields nothing, not a hang');
  ok(E.validate(cs).some(v => /end date/i.test(v.text)), 'and is reported');
});

/* ------------------------------------------------------------- formatting */

check('formatting rounds to the documented places', () => {
  eq(E.fmtMetric('ctr', 1.23456, 'EGP'), '1.23%');
  eq(E.fmtMetric('roas', 3.14159, 'EGP'), '3.14');
  eq(E.fmtMetric('frequency', 2.005, 'EGP'), '2.01');
  eq(E.fmtMetric('impressions', 1234567, 'EGP'), '1,234,567');
  eq(E.fmtMetric('cpc', 20, 'USD'), '$ 20');
});

check('null formats as an em dash everywhere', () => {
  for (const k of E.CALC) eq(E.fmtMetric(k, null, 'EGP'), '—', k);
});

check('compact formatting is only used where asked for', () => {
  eq(E.fmtMetric('impressions', 1250000, 'EGP', true), '1.3M');
  eq(E.fmtMetric('impressions', 1250000, 'EGP', false), '1,250,000');
});

/* ------------------------------------------------------------- distribute */

check('distribute always sums back to the original total', () => {
  const cases = [
    [100, [1, 1, 1]], [10000, [3, 7]], [1, [1, 1, 1, 1, 1, 1, 1]],
    [0, [5, 5]], [33.33, [0, 0, 0]], [999999.99, [1, 2, 3, 4, 5]]
  ];
  for (const [total, weights] of cases) {
    for (const dp of [0, 2]) {
      const parts = E.distribute(total, weights, dp);
      const sum = E.round(parts.reduce((a, b) => a + b, 0), dp);
      eq(sum, E.round(total, dp), total + ' over ' + JSON.stringify(weights) + ' at ' + dp + 'dp');
    }
  }
});

check('distribute over all-zero weights splits evenly rather than failing', () => {
  const parts = E.distribute(90, [0, 0, 0], 0);
  eq(parts.join(','), '30,30,30');
});

/* ---------------------------------------------------------------- report */

const total = passed + failures.length;
if (failures.length) {
  console.log('\n' + failures.length + ' of ' + total + ' checks FAILED\n');
  for (const f of failures) console.log('  x ' + f.name + '\n      ' + f.message);
  console.log('');
  process.exit(1);
}
console.log('\nall ' + total + ' engine checks passed\n');
