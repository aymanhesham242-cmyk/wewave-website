/* =========================================================
   WeWave — scroll choreography engine
   Native scroll drives a virtual timeline (0..1). A lerped
   copy of that timeline animates fixed full-viewport stages,
   interpolates the palette, and shapes the ribbon canvas, so
   every motion in the page is tied to the same clock.
   ========================================================= */

const REDUCED = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/* Coarse pointer / small screen: the phone path. Declared here because the
   canvas setup below reads it at module scope. */
const TOUCH = window.matchMedia('(hover: none), (pointer: coarse)').matches;
/* 900px is shared with the @media (max-width:900px) block in css/style.css.
   Change one and you must change the other, or the mobile render path and the
   mobile layout will disagree. */
const SMALL = window.matchMedia('(max-width: 900px)').matches;
/* One switch for the phone-weight render path and the touch interactions.
   Declared here because both the ribbon setup and the services rail read it
   at module-evaluation time. */
const LIGHT = TOUCH || SMALL;

const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

const clamp  = (v, a = 0, b = 1) => Math.min(Math.max(v, a), b);
const lerp   = (a, b, t) => a + (b - a) * t;
/* progress of v across [a,b], clamped */
const range  = (v, a, b) => clamp((v - a) / (b - a));
const easeIO = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOut = t => 1 - Math.pow(1 - t, 3);

const yearEl = $('#year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

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
    if (sectionLbl) sectionLbl.textContent = STAGES[top].label;
    navLinks.forEach(a => a.classList.toggle('active', a.dataset.goto === STAGES[top].key));
  }
  if (progressFil) progressFil.style.width = (p * 100).toFixed(2) + '%';
}

/* Services: the row slides horizontally across its own window. */
const rail = $('#servicesRail');
const scards = rail ? $$('.scard', rail) : [];
let railShift = 0;
let cardMids = [];          /* card centres, measured once per resize */
let activeCard = -1;

function measureRail() {
  if (!rail) return;
  const pad = Math.max(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pad')) || 24, 24);
  railShift = Math.max(rail.scrollWidth - window.innerWidth + pad * 2, 0);
  /* Cached so the per-frame pass below is pure arithmetic. Reading
     getBoundingClientRect() for nine cards every frame would force a layout
     each time -- the exact thing that makes a phone stutter. */
  cardMids = scards.map(c => c.offsetLeft + c.offsetWidth / 2);
}

/* Touch has no hover, so the card sitting nearest the middle of the screen
   becomes the active one as the rail slides past. Only ever one card, and the
   DOM is touched only when the index actually changes. */
function setActiveCard(i) {
  if (i === activeCard) return;
  if (activeCard > -1 && scards[activeCard]) scards[activeCard].classList.remove('is-active');
  activeCard = i;
  if (i > -1 && scards[i]) scards[i].classList.add('is-active');
}

function servicesRail(lp) {
  if (!rail) return;
  const t = easeIO(range(lp, 0.12, 0.92));
  const shift = railShift * t;
  rail.style.transform = `translate3d(${(-shift).toFixed(2)}px,0,0)`;

  if (!LIGHT || !cardMids.length) return;
  const mid = window.innerWidth / 2;
  let best = -1, bestD = Infinity;
  for (let n = 0; n < cardMids.length; n++) {
    const d = Math.abs(cardMids[n] - shift - mid);
    if (d < bestD) { bestD = d; best = n; }
  }
  setActiveCard(best);
}

/* Pressing a card reveals it immediately rather than waiting for it to reach
   the centre. One passive delegated listener; the scroll pass takes over again
   on the next frame. */
if (rail && LIGHT) {
  rail.addEventListener('pointerdown', e => {
    const card = e.target.closest('.scard');
    if (card) setActiveCard(scards.indexOf(card));
  }, { passive: true });
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
const ctx = cv ? cv.getContext('2d') : null;
let W = 0, H = 0;

function sizeCanvas() {
  if (!cv || !ctx) return;
  /* Cap the buffer on phones: at 2x this canvas is redrawn every frame and
     the fill rate, not the maths, is what costs. */
  const dpr = Math.min(window.devicePixelRatio || 1, LIGHT ? 1 : 2);
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

const sparks = Array.from({ length: LIGHT ? 9 : 26 }, () => ({
  y: Math.random(), speed: 0.00022 + Math.random() * 0.0006, size: 0.7 + Math.random() * 1.9
}));

function drawRibbon(p, vel, time) {
  if (!ctx) return;
  ctx.clearRect(0, 0, W, H);

  const phase = p * Math.PI * 5;
  const amp   = Math.min(W * 0.17, 190) * (0.55 + Math.min(Math.abs(vel) * 55, 0.85));
  const g     = glowRGB;

  const buildPts = (k) => {
    const pts = [];
    const SEG = LIGHT ? 34 : 64;
    for (let i = 0; i <= SEG; i++) {
      const yN = -0.08 + (i / SEG) * 1.16;
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
  const STRANDS = LIGHT ? 2 : 5;
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
   Hero lamp — a hanging object, not a looping animation.

   Angle is integrated as a damped spring pendulum, so the motion has real
   inertia: it accelerates and decelerates on its own, overshoots slightly,
   and settles. Scroll and cursor apply torque rather than setting position,
   which is what keeps it feeling like weight being pushed around instead of
   a keyframe being scrubbed.
   --------------------------------------------------------- */
const lampEl    = $('#heroLamp');
const lampSwing = $('#lampSwing');

const LAMP = {
  a: 5.5, av: 0,        /* angle (deg) + angular velocity — starts off-centre so it swings in */
  dy: -34, dyv: 0,      /* drop-in offset (px) + velocity */
  lit: 0,               /* brightness 0..1, written to --lit */
  pointerTorque: 0,     /* decays each frame */
  lean: 0,              /* gentle bias toward the cursor */
  t: 0
};

const SPRING = 9.0;     /* ~2s period — a heavy fixture, not a light trinket */
const DAMP   = 1.05;    /* settles in a few swings without looking bouncy */

let lampPointer = 0;    /* -1..1 horizontal cursor offset — drives the lean only */
let lampHover   = 0;    /* 0 or 1 — the bulb is being pointed at or held */

if (!REDUCED && lampEl) {
  const body = $('.lamp-body', lampEl);
  const release = () => { lampHover = 0; };

  if (body) {
    /* Pointer events cover mouse, pen and touch from one path: on a phone
       pointerenter fires on tap and pointerleave on lift. */
    body.addEventListener('pointerenter', () => { lampHover = 1; });
    body.addEventListener('pointerleave', release);
    body.addEventListener('pointercancel', release);
    /* Explicit touch fallback for browsers that don't map touch to pointer. */
    body.addEventListener('touchstart', () => { lampHover = 1; }, { passive: true });
    body.addEventListener('touchend', release, { passive: true });
    body.addEventListener('touchcancel', release, { passive: true });
  }

  /* Every way the lamp could otherwise be left lit: cursor leaving the window
     straight off the bulb, tab losing focus, or a tap landing elsewhere. */
  document.addEventListener('mouseleave', release);
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') release();
  });
  document.addEventListener('pointerdown', e => {
    if (!body || !body.contains(e.target)) release();
  }, { passive: true });

  /* Cursor tracking is desktop-only — on a phone it is pure cost for an
     effect nobody can see. */
  if (!TOUCH) {
    window.addEventListener('mousemove', e => {
      const r = lampEl.getBoundingClientRect();
      if (!r.width) return;
      const cx = r.left + r.width / 2;
      lampPointer = clamp((e.clientX - cx) / (window.innerWidth * 0.45), -1, 1);
      LAMP.pointerTorque += clamp(e.movementX || 0, -40, 40) * 0.05;
    }, { passive: true });
  }
}

function updateLamp(dt, scrollVel) {
  if (!lampSwing || REDUCED) return;
  LAMP.t += dt;

  /* torque: restoring + damping + scroll shove + cursor flick + lean */
  const target = lampPointer * 2.6;                       /* it hangs toward the cursor */
  LAMP.lean += (target - LAMP.lean) * Math.min(dt * 2.2, 1);
  const ext = (-scrollVel * 520) + LAMP.pointerTorque + (LAMP.lean - LAMP.a) * 1.8;

  const acc = -SPRING * LAMP.a - DAMP * LAMP.av + ext;
  LAMP.av += acc * dt;
  LAMP.a  += LAMP.av * dt;
  LAMP.pointerTorque *= Math.pow(0.02, dt);               /* frame-rate independent decay */

  /* drop-in: same spring, slightly stiffer, so it lands with a small overshoot */
  const dacc = -20 * LAMP.dy - 5.2 * LAMP.dyv;
  LAMP.dyv += dacc * dt;
  LAMP.dy  += LAMP.dyv * dt;

  /* The lamp is OFF unless it is being pointed at or held. No resting glow,
     no ambient halo, no proximity lift — until you touch it the bulb is just
     a physical object. --lit therefore has exactly two targets: 0 and 1. */
  const lit = lampHover;

  /* Eased both ways, slower on the way out: a filament cools more slowly
     than it lights. Because the target is a hard 0, the fade always lands
     fully off instead of settling on a residual value. */
  const rate = lit > LAMP.lit ? 6.5 : 3.4;
  LAMP.lit += (lit - LAMP.lit) * Math.min(dt * rate, 1);
  if (LAMP.lit < 0.002) LAMP.lit = 0;   /* snap the tail so it truly reaches off */

  lampSwing.style.transform =
    `translateY(${LAMP.dy.toFixed(2)}px) rotate(${LAMP.a.toFixed(3)}deg)`;
  lampEl.style.setProperty('--lit', LAMP.lit.toFixed(3));
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
  /* real delta, clamped: a tab that was backgrounded must not hand the
     physics a huge dt and fling the lamp across the hero */
  const dt = lastFrame ? Math.min((now - lastFrame) / 1000, 0.05) : 0.016;
  lastFrame = now;

  const time = now / 1000;
  const prev = smooth;
  smooth += (target - smooth) * 0.085;   /* the interpolation that softens everything */
  vel = smooth - prev;

  applyState(smooth);
  drawRibbon(smooth, vel, time);
  driftTicker(time);
  updateLamp(dt, vel);

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
let scrollAnim = 0;
function scrollToProgress(p, dur = 1100) {
  /* Two nav clicks in quick succession previously left two animation chains
     running, each calling scrollTo every frame and fighting the other. */
  cancelAnimationFrame(scrollAnim);
  const from = window.scrollY;
  const to   = p * scrollable();
  const t0   = performance.now();
  (function step(now) {
    const t = clamp((now - t0) / dur);
    window.scrollTo(0, from + (to - from) * easeIO(t));
    if (t < 1) scrollAnim = requestAnimationFrame(step);
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
  burger?.classList.remove('open');
  navEl?.classList.remove('open');
  burger?.setAttribute('aria-expanded', 'false');
}
if (burger) {
  burger.addEventListener('click', () => {
    const open = burger.classList.toggle('open');
    navEl?.classList.toggle('open', open);
    burger.setAttribute('aria-expanded', String(open));
  });
}

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
  $('#chromeTop')?.classList.add('on');
  $('.chrome-bottom')?.classList.add('on');
  target = clamp(window.scrollY / scrollable());
  smooth = target;
  applyState(smooth);
  requestAnimationFrame(frame);
}

function runLoader() {
  const fill = $('#loaderFill'), pct = $('#loaderPct');
  const loader = $('#loader'), intro = $('#intro'), skip = $('#introSkip');
  /* Without the loader markup there is nothing to animate -- start the page
     rather than throwing and leaving a blank screen. */
  if (!fill || !pct || !loader || !intro) { boot(); return; }
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

  skip?.addEventListener('click', finish);
}

/* ---------------------------------------------------------
   Wiring
   --------------------------------------------------------- */
function measureAll() { sizeCanvas(); measureRail(); measureTicker(); }

/* Resize fires in bursts -- notably when a phone's address bar slides away.
   Each pass reads layout and reallocates the canvas buffer, so collapse a
   burst into one measurement on the next frame. */
let measureQueued = 0;
function queueMeasure() {
  cancelAnimationFrame(measureQueued);
  measureQueued = requestAnimationFrame(measureAll);
}

if (REDUCED) {
  /* static, readable document — no timeline, no canvas */
  $('#loader')?.style.setProperty('display', 'none');
  $('#intro')?.style.setProperty('display', 'none');
  $('#chromeTop')?.classList.add('on');
  $('.chrome-bottom')?.classList.add('on');
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
  window.addEventListener('resize', queueMeasure);
  window.addEventListener('load', measureAll);
  runLoader();
}

/* ---------------------------------------------------------
   Meeting request modal

   There is no backend on this project, so the submit path is written to
   target one and falls back to something real rather than pretending:
   set MEETING_ENDPOINT to a URL and the form POSTs the payload as JSON;
   leave it empty and the request is handed to the visitor's mail client,
   pre-addressed and pre-filled. Nothing claims to have been sent when it
   has not been.
   --------------------------------------------------------- */
const MEETING_ENDPOINT = '/api/meeting';                 /* e.g. 'https://formspree.io/f/xxxx' */
const MEETING_MAILTO   = 'wewavemarketing@gmail.com';

(function meetingRequest() {
  const root = $('#mreq');
  const btn  = $('#meetingBtn');
  if (!root || !btn) return;

  const panel   = $('.mreq-panel', root);
  const form    = $('#mreqForm');
  const done    = $('#mreqDone');
  const doneCopy= $('#mreqDoneCopy');
  const submit  = $('#mreqSubmit');
  const note    = $('#mreqNote');
  const grid    = $('#calGrid');
  const monthEl = $('#calMonth');
  const prevBtn = $('#calPrev');
  const nextBtn = $('#calNext');

  const MONTHS = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];

  const today = new Date(); today.setHours(0, 0, 0, 0);
  let view = { y: today.getFullYear(), m: today.getMonth() };
  let picked = null;                       /* Date, midnight */
  let lastFocus = null;

  const sameDay = (a, b) => a && b &&
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  /* ---- calendar ---- */
  function renderCal() {
    monthEl.textContent = `${MONTHS[view.m]} ${view.y}`;
    /* nothing to go back to before the current month */
    prevBtn.disabled = view.y === today.getFullYear() && view.m === today.getMonth();

    const first = new Date(view.y, view.m, 1);
    const lead  = (first.getDay() + 6) % 7;          /* Monday-first */
    const days  = new Date(view.y, view.m + 1, 0).getDate();

    const frag = document.createDocumentFragment();
    for (let i = 0; i < lead; i++) {
      const b = document.createElement('span');
      b.className = 'cal-day blank';
      frag.appendChild(b);
    }
    for (let d = 1; d <= days; d++) {
      const date = new Date(view.y, view.m, d);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cal-day';
      b.textContent = d;
      b.setAttribute('aria-label', `${d} ${MONTHS[view.m]} ${view.y}`);
      if (date < today) b.disabled = true;            /* no past dates */
      if (sameDay(date, today))  b.classList.add('today');
      if (sameDay(date, picked)) { b.classList.add('sel'); b.setAttribute('aria-pressed', 'true'); }
      b.addEventListener('click', () => {
        picked = date;
        clearErr('meetingDate');
        renderCal();
      });
      frag.appendChild(b);
    }
    grid.replaceChildren(frag);
  }

  prevBtn.addEventListener('click', () => {
    if (view.m === 0) { view.m = 11; view.y--; } else view.m--;
    renderCal();
  });
  nextBtn.addEventListener('click', () => {
    if (view.m === 11) { view.m = 0; view.y++; } else view.m++;
    renderCal();
  });

  /* ---- validation ---- */
  const errEl = k => $(`[data-err="${k}"]`, form);
  function setErr(k, msg) {
    const e = errEl(k);
    if (!e) return;
    e.textContent = msg;
    e.classList.add('on');
    e.closest('.mf')?.classList.add('invalid');
  }
  function clearErr(k) {
    const e = errEl(k);
    if (!e) return;
    e.textContent = '';
    e.classList.remove('on');
    e.closest('.mf')?.classList.remove('invalid');
  }

  function collect() {
    const services = $$('input[name="services"]:checked', form).map(i => i.value);
    return {
      name:      $('#mfName').value.trim(),
      brandLink: $('#mfBrand').value.trim(),
      phone:     ($('#mfCode').value + ' ' + $('#mfPhone').value.trim()).trim(),
      services,
      meetingDate: picked ? iso(picked) : '',
      message:   $('#mfMsg').value.trim()
    };
  }

  function validate(d) {
    ['name','brandLink','phone','services','meetingDate'].forEach(clearErr);
    let ok = true;
    if (d.name.length < 2)      { setErr('name', 'Please enter your full name.'); ok = false; }
    if (!d.brandLink)           { setErr('brandLink', 'Add your website or a social profile link.'); ok = false; }
    /* deliberately loose: numbering varies by country, so only require enough digits to be a number */
    if ((d.phone.replace(/\D/g, '').length) < 8) { setErr('phone', 'Enter a phone number we can reach you on.'); ok = false; }
    if (!d.services.length)     { setErr('services', 'Choose at least one service.'); ok = false; }
    if (!d.meetingDate)         { setErr('meetingDate', 'Pick a date for the meeting.'); ok = false; }
    if (!ok) {
      const firstBad = $('.mf.invalid', form);
      firstBad?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    return ok;
  }

  /* live clearing as the visitor fixes things */
  ['mfName','mfBrand','mfPhone'].forEach((id, i) => {
    $('#' + id).addEventListener('input', () => clearErr(['name','brandLink','phone'][i]));
  });
  $$('input[name="services"]', form).forEach(c =>
    c.addEventListener('change', () => clearErr('services')));

  /* ---- submit ---- */
  function mailtoFor(d) {
    const body = [
      `Name: ${d.name}`,
      `Brand / link: ${d.brandLink}`,
      `Phone: ${d.phone}`,
      `Services: ${d.services.join(', ')}`,
      `Preferred date: ${d.meetingDate}`,
      '',
      d.message ? `Message:\n${d.message}` : '(no message)'
    ].join('\n');
    return `mailto:${MEETING_MAILTO}`
      + `?subject=${encodeURIComponent('Meeting request — ' + d.name)}`
      + `&body=${encodeURIComponent(body)}`;
  }

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const data = collect();
    if (!validate(data)) return;

    submit.disabled = true;
    submit.classList.add('busy');
    note.classList.remove('err');
    note.textContent = '';

    try {
      if (MEETING_ENDPOINT) {
        const res = await fetch(MEETING_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) throw new Error('Request failed (' + res.status + ')');
        doneCopy.textContent =
          'Thanks — your request is with us. We will confirm your meeting by phone or email shortly.';
      } else {
        /* No endpoint configured: hand it to the mail client rather than
           claiming a send that did not happen. */
        window.location.href = mailtoFor(data);
        doneCopy.textContent =
          'Your email app is opening with the details filled in — press send and it reaches us. '
          + 'If nothing opened, email ' + MEETING_MAILTO + ' directly.';
      }
      form.hidden = true;
      done.hidden = false;
      panel.scrollTop = 0;
    } catch (err) {
      note.textContent = 'Could not send that. Please try again, or email ' + MEETING_MAILTO + '.';
      note.classList.add('err');
    } finally {
      submit.disabled = false;
      submit.classList.remove('busy');
    }
  });

  /* ---- open / close ---- */
  function open() {
    lastFocus = document.activeElement;
    root.hidden = false;
    void panel.offsetHeight;                 /* reflow so the transition has a start frame */
    root.classList.add('open');
    document.documentElement.style.overflow = 'hidden';   /* freeze the stage timeline behind */
    renderCal();
    setTimeout(() => $('#mfName')?.focus(), 60);
  }
  function close() {
    root.classList.remove('open');
    document.documentElement.style.overflow = '';
    const finish = () => { root.hidden = true; };
    panel.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 600);                 /* never strand it open */
    lastFocus?.focus();
  }

  btn.addEventListener('click', e => { e.preventDefault(); open(); });
  $$('[data-mclose]', root).forEach(el => el.addEventListener('click', close));
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !root.hidden) close();
  });

  /* keep tabbing inside the dialog while it is open */
  panel.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = $$('button,input,select,textarea,a[href]', panel).filter(el => !el.disabled && el.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  renderCal();
})();
