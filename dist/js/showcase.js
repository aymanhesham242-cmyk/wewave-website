/* WeWave — circular work showcase.
 *
 * A segmented wheel of the sites we have built. Hovering, focusing or tapping
 * a segment opens a preview beside it: the real site in an iframe where the
 * client's server allows framing, and a still where it does not.
 *
 * Self-contained IIFE declaring nothing at top level, loaded with `src`
 * because the site's CSP is `script-src 'self'` with no 'unsafe-inline'.
 *
 * It owns no data. Every project is read from the `.folio` links the page
 * already carries, which are generated from the `folio` list in
 * tools/build_services.py -- so the wheel and the plain list can never
 * disagree, and the plain list is the fallback when this file does not run.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-showcase]');
  var wheelBox = root && root.querySelector('[data-sc-wheel]');
  var panel = root && root.querySelector('[data-sc-panel]');
  var source = document.querySelector('.folio');
  if (!root || !wheelBox || !panel || !source) return;

  var items = Array.prototype.slice.call(source.querySelectorAll('a'))
    .map(function (a) {
      return {
        name: (a.querySelector('.folio-name') || {}).textContent || 'Project',
        kind: (a.querySelector('.folio-kind') || {}).textContent || '',
        url: a.getAttribute('href') || '',
        mode: a.getAttribute('data-preview') || 'thumb',
        thumb: a.getAttribute('data-thumb') || '',
        host: (a.getAttribute('href') || '')
          .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
      };
    })
    .filter(function (p) { return p.url; });

  if (items.length < 2) return;          /* a wheel of one is just a button */

  var SVG = 'http://www.w3.org/2000/svg';
  var CX = 200, CY = 200, R_OUT = 190, R_IN = 94;
  var GAP = 1.1;                         /* degrees trimmed off each side, the separator */
  var N = items.length;
  var STEP = 360 / N;

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ geometry */

  function pt(r, deg) {
    var a = (deg - 90) * Math.PI / 180;    /* -90 so segment one sits at the top */
    return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
  }

  /** One annulus sector, trimmed at both ends so the separators read as lines. */
  function sector(i) {
    var a0 = i * STEP + GAP;
    var a1 = (i + 1) * STEP - GAP;
    var large = (a1 - a0) > 180 ? 1 : 0;
    var o0 = pt(R_OUT, a0), o1 = pt(R_OUT, a1);
    var i1 = pt(R_IN, a1), i0 = pt(R_IN, a0);
    return 'M' + o0[0].toFixed(2) + ' ' + o0[1].toFixed(2) +
           'A' + R_OUT + ' ' + R_OUT + ' 0 ' + large + ' 1 ' + o1[0].toFixed(2) + ' ' + o1[1].toFixed(2) +
           'L' + i1[0].toFixed(2) + ' ' + i1[1].toFixed(2) +
           'A' + R_IN + ' ' + R_IN + ' 0 ' + large + ' 0 ' + i0[0].toFixed(2) + ' ' + i0[1].toFixed(2) +
           'Z';
  }

  function el(name, attrs) {
    var n = document.createElementNS(SVG, name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) n.setAttribute(k, attrs[k]);
    return n;
  }

  /* --------------------------------------------------------------- build */

  var svg = el('svg', {
    viewBox: '0 0 400 400', class: 'sc-svg',
    role: 'group', 'aria-label': 'Websites we have built'
  });

  /* Outer and inner rings: the depth in the design comes from these, not from
     a drop shadow on every segment, which would cost a repaint per hover. */
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: R_OUT + 7, class: 'sc-ring sc-ring-out' }));
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: R_IN - 8, class: 'sc-ring sc-ring-in' }));

  var segs = [];
  items.forEach(function (p, i) {
    var g = el('g', { class: 'sc-seg', 'data-i': i });

    var hit = el('path', {
      d: sector(i), class: 'sc-wedge',
      tabindex: '-1', role: 'link',
      'aria-label': p.name + (p.kind ? ' — ' + p.kind : '') + '. Opens in a new tab.'
    });
    g.appendChild(hit);

    /* Label on the mid-angle, flipped on the left half so it is never upside
       down. Positioned on the band's centre line so it cannot touch an edge. */
    var mid = i * STEP + STEP / 2;
    var lp = pt((R_OUT + R_IN) / 2, mid);
    var flip = mid > 180;
    var t = el('text', {
      x: lp[0].toFixed(2), y: lp[1].toFixed(2), class: 'sc-label',
      'text-anchor': 'middle', 'dominant-baseline': 'middle',
      transform: 'rotate(' + (mid - 90 + (flip ? 180 : 0)).toFixed(2) +
                 ' ' + lp[0].toFixed(2) + ' ' + lp[1].toFixed(2) + ')'
    });
    t.textContent = p.name;
    g.appendChild(t);

    g.style.setProperty('--d', i);        /* stagger index for the open animation */
    svg.appendChild(g);
    segs.push({ g: g, hit: hit, data: p });
  });

  wheelBox.appendChild(svg);

  /* The centre control is a real <button> over the SVG rather than an SVG
     shape, so it is focusable, announced and styleable without fighting SVG. */
  var hub = document.createElement('button');
  hub.type = 'button';
  hub.className = 'sc-hub';
  hub.setAttribute('aria-expanded', 'false');
  hub.setAttribute('aria-label', 'Open the work showcase');
  hub.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M5 12h13M12.5 6l6 6-6 6"/></svg>' +
    '<span class="sc-hub-t">Explore</span>';
  wheelBox.appendChild(hub);

  /* ------------------------------------------------------------- preview */

  var frames = {};        /* url -> iframe, so switching back never reloads */
  var current = -1;
  var closeTimer = null;
  var loadTimer = null;

  panel.innerHTML =
    '<div class="sc-view" data-view>' +
      '<div class="sc-ph" data-ph></div>' +
    '</div>' +
    '<div class="sc-meta">' +
      '<p class="sc-name" data-name></p>' +
      '<p class="sc-kind" data-kind></p>' +
      '<a class="sc-go" data-go target="_blank" rel="noopener noreferrer">Visit website</a>' +
    '</div>' +
    '<button type="button" class="sc-x" data-x aria-label="Close preview">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
    '</button>';

  var view = panel.querySelector('[data-view]');
  var ph = panel.querySelector('[data-ph]');

  /* The frame is 1280px wide so the preview shows the site's desktop layout.
     CSS cannot scale that to fit a fluid container on its own, so the factor
     is measured here and handed back as a custom property. */
  function fitFrame() {
    var w = view.clientWidth;
    if (w) view.style.setProperty('--sc-scale', (w / 1280).toFixed(4));
  }
  if (window.ResizeObserver) new ResizeObserver(fitFrame).observe(view);
  else window.addEventListener('resize', fitFrame);
  fitFrame();
  var nameEl = panel.querySelector('[data-name]');
  var kindEl = panel.querySelector('[data-kind]');
  var goEl = panel.querySelector('[data-go]');

  function fallback(p, why) {
    ph.className = 'sc-ph is-' + (p.thumb ? 'thumb' : 'plain');
    ph.innerHTML = p.thumb
      ? '<img src="' + p.thumb + '" alt="" loading="lazy">'
      : '<span class="sc-ph-host">' + p.host + '</span>' +
        '<span class="sc-ph-why">' + why + '</span>';
    ph.hidden = false;
  }

  function showFrame(p) {
    var f = frames[p.url];
    if (!f) {
      f = document.createElement('iframe');
      f.className = 'sc-frame';
      f.setAttribute('loading', 'lazy');
      f.setAttribute('title', p.name + ' — live preview');
      f.setAttribute('tabindex', '-1');
      f.setAttribute('scrolling', 'no');
      /* allow-same-origin only grants the frame its OWN origin, never ours. */
      f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-forms');
      f.setAttribute('referrerpolicy', 'no-referrer');
      f.src = p.url;
      frames[p.url] = f;
      view.appendChild(f);

      /* A server that refuses framing often still fires load, on its own error
         page, so a timeout is the honest signal: if nothing painted in time,
         fall back rather than leave a blank rectangle. */
      f.addEventListener('load', function () { f.classList.add('is-on'); clearTimeout(loadTimer); ph.hidden = true; });
      f.addEventListener('error', function () { fallback(p, 'preview unavailable'); });
    }
    for (var u in frames) if (frames.hasOwnProperty(u)) frames[u].hidden = (u !== p.url);
    if (f.classList.contains('is-on')) { ph.hidden = true; return; }
    fallback(p, 'loading preview…');
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (!f.classList.contains('is-on')) fallback(p, 'this site does not allow previews');
    }, 6000);
  }

  function select(i, viaPointer) {
    if (i === current) return;
    current = i;
    var p = segs[i].data;

    segs.forEach(function (s, k) { s.g.classList.toggle('is-on', k === i); });

    nameEl.textContent = p.name;
    kindEl.textContent = p.kind;
    goEl.href = p.url;
    goEl.setAttribute('aria-label', 'Visit ' + p.name + ' — opens in a new tab');

    if (p.mode === 'live') {
      showFrame(p);
    } else {
      for (var u in frames) if (frames.hasOwnProperty(u)) frames[u].hidden = true;
      fallback(p, 'this site does not allow previews');
    }

    panel.hidden = false;
    fitFrame();                     /* the panel had no width while it was hidden */
    /* Force a reflow so the entrance transition has a start frame, then set
       the class synchronously. requestAnimationFrame would read better but it
       does not fire in a background tab, which would leave the panel at
       opacity 0 with no way back — the same reason meeting-modal.js does
       this with `void panel.offsetHeight`. */
    void panel.offsetHeight;
    panel.classList.add('is-in');

    if (!viaPointer) segs[i].hit.focus({ preventScroll: true });
  }

  function closePreview() {
    panel.classList.remove('is-in');
    current = -1;
    segs.forEach(function (s) { s.g.classList.remove('is-on'); });
    clearTimeout(loadTimer);
    var hide = function () { panel.hidden = true; };
    if (reduced) hide(); else setTimeout(hide, 220);
  }

  /* One shared timer across the wheel and the panel: moving the pointer from
     a segment into the preview must not close it, and crossing the gap
     between two segments must not make it flicker. */
  function armClose() { clearTimeout(closeTimer); closeTimer = setTimeout(closePreview, 260); }
  function holdOpen() { clearTimeout(closeTimer); }

  /* ----------------------------------------------------------- open/close */

  var open = false;
  function setOpen(next) {
    open = next;
    root.classList.toggle('is-open', open);
    hub.setAttribute('aria-expanded', open ? 'true' : 'false');
    hub.setAttribute('aria-label', open ? 'Close the work showcase' : 'Open the work showcase');
    segs.forEach(function (s) { s.hit.setAttribute('tabindex', open ? '0' : '-1'); });
    if (!open) { clearTimeout(closeTimer); closePreview(); }
  }

  hub.addEventListener('click', function () {
    setOpen(!open);
    if (open) segs[0].hit.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------- pointers */

  var touch = false;
  window.addEventListener('touchstart', function () { touch = true; }, { passive: true, once: true });

  segs.forEach(function (s, i) {
    s.hit.addEventListener('mouseenter', function () {
      if (!open || touch) return;
      holdOpen();
      select(i, true);
    });
    s.hit.addEventListener('focus', function () { if (open) { holdOpen(); select(i, true); } });
    s.hit.addEventListener('click', function (e) {
      e.preventDefault();
      if (!open) { setOpen(true); select(i, true); return; }
      /* On touch the first tap selects; only a tap on the already-selected
         segment travels, so a mis-tap never throws someone off the site. */
      if (touch && current !== i) { select(i, true); return; }
      window.open(s.data.url, '_blank', 'noopener,noreferrer');
    });
    s.hit.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'Enter' || k === ' ' || k === 'Spacebar') {
        e.preventDefault();
        window.open(s.data.url, '_blank', 'noopener,noreferrer');
      } else if (k === 'ArrowRight' || k === 'ArrowDown') {
        e.preventDefault(); select((i + 1) % N, false);
      } else if (k === 'ArrowLeft' || k === 'ArrowUp') {
        e.preventDefault(); select((i - 1 + N) % N, false);
      } else if (k === 'Home') {
        e.preventDefault(); select(0, false);
      } else if (k === 'End') {
        e.preventDefault(); select(N - 1, false);
      } else if (k === 'Escape') {
        setOpen(false); hub.focus({ preventScroll: true });
      }
    });
  });

  wheelBox.addEventListener('mouseleave', function () { if (!touch) armClose(); });
  wheelBox.addEventListener('mouseenter', holdOpen);
  panel.addEventListener('mouseenter', holdOpen);
  panel.addEventListener('mouseleave', function () { if (!touch) armClose(); });
  panel.querySelector('[data-x]').addEventListener('click', closePreview);

  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open) { setOpen(false); hub.focus({ preventScroll: true }); }
  });

  /* --------------------------------------------------------------- reveal */

  /* The wheel replaces the plain card grid once it is known to work. The grid
     stays in the document for anyone this script never reaches. */
  root.hidden = false;
  source.closest('section').classList.add('is-replaced');
  setOpen(false);
})();
