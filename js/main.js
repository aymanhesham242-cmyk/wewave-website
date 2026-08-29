/* =========================================================
   WeWave — scroll choreography engine
   Native scroll drives a virtual timeline (0..1). A lerped
   copy of that timeline animates fixed full-viewport stages,
   interpolates the palette, and shapes the ribbon canvas, so
   every motion in the page is tied to the same clock.
   ========================================================= */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const clamp  = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const lerp   = (a, b, t) => a + (b - a) * t;
/* progress of v across [a,b], clamped */
const range  = (v, a, b) => clamp((v - a) / (b - a));
const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);

$('#year').textContent = new Date().getFullYear();

/* ---------------------------------------------------------
   Stage timeline. Windows overlap slightly so neighbouring
   stages crossfade instead of hard-cutting.
   --------------------------------------------------------- */
const STAGES = [
  { key: 'hero',      label: 'Index',     start: 0.000, end: 0.115 },
  { key: 'manifesto', label: 'Manifesto', start: 0.100, end: 0.255 },
  { key: 'services',  label: 'Services',  start: 0.240, end: 0.470 },
  { key: 'process',   label: 'Process',   start: 0.455, end: 0.650 },
  { key: 'clients',   label: 'Clients',   start: 0.635, end: 0.760 },
  { key: 'voices',    label: 'Voices',    start: 0.745, end: 0.880 },
  { key: 'contact',   label: 'Contact',   start: 0.865, end: 1.000 }
];

STAGES.forEach(s => {
  s.el = $(`.stage[data-stage="${s.key}"]`);
  if (s.el) {
    /* stagger children in DOM order */
    $$('[data-anim], .ln i', s.el).forEach((el, i) => el.style.setProperty('--d', i));
  }
});

/* ---------------------------------------------------------
   Palette keyframes — the page moves dark → warm → dark so
   sections read as distinct acts rather than one long scroll.
   --------------------------------------------------------- */
const DEEP  = [12, 42, 28];
const WARM  = [250, 248, 242];
const MINT  = [241, 248, 244];
const WHITE = [255, 255, 255];
const INK   = [23, 35, 29];
const DIM_D = [255, 255, 255];
const DIM_L = [102, 115, 107];
const ACC   = [46, 139, 87];
const PRIM  = [31, 107, 69];

const PALETTE = [
  { p: 0.00, bg: DEEP, ink: WHITE, dim: DIM_D, dimA: 0.58, lineA: 0.16, glow: ACC  },
  { p: 0.22, bg: DEEP, ink: WHITE, dim: DIM_D, dimA: 0.58, lineA: 0.16, glow: ACC  },
  { p: 0.30, bg: WARM, ink: INK,   dim: DIM_L, dimA: 1,    lineA: 0.14, glow: PRIM },
  { p: 0.60, bg: WARM, ink: INK,   dim: DIM_L, dimA: 1,    lineA: 0.14, glow: PRIM },
  { p: 0.67, bg: DEEP, ink: WHITE, dim: DIM_D, dimA: 0.58, lineA: 0.16, glow: ACC  },
  { p: 0.75, bg: DEEP, ink: WHITE, dim: DIM_D, dimA: 0.58, lineA: 0.16, glow: ACC  },
  { p: 0.81, bg: MINT, ink: INK,   dim: DIM_L, dimA: 1,    lineA: 0.14, glow: PRIM },
  { p: 0.87, bg: MINT, ink: INK,   dim: DIM_L, dimA: 1,    lineA: 0.14, glow: PRIM },
  { p: 0.93, bg: DEEP, ink: WHITE, dim: DIM_D, dimA: 0.58, lineA: 0.16, glow: ACC  },
  { p: 1.00, bg: DEEP, ink: WHITE, dim: DIM_D, dimA: 0.58, lineA: 0.16, glow: ACC  }
];

const mixRGB = (a, b, t) => [
  Math.round(lerp(a[0], b[0], t)),
  Math.round(lerp(a[1], b[1], t)),
  Math.round(lerp(a[2], b[2], t))
];
const rgb  = c => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

let glowRGB = ACC.slice();

function paint(p) {
  let a = PALETTE[0], b = PALETTE[PALETTE.length - 1];
  for (let i = 0; i < PALETTE.length - 1; i++) {
    if (p >= PALETTE[i].p && p <= PALETTE[i + 1].p) { a = PALETTE[i]; b = PALETTE[i + 1]; break; }
  }
  const t = a.p === b.p ? 0 : easeIO(range(p, a.p, b.p));
  const bg   = mixRGB(a.bg,   b.bg,   t);
  const ink  = mixRGB(a.ink,  b.ink,  t);
  const dim  = mixRGB(a.dim,  b.dim,  t);
  const glow = mixRGB(a.glow, b.glow, t);
  glowRGB = glow;

  const st = document.documentElement.style;
  st.setProperty('--bg',   rgb(bg));
  st.setProperty('--ink',  rgb(ink));
  st.setProperty('--dim',  rgba(dim, lerp(a.dimA,  b.dimA,  t)));
  st.setProperty('--line', rgba(ink, lerp(a.lineA, b.lineA, t)));
  st.setProperty('--glow', rgb(glow));
  document.body.style.backgroundColor = rgb(bg);
}

/* ---------------------------------------------------------
   Stage rendering
   --------------------------------------------------------- */
const navLinks    = $$('.nav a');
const sectionLbl  = $('#sectionLabel');
const progressFil = $('#progressFill');
let currentStage  = -1;

function renderStages(p) {
  let top = 0, topScore = -1;

  STAGES.forEach((s, i) => {
    if (!s.el) return;
    const lp = range(p, s.start, s.end);
    const inWindow = p >= s.start && p <= s.end;

    /* The opening stage is already on screen at progress 0, so it must not
       ramp in from nothing — it only ever plays its exit. */
    const opens = s.start === 0;

    const fadeIn  = opens ? 1 : easeOut(range(lp, 0, 0.20));
    const fadeOut = 1 - easeIO(range(lp, 0.80, 1));
    const o = inWindow ? Math.min(fadeIn, fadeOut) : 0;

    /* travel: enters lifting, leaves lifting — a continuous push */
    const y = lerp(opens ? 0 : 38, -38, easeIO(lp));
    const k = lerp(opens ? 1 : 0.985, 1.015, lp);

    s.el.style.opacity   = o.toFixed(3);
    s.el.style.transform = `translate3d(0,${y.toFixed(2)}px,0) scale(${k.toFixed(4)})`;
    s.el.classList.toggle('live',   o > 0.008);
    s.el.classList.toggle('in',     inWindow && (opens || lp > 0.05));
    s.el.classList.toggle('active', inWindow && (opens ? lp < 0.86 : lp > 0.14 && lp < 0.86));

    if (o > topScore) { topScore = o; top = i; }

    /* ---- per-stage internal choreography ---- */
    if (s.key === 'services') servicesRail(lp);
    if (s.key === 'process')  processSteps(lp);
  });

  if (top !== currentStage) {
    currentStage = top;
    sectionLbl.textContent = STAGES[top].label;
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.goto === STAGES[top].key));
  }
  progressFil.style.width = (p * 100).toFixed(2) + '%';
}

/* Services: the row slides horizontally across its own window. */
const rail = $('#servicesRail');
let railShift = 0;
function measureRail() {
  if (!rail) return;
  const pad = Math.max(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pad')) || 24, 24);
  railShift = Math.max(rail.scrollWidth - window.innerWidth + pad * 2, 0);
}
function servicesRail(lp) {
  if (!rail) return;
  const t = easeIO(range(lp, 0.12, 0.92));
  rail.style.transform = `translate3d(${(-railShift * t).toFixed(2)}px,0,0)`;
}

/* Process: steps light up in sequence as the window is traversed. */
const stepEls = $$('#steps li');
function processSteps(lp) {
  const t = range(lp, 0.15, 0.9);
  const active = Math.floor(t * stepEls.length + 0.0001);
  stepEls.forEach((li, i) => li.classList.toggle('on', i <= active));
}

/* ---------------------------------------------------------
   Ribbon canvas — a continuously travelling glow whose shape
   is bent by scroll position and scroll velocity.
   --------------------------------------------------------- */
const cv  = $('#ribbon');
const ctx = cv.getContext('2d');
let W = 0, H = 0;

function sizeCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/* x position of the wave at a given y, for the current clock.
   `k` offsets a trailing strand so the band reads as one wave, not one wire. */
function ribbonX(yN, time, phase, amp, k = 0) {
  /* envelope keeps the ends tucked toward centre */
  const env = Math.sin(Math.PI * clamp(yN, 0, 1)) ** 0.75;
  /* swell: amplitude breathes along the length so crests aren't uniform */
  const swell = 0.78 + 0.22 * Math.sin(yN * 2.4 - time * 0.5 + phase * 0.5);
  const a = amp * env * swell;
  return W * 0.5
    + Math.sin(yN * 3.1 + time * 0.35 + phase + k * 0.17) * a
    + Math.sin(yN * 6.7 - time * 0.22 + phase * 1.6 + k * 0.24) * a * 0.32;
}

const sparks = Array.from({ length: 26 }, () => ({
  y: Math.random(), speed: 0.00022 + Math.random() * 0.0006, size: 0.7 + Math.random() * 1.9
}));

function drawRibbon(p, vel, time) {
  ctx.clearRect(0, 0, W, H);

  const phase = p * Math.PI * 5;
  const amp   = Math.min(W * 0.17, 190) * (0.55 + Math.min(Math.abs(vel) * 55, 0.85));
  const g     = glowRGB;

  const buildPts = (k) => {
    const pts = [];
    for (let i = 0; i <= 64; i++) {
      const yN = -0.08 + (i / 64) * 1.16;
      pts.push([ribbonX(yN, time, phase, amp, k), yN * H]);
    }
    return pts;
  };

  const stroke = (pts, width, alpha) => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) {
      const xc = (pts[i][0] + pts[i + 1][0]) / 2;
      const yc = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], xc, yc);
    }
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(${g[0]},${g[1]},${g[2]},${alpha})`;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  /* trailing strands either side of the crest: the band reads as a wave
     rolling through the page rather than a single glowing wire */
  const STRANDS = 5;
  for (let k = STRANDS; k >= 1; k--) {
    const fade = 0.14 * (1 - k / STRANDS) + 0.035;
    stroke(buildPts(k),  1.15, fade);
    stroke(buildPts(-k), 1.15, fade);
  }

  /* the crest itself — layered passes stand in for a costly per-frame blur */
  const main = buildPts(0);
  stroke(main, 30, 0.045);
  stroke(main, 14, 0.09);
  stroke(main, 5,  0.28);
  stroke(main, 1.7, 0.9);

  sparks.forEach(s => {
    s.y += s.speed + Math.abs(vel) * 0.35;
    if (s.y > 1.08) s.y = -0.08;
    const x = ribbonX(s.y, time, phase, amp);
    const tw = 0.45 + 0.55 * Math.sin(time * 2 + s.y * 22);
    ctx.beginPath();
    ctx.arc(x, s.y * H, s.size, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${g[0]},${g[1]},${g[2]},${(0.5 + tw * 0.5).toFixed(3)})`;
    ctx.fill();
  });
}

/* ---------------------------------------------------------
   Clients ticker — continuous drift, opposite directions
   --------------------------------------------------------- */
const tickerRows = $$('.ticker-row').map(el => ({ el, dir: +el.dataset.dir || 1, w: 0 }));
function measureTicker() { tickerRows.forEach(r => { r.w = r.el.scrollWidth / 2; }); }
function driftTicker(time) {
  tickerRows.forEach(r => {
    if (!r.w) return;
    const x = -((time * 28 * r.dir) % r.w);
    r.el.style.transform = `translate3d(${r.dir > 0 ? x : x - r.w}px,0,0)`;
  });
}

/* ---------------------------------------------------------
   Main loop — one clock for everything
   --------------------------------------------------------- */
let target = 0;   /* raw scroll progress */
let smooth = 0;   /* lerped progress the visuals actually use */
let vel    = 0;

function scrollable() {
  return Math.max(document.body.scrollHeight - window.innerHeight, 1);
}

/* The correctness layer: given a progress value, the page looks right.
   Runs without any animation frames. */
function applyState(p) {
  paint(p);
  renderStages(p);
}

let lastFrame = 0;

function readScroll() {
  target = clamp(window.scrollY / scrollable());
  /* If frames aren't being serviced (background tab, throttling, reduced
     compositing) fall back to painting straight from the scroll position so
     the page is never left showing a stale stage. */
  if (performance.now() - lastFrame > 250) {
    smooth = target;
    applyState(smooth);
  }
}

function frame(now) {
  lastFrame = now;
  const time = now / 1000;
  const prev = smooth;
  smooth += (target - smooth) * 0.085;   /* the interpolation that softens everything */
  vel = smooth - prev;

  applyState(smooth);
  drawRibbon(smooth, vel, time);
  driftTicker(time);

  requestAnimationFrame(frame);
}

/* Coming back to a hidden tab shouldn't replay every section on the way in. */
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    readScroll();
    smooth = target;
    applyState(smooth);
  }
});

/* ---------------------------------------------------------
   Navigation — eased programmatic scrolling
   --------------------------------------------------------- */
function scrollToProgress(p, dur = 1100) {
  const from = window.scrollY;
  const to   = p * scrollable();
  const t0   = performance.now();
  (function step(now) {
    const t = clamp((now - t0) / dur);
    window.scrollTo(0, from + (to - from) * easeIO(t));
    if (t < 1) requestAnimationFrame(step);
  })(performance.now());
}

$$('[data-goto]').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const s = STAGES.find(x => x.key === link.dataset.goto);
    if (!s) return;
    closeMenu();
    /* land in the middle of the stage's hold phase */
    scrollToProgress(s.start + (s.end - s.start) * 0.45);
  });
});

/* mobile menu */
const burger = $('#burger');
const navEl  = $('#nav');
function closeMenu() {
  burger.classList.remove('open');
  navEl.classList.remove('open');
  burger.setAttribute('aria-expanded', 'false');
}
burger.addEventListener('click', () => {
  const open = burger.classList.toggle('open');
  navEl.classList.toggle('open', open);
  burger.setAttribute('aria-expanded', String(open));
});

/* ---------------------------------------------------------
   Company profile
   On a normal host the plain link opens the PDF. Inside the artifact viewer
   a relative file isn't reachable and page-initiated downloads are blocked,
   so hand the embedded copy to the downloads capability instead.
   --------------------------------------------------------- */
(async function wireProfile() {
  const btn = $('#profileLink');
  if (!btn || !window.__PROFILE_PDF || !window.claude || !window.claude.use) return;

  const dl = await window.claude.use('downloads');
  if (!dl) return;   /* not available in this view — leave the plain link alone */

  btn.addEventListener('click', async (e) => {
    e.preventDefault();
    const raw = atob(window.__PROFILE_PDF);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const label = btn.textContent;
    try {
      btn.textContent = 'Preparing…';
      await dl.save({ filename: 'wewave-profile.pdf', data: bytes });
      btn.textContent = label;
    } catch (err) {
      btn.textContent = (err && err.code === 'declined') ? label : 'Unavailable here';
      if (err && err.code !== 'declined') setTimeout(() => { btn.textContent = label; }, 2600);
    }
  });
})();

/* ---------------------------------------------------------
   Boot: loader → intro statement → chrome in
   --------------------------------------------------------- */
function boot() {
  $('#chromeTop').classList.add('on');
  $('.chrome-bottom').classList.add('on');
  target = clamp(window.scrollY / scrollable());
  smooth = target;
  applyState(smooth);
  requestAnimationFrame(frame);
}

function runLoader() {
  const fill = $('#loaderFill'), pct = $('#loaderPct');
  const loader = $('#loader'), intro = $('#intro'), skip = $('#introSkip');
  let v = 0, done = false;

  const finish = () => {
    if (done) return;
    done = true;
    intro.classList.remove('on');
    setTimeout(boot, 420);
  };

  const tick = setInterval(() => {
    v = Math.min(v + Math.random() * 22 + 13, 100);
    fill.style.width = v + '%';
    pct.textContent = Math.round(v) + '%';
    if (v >= 100) {
      clearInterval(tick);
      setTimeout(() => {
        loader.classList.add('out');
        intro.classList.add('on');
        setTimeout(finish, 1500);
      }, 280);
    }
  }, 120);

  skip.addEventListener('click', finish);
}

/* ---------------------------------------------------------
   Wiring
   --------------------------------------------------------- */
function measureAll() { sizeCanvas(); measureRail(); measureTicker(); }

if (REDUCED) {
  /* static, readable document — no timeline, no canvas */
  $('#loader').style.display = 'none';
  $('#intro').style.display = 'none';
  $('#chromeTop').classList.add('on');
  $('.chrome-bottom').classList.add('on');
  stepEls.forEach(li => li.classList.add('on'));
  $$('[data-goto]').forEach(l => {
    l.addEventListener('click', e => {
      e.preventDefault();
      const s = STAGES.find(x => x.key === l.dataset.goto);
      s?.el?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  });
} else {
  measureAll();
  window.addEventListener('scroll', readScroll, { passive: true });
  window.addEventListener('resize', measureAll);
  window.addEventListener('load', measureAll);
  runLoader();
}
