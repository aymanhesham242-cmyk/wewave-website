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

/* Horizontal wave bands. A vertical snaking line reads as a thread; crests
   running left-to-right read as water — and echo the brand mark's squiggle. */
const TAU = Math.PI * 2;
const WAVES = [
  { yr: 0.46, amp: 0.070, freq: 1.45, sp: 0.50, w: 2.0, a: 0.95 },  /* crest */
  { yr: 0.53, amp: 0.105, freq: 1.00, sp: 0.34, w: 1.3, a: 0.46 },
  { yr: 0.61, amp: 0.058, freq: 2.05, sp: 0.66, w: 1.0, a: 0.30 },
  { yr: 0.69, amp: 0.090, freq: 1.28, sp: 0.24, w: 0.9, a: 0.18 }
];

/* y of one band at horizontal position xN (0..1) */
function waveY(wv, xN, time, phase, boost, shift) {
  /* taper toward both edges so bands don't end abruptly at the viewport */
  const env = Math.sin(Math.PI * clamp(xN, 0, 1)) ** 0.55;
  const a = H * wv.amp * boost * env;
  return H * wv.yr + shift
    + Math.sin(xN * TAU * wv.freq + time * wv.sp + phase) * a
    + Math.sin(xN * TAU * wv.freq * 2.3 - time * wv.sp * 0.7 + phase * 1.4) * a * 0.28;
}

/* foam riding the leading crest */
const sparks = Array.from({ length: 30 }, () => ({
  x: Math.random(), speed: 0.0004 + Math.random() * 0.0011, size: 0.7 + Math.random() * 1.8,
  off: Math.random() * 1000
}));

function drawRibbon(p, vel, time) {
  ctx.clearRect(0, 0, W, H);

  const g     = glowRGB;
  const phase = p * TAU * 2;                                   /* scroll advances the swell */
  const boost = 1 + Math.min(Math.abs(vel) * 42, 0.75);        /* scrolling steepens it */

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

  /* back bands first so the crest sits on top */
  for (let i = WAVES.length - 1; i >= 0; i--) {
    const wv = WAVES[i];
    /* each band drifts vertically at its own rate -> parallax with scroll */
    const shift = (p - 0.5) * H * (0.26 + i * 0.1);
    const pts = [];
    for (let s = 0; s <= 88; s++) {
      const xN = s / 88;
      pts.push([xN * W, waveY(wv, xN, time, phase, boost, shift)]);
    }
    if (i === 0) {
      /* layered passes stand in for a costly per-frame blur */
      stroke(pts, 28, 0.045);
      stroke(pts, 13, 0.09);
      stroke(pts, 5,  0.26);
      stroke(pts, wv.w, wv.a);
    } else {
      stroke(pts, wv.w + 6, wv.a * 0.12);
      stroke(pts, wv.w, wv.a);
    }
  }

  const crest = WAVES[0];
  const crestShift = (p - 0.5) * H * 0.26;
  sparks.forEach(s => {
    s.x += s.speed + Math.abs(vel) * 0.5;
    if (s.x > 1.04) s.x = -0.04;
    const y = waveY(crest, s.x, time, phase, boost, crestShift);
    const tw = 0.45 + 0.55 * Math.sin(time * 2 + s.off);
    ctx.beginPath();
    ctx.arc(s.x * W, y, s.size, 0, TAU);
    ctx.fillStyle = `rgba(${g[0]},${g[1]},${g[2]},${(0.45 + tw * 0.55).toFixed(3)})`;
    ctx.fill();
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
function measureAll() { sizeCanvas(); measureRail(); }

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
