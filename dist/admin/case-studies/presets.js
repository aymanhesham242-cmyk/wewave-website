/**
 * WeWave — Case Study Analytics: preset templates.
 *
 * A preset is a starting point, never a constraint: it builds a full campaign
 * tree with plausible figures, and every one of them is editable afterwards.
 *
 * Leaf figures are GENERATED from benchmarks rather than typed in, which means
 * a preset is internally consistent the moment it lands -- impressions follow
 * from spend and CPM, clicks from CTR, results from the result rate, and value
 * from the average order value. Nothing here is a real client's reported
 * performance; the benchmarks are ordinary market ranges for the region, used
 * so the demo does not look obviously invented.
 */

import { makeAd, makeAdSet, makeCampaign, makeCaseStudy, isoDate, round } from './engine.js';

/* A seeded generator: the same preset always produces the same numbers, so a
   case study you build today looks the same tomorrow. */
function rng(seed) {
  let s = 0;
  const str = String(seed);
  for (let i = 0; i < str.length; i++) { s = (Math.imul(s, 31) + str.charCodeAt(i)) >>> 0; }
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Spread `total` over `n` weights with a little seeded variation. */
function vary(base, spread, r) {
  return base * (1 - spread + r() * spread * 2);
}

/**
 * Build one ad's metrics from a spend figure and a set of benchmarks.
 *
 * Every derived count comes from the one above it, so CTR, CPM, cost per result
 * and ROAS all land inside believable ranges without being stored anywhere.
 */
function leafMetrics(spend, b, r) {
  const cpm  = vary(b.cpm, 0.22, r);
  const ctr  = vary(b.ctr, 0.25, r);
  const rate = vary(b.resultRate, 0.28, r);
  const freq = vary(b.frequency, 0.15, r);

  const impressions = Math.round((spend / cpm) * 1000);
  const reach       = Math.round(impressions / Math.max(1.02, freq));
  const clicks      = Math.round(impressions * (ctr / 100));
  const results     = Math.max(0, Math.round(clicks * (rate / 100)));
  const revenue     = b.aov ? round(results * vary(b.aov, 0.12, r), 2) : 0;

  return {
    spend: round(spend, 2),
    impressions,
    reach,
    clicks,
    results,
    conversions: results,          /* a result IS the conversion for these objectives */
    revenue
  };
}

/**
 * Turn a template into a real case study.
 *
 * Budget is split across campaigns by weight, then across ad sets, then across
 * ads -- so the tree rolls up to very close to the template's total spend while
 * each leaf still carries its own independently generated performance.
 */
function build(t, opts) {
  const o = opts || {};
  const r = rng(o.seed || t.key);
  const today = new Date();
  const end = o.endDate || isoDate(new Date(today.getFullYear(), today.getMonth() + 1, 0));
  const start = o.startDate || isoDate(new Date(today.getFullYear(), today.getMonth(), 1));

  const campaigns = t.campaigns.map(ct => {
    const campaignSpend = t.spend * ct.weight;

    const adsets = ct.adsets.map(st => {
      const adsetSpend = campaignSpend * st.weight;

      const ads = st.ads.map(at => {
        const m = leafMetrics(adsetSpend * at.weight, t.benchmarks, r);
        return makeAd({
          name: at.name,
          status: at.status || 'active',
          format: at.format || 'Single image',
          own: m
        });
      });

      return makeAdSet({
        name: st.name,
        status: st.status || 'active',
        budget: round(vary(adsetSpend * 1.15, 0.06, r), 0),
        budgetType: 'daily',
        optimisation: st.optimisation || t.optimisation || 'Conversions',
        placement: st.placement || 'Advantage+ placements',
        platform: st.platform || 'Facebook, Instagram',
        audience: st.audience || '',
        ads
      });
    });

    return makeCampaign({
      name: ct.name,
      status: ct.status || 'active',
      objective: t.objective,
      budget: round(vary(campaignSpend * 1.15, 0.05, r), 0),
      budgetType: ct.budgetType || 'daily',
      startDate: start,
      endDate: end,
      adsets
    });
  });

  return makeCaseStudy({
    brand: o.brand || t.brand,
    title: t.title,
    industry: t.industry,
    objective: t.objective,
    resultLabel: t.resultLabel,
    currency: o.currency || t.currency || 'EGP',
    startDate: start,
    endDate: end,
    trend: t.trend || 'steady',
    notes: t.notes || '',
    campaigns
  });
}

/* ---------------------------------------------------------------- templates */

/**
 * Benchmarks are per-thousand-impression cost, click-through rate, the share of
 * clicks that become a result, average frequency, and average order value.
 * They are deliberately ordinary — a case study that claims a 40x ROAS is not
 * a case study anyone believes.
 */
export const TEMPLATES = [
  {
    key: 'ecommerce',
    name: 'E-commerce',
    blurb: 'Catalogue sales with a prospecting / retargeting split.',
    brand: 'Sample Store',
    title: 'Always-on sales',
    industry: 'E-commerce',
    objective: 'Sales',
    resultLabel: 'Purchases',
    currency: 'EGP',
    trend: 'scaling',
    spend: 84000,
    benchmarks: { cpm: 62, ctr: 1.45, resultRate: 1.7, frequency: 2.1, aov: 780 },
    campaigns: [
      {
        name: 'Sales | Prospecting | Broad', weight: 0.55, budgetType: 'daily',
        adsets: [
          { name: 'Broad 18-45 | All Egypt', weight: 0.6, audience: 'Broad, age 18-45',
            ads: [
              { name: 'UGC | Unboxing 15s', weight: 0.4, format: 'Single video' },
              { name: 'Static | Bestseller grid', weight: 0.35, format: 'Single image' },
              { name: 'UGC | Review testimonial', weight: 0.25, format: 'Single video' }
            ] },
          { name: 'Interest | Online shoppers', weight: 0.4, audience: 'Engaged shoppers',
            ads: [
              { name: 'Carousel | Top 5 products', weight: 0.55, format: 'Carousel' },
              { name: 'Static | Offer card', weight: 0.45, format: 'Single image' }
            ] }
        ]
      },
      {
        name: 'Sales | Retargeting | 30d', weight: 0.3, budgetType: 'daily',
        adsets: [
          { name: 'VV 75% + ATC 30d', weight: 1, audience: 'Add to cart, 30 days',
            ads: [
              { name: 'DPA | Dynamic catalogue', weight: 0.6, format: 'Catalogue' },
              { name: 'Static | Free delivery', weight: 0.4, format: 'Single image' }
            ] }
        ]
      },
      {
        name: 'Sales | Catalogue | Advantage+', weight: 0.15, status: 'paused', budgetType: 'lifetime',
        adsets: [
          { name: 'Advantage+ shopping', weight: 1, audience: 'Advantage+ audience',
            ads: [{ name: 'Advantage+ catalogue', weight: 1, format: 'Catalogue' }] }
        ]
      }
    ]
  },

  {
    key: 'leadgen',
    name: 'Lead generation',
    blurb: 'Instant forms plus a landing-page split for cost comparison.',
    brand: 'Sample Services Co.',
    title: 'Q3 lead engine',
    industry: 'Professional services',
    objective: 'Leads',
    resultLabel: 'Leads',
    currency: 'EGP',
    trend: 'ramp-up',
    spend: 46000,
    optimisation: 'Leads',
    benchmarks: { cpm: 48, ctr: 1.15, resultRate: 11.5, frequency: 1.9, aov: 110 },
    campaigns: [
      {
        name: 'Leads | Instant form', weight: 0.6,
        adsets: [
          { name: 'Broad | Cairo + Giza', weight: 0.55, audience: 'Cairo, Giza 25-55', optimisation: 'Leads',
            ads: [
              { name: 'Static | Free consultation', weight: 0.5, format: 'Single image' },
              { name: 'Video | Founder explainer', weight: 0.5, format: 'Single video' }
            ] },
          { name: 'Lookalike 1% | Past leads', weight: 0.45, audience: 'LLA 1% of leads', optimisation: 'Leads',
            ads: [{ name: 'Static | Case result', weight: 1, format: 'Single image' }] }
        ]
      },
      {
        name: 'Leads | Landing page', weight: 0.4,
        adsets: [
          { name: 'Interest stack | Decision makers', weight: 1, audience: 'Business interests',
            ads: [
              { name: 'Static | Pricing teaser', weight: 0.45, format: 'Single image' },
              { name: 'Carousel | Service menu', weight: 0.3, format: 'Carousel' },
              { name: 'Video | 30s proof reel', weight: 0.25, format: 'Single video' }
            ] }
        ]
      }
    ]
  },

  {
    key: 'restaurant',
    name: 'Restaurant',
    blurb: 'Local reach and delivery orders around branch locations.',
    brand: 'Sample Kitchen',
    title: 'Branch launch month',
    industry: 'Food & beverage',
    objective: 'Engagement',
    resultLabel: 'Messaging conversations started',
    currency: 'EGP',
    trend: 'spike',
    spend: 28000,
    optimisation: 'Conversations',
    benchmarks: { cpm: 38, ctr: 1.9, resultRate: 7.8, frequency: 2.6, aov: 60 },
    campaigns: [
      {
        name: 'Engagement | Click to WhatsApp', weight: 0.65,
        adsets: [
          { name: 'Radius 5km | New Cairo', weight: 0.5, audience: '5km radius, 18-50',
            ads: [
              { name: 'Video | Kitchen b-roll', weight: 0.55, format: 'Single video' },
              { name: 'Static | Combo offer', weight: 0.45, format: 'Single image' }
            ] },
          { name: 'Radius 5km | Sheikh Zayed', weight: 0.5, audience: '5km radius, 18-50',
            ads: [{ name: 'Static | Family bucket', weight: 1, format: 'Single image' }] }
        ]
      },
      {
        name: 'Awareness | Branch opening', weight: 0.35,
        adsets: [
          { name: 'Broad local reach', weight: 1, audience: 'Local, broad', optimisation: 'Reach',
            ads: [
              { name: 'Reel | Opening day', weight: 0.6, format: 'Reels' },
              { name: 'Static | Location card', weight: 0.4, format: 'Single image' }
            ] }
        ]
      }
    ]
  },

  {
    key: 'beauty',
    name: 'Beauty',
    blurb: 'UGC-led skincare or cosmetics sales with a creator testing set.',
    brand: 'Sample Beauty',
    title: 'Body mist launch',
    industry: 'Beauty & cosmetics',
    objective: 'Sales',
    resultLabel: 'Purchases',
    currency: 'EGP',
    trend: 'ramp-up',
    spend: 52000,
    benchmarks: { cpm: 58, ctr: 1.75, resultRate: 1.9, frequency: 2.2, aov: 540 },
    campaigns: [
      {
        name: 'Sales | UGC creative test', weight: 0.5,
        adsets: [
          { name: 'Broad 18-34 | Women', weight: 1, audience: 'Women 18-34, broad',
            ads: [
              { name: 'UGC | Creator A - routine', weight: 0.3, format: 'Single video' },
              { name: 'UGC | Creator B - first try', weight: 0.3, format: 'Single video' },
              { name: 'UGC | Creator C - gifting', weight: 0.2, format: 'Reels' },
              { name: 'Static | Scent family', weight: 0.2, format: 'Single image' }
            ] }
        ]
      },
      {
        name: 'Sales | Scaling winners', weight: 0.35,
        adsets: [
          { name: 'LLA 2% | Purchasers', weight: 0.6, audience: 'LLA 2% purchasers',
            ads: [{ name: 'UGC | Winner cutdown 15s', weight: 1, format: 'Single video' }] },
          { name: 'Interest | Fragrance', weight: 0.4, audience: 'Fragrance interests',
            ads: [{ name: 'Carousel | Full range', weight: 1, format: 'Carousel' }] }
        ]
      },
      {
        name: 'Sales | Retargeting', weight: 0.15,
        adsets: [
          { name: 'IG engagers 14d', weight: 1, audience: 'Instagram engagers, 14 days',
            ads: [{ name: 'Static | Bundle discount', weight: 1, format: 'Single image' }] }
        ]
      }
    ]
  },

  {
    key: 'fashion',
    name: 'Fashion',
    blurb: 'Seasonal drop with a collection carousel and a retargeting tail.',
    brand: 'Sample Label',
    title: 'Autumn drop',
    industry: 'Fashion',
    objective: 'Sales',
    resultLabel: 'Purchases',
    currency: 'EGP',
    trend: 'spike',
    spend: 67000,
    benchmarks: { cpm: 54, ctr: 1.6, resultRate: 1.6, frequency: 2.4, aov: 1150 },
    campaigns: [
      {
        name: 'Sales | Drop launch', weight: 0.6,
        adsets: [
          { name: 'Broad | Women 20-40', weight: 0.55, audience: 'Women 20-40',
            ads: [
              { name: 'Reel | Lookbook 20s', weight: 0.5, format: 'Reels' },
              { name: 'Carousel | The collection', weight: 0.5, format: 'Carousel' }
            ] },
          { name: 'Broad | Men 20-40', weight: 0.45, audience: 'Men 20-40',
            ads: [{ name: 'Carousel | Menswear edit', weight: 1, format: 'Carousel' }] }
        ]
      },
      {
        name: 'Sales | Retargeting | VC 14d', weight: 0.4,
        adsets: [
          { name: 'Viewed content 14d', weight: 1, audience: 'Viewed content, 14 days',
            ads: [
              { name: 'DPA | Browsed items', weight: 0.65, format: 'Catalogue' },
              { name: 'Static | Sizes running out', weight: 0.35, format: 'Single image' }
            ] }
        ]
      }
    ]
  },

  {
    key: 'realestate',
    name: 'Real estate',
    blurb: 'High-value lead generation with a qualification step.',
    brand: 'Sample Developments',
    title: 'North Coast launch',
    industry: 'Real estate',
    objective: 'Leads',
    resultLabel: 'Leads',
    currency: 'EGP',
    trend: 'steady',
    spend: 120000,
    optimisation: 'Leads',
    benchmarks: { cpm: 95, ctr: 0.95, resultRate: 6.5, frequency: 2.0, aov: 480 },
    campaigns: [
      {
        name: 'Leads | Launch | Instant form', weight: 0.7,
        adsets: [
          { name: 'Broad | 30-55 | High intent', weight: 0.5, audience: 'Age 30-55, broad', optimisation: 'Leads',
            ads: [
              { name: 'Video | Masterplan flythrough', weight: 0.6, format: 'Single video' },
              { name: 'Static | Payment plan', weight: 0.4, format: 'Single image' }
            ] },
          { name: 'LLA 1% | Qualified leads', weight: 0.5, audience: 'LLA 1% qualified', optimisation: 'Leads',
            ads: [{ name: 'Static | Unit types', weight: 1, format: 'Single image' }] }
        ]
      },
      {
        name: 'Leads | Retargeting | Form opens', weight: 0.3,
        adsets: [
          { name: 'Opened form, did not submit', weight: 1, audience: 'Form openers, 30 days', optimisation: 'Leads',
            ads: [{ name: 'Static | Book a site visit', weight: 1, format: 'Single image' }] }
        ]
      }
    ]
  },

  {
    key: 'local',
    name: 'Local business',
    blurb: 'A single-location clinic, gym or salon driving enquiries.',
    brand: 'Sample Local',
    title: 'Monthly enquiries',
    industry: 'Local services',
    objective: 'Engagement',
    resultLabel: 'Messaging conversations started',
    currency: 'EGP',
    trend: 'steady',
    spend: 14000,
    optimisation: 'Conversations',
    benchmarks: { cpm: 41, ctr: 1.5, resultRate: 9.2, frequency: 2.8, aov: 75 },
    campaigns: [
      {
        name: 'Engagement | Enquiries', weight: 1,
        adsets: [
          { name: 'Radius 7km | Broad', weight: 0.6, audience: '7km radius',
            ads: [
              { name: 'Static | Offer of the month', weight: 0.5, format: 'Single image' },
              { name: 'Video | Inside the studio', weight: 0.5, format: 'Single video' }
            ] },
          { name: 'Radius 7km | Retarget engagers', weight: 0.4, audience: 'Page engagers 30d',
            ads: [{ name: 'Static | First session free', weight: 1, format: 'Single image' }] }
        ]
      }
    ]
  },

  {
    key: 'apparel',
    name: 'Apparel',
    blurb: 'Basics range with a volume prospecting set and bundle upsell.',
    brand: 'Sample Apparel',
    title: 'Basics restock',
    industry: 'Apparel',
    objective: 'Sales',
    resultLabel: 'Purchases',
    currency: 'EGP',
    trend: 'ramp-down',
    spend: 39000,
    benchmarks: { cpm: 46, ctr: 1.85, resultRate: 1.9, frequency: 2.3, aov: 620 },
    campaigns: [
      {
        name: 'Sales | Basics prospecting', weight: 0.7,
        adsets: [
          { name: 'Broad | 18-40', weight: 1, audience: 'Broad 18-40',
            ads: [
              { name: 'Static | 3 for 2 bundle', weight: 0.4, format: 'Single image' },
              { name: 'UGC | Fit check', weight: 0.35, format: 'Reels' },
              { name: 'Carousel | Colour range', weight: 0.25, format: 'Carousel' }
            ] }
        ]
      },
      {
        name: 'Sales | Bundle upsell', weight: 0.3,
        adsets: [
          { name: 'Purchasers 60d', weight: 1, audience: 'Purchasers, 60 days',
            ads: [{ name: 'Static | Add a second', weight: 1, format: 'Single image' }] }
        ]
      }
    ]
  },

  {
    key: 'services',
    name: 'Services',
    blurb: 'An agency or B2B service selling a booked call.',
    brand: 'Sample Agency',
    title: 'Booked calls',
    industry: 'Services',
    objective: 'Leads',
    resultLabel: 'Leads',
    currency: 'EGP',
    trend: 'ramp-up',
    spend: 31000,
    optimisation: 'Leads',
    benchmarks: { cpm: 52, ctr: 1.25, resultRate: 8.4, frequency: 1.8, aov: 150 },
    campaigns: [
      {
        name: 'Leads | Book a call', weight: 0.75,
        adsets: [
          { name: 'Broad | Business owners', weight: 0.6, audience: 'Business owners', optimisation: 'Leads',
            ads: [
              { name: 'Video | 45s offer', weight: 0.55, format: 'Single video' },
              { name: 'Static | Results snapshot', weight: 0.45, format: 'Single image' }
            ] },
          { name: 'LLA 1% | Clients', weight: 0.4, audience: 'LLA 1% clients', optimisation: 'Leads',
            ads: [{ name: 'Static | Client logos', weight: 1, format: 'Single image' }] }
        ]
      },
      {
        name: 'Traffic | Content nurture', weight: 0.25, status: 'completed',
        adsets: [
          { name: 'Blog readers', weight: 1, audience: 'Site visitors 90d', optimisation: 'Link clicks',
            ads: [{ name: 'Static | Free teardown', weight: 1, format: 'Single image' }] }
        ]
      }
    ]
  }
];

export function templateByKey(key) {
  return TEMPLATES.find(t => t.key === key) || null;
}

/** Build a case study from a preset key. `opts` can override brand and dates. */
export function fromTemplate(key, opts) {
  const t = templateByKey(key);
  if (!t) return null;
  return build(t, opts || {});
}

/**
 * An empty case study with one campaign / ad set / ad, so a "New case study"
 * opens on something editable rather than an empty table.
 */
export function blankCaseStudy(brand) {
  return makeCaseStudy({
    brand: brand || 'New case study',
    campaigns: [
      makeCampaign({
        name: 'Campaign 1',
        adsets: [makeAdSet({ name: 'Ad set 1', ads: [makeAd({ name: 'Ad 1' })] })]
      })
    ]
  });
}

/**
 * The demo library the module ships with, so the dashboard is never empty on a
 * first open. Everything here is generated, labelled as demo in the interface,
 * and safe to delete.
 */
export function demoLibrary() {
  return [
    fromTemplate('beauty',   { brand: 'Demo Beauty Brand',  seed: 'demo-beauty' }),
    fromTemplate('ecommerce',{ brand: 'Demo Online Store',  seed: 'demo-store' }),
    fromTemplate('realestate',{ brand: 'Demo Developments', seed: 'demo-realestate' })
  ].filter(Boolean);
}
