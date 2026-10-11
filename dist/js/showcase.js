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
  var CX = 200, CY = 200, R_OUT = 190, R_IN = 100;
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

  /* Gradients live in the SVG; the CSS only names them. Keeping them here
     means the wedge fills can be swapped by class without inline styles,
     which the page's CSP would otherwise be the only way around. */
  var defs = el('defs', {});
  function grad(id, stops, attrs) {
    var g = el('linearGradient', attrs || { x1: '0', y1: '0', x2: '0', y2: '1' });
    g.setAttribute('id', id);
    stops.forEach(function (st) {
      g.appendChild(el('stop', { offset: st[0], 'stop-color': st[1], 'stop-opacity': st[2] }));
    });
    defs.appendChild(g);
  }
  grad('scFace',    [['0%', '#9FE6C4', '.085'], ['100%', '#9FE6C4', '.025']]);
  grad('scFaceHot', [['0%', '#3FD18B', '.26'],  ['100%', '#2BB39A', '.10']]);
  grad('scFaceOn',  [['0%', '#3FD18B', '.92'],  ['55%', '#2E8B57', '.88'], ['100%', '#1F6B45', '.92']]);
  /* the travelling highlight: opaque at its head, gone by its tail */
  grad('scSweep',   [['0%', '#3FD18B', '0'], ['55%', '#3FD18B', '.85'], ['100%', '#9FE6C4', '0']],
       { x1: '0', y1: '0', x2: '1', y2: '0' });
  svg.appendChild(defs);

  /* Rings, outermost in. The depth comes from these rather than from a
     shadow on every wedge, which would cost a repaint on each hover. */
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: R_OUT + 14, class: 'sc-ring sc-ring-halo' }));
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: R_OUT + 8,  class: 'sc-ring sc-ring-out' }));
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: R_OUT + 2,  class: 'sc-ring sc-ring-edge' }));
  svg.appendChild(el('circle', { cx: CX, cy: CY, r: R_IN - 9,   class: 'sc-ring sc-ring-in' }));

  /* An arc, not a full circle: a quarter of the ring lit at a time, turning
     slowly. Pure transform, so it stays off the main thread. */
  var sweepR = R_OUT + 8;
  var sweepLen = 2 * Math.PI * sweepR;
  svg.appendChild(el('circle', {
    cx: CX, cy: CY, r: sweepR, class: 'sc-sweep',
    'stroke-dasharray': (sweepLen * 0.22).toFixed(1) + ' ' + (sweepLen * 0.78).toFixed(1)
  }));

  var segs = [];
  items.forEach(function (p, i) {
    var g = el('g', { class: 'sc-seg', 'data-i': i });

    var hit = el('path', {
      d: sector(i), class: 'sc-wedge',
      tabindex: '-1', role: 'link',
      'aria-label': p.name + (p.kind ? ' — ' + p.kind : '') + '. Opens in a new tab.'
    });
    g.appendChild(hit);

    /* The label rides an invisible arc through the middle of its band, so it
       curves with the ring instead of sitting at one flat angle. A straight
       label rotated to the mid-angle looked fine at the top and ran straight
       across the band at the bottom -- "Laro Cosmetics" is wider than the
       band, so it overflowed into the hub and past the outer ring.

       Below the horizontal the arc is drawn the other way round, otherwise
       the text there hangs upside down. */
    var mid = i * STEP + STEP / 2;
    var pad = 3.2;                               /* degrees clear of the separator */
    var under = mid > 90 && mid < 270;
    var lr = (R_OUT + R_IN) / 2 + (under ? 5 : -2);
    var la = under ? (i + 1) * STEP - GAP - pad : i * STEP + GAP + pad;
    var lb = under ? i * STEP + GAP + pad : (i + 1) * STEP - GAP - pad;
    var q0 = pt(lr, la), q1 = pt(lr, lb);
    var arcId = 'scLab' + i;
    defs.appendChild(el('path', {
      id: arcId, fill: 'none',
      d: 'M' + q0[0].toFixed(2) + ' ' + q0[1].toFixed(2) +
         'A' + lr + ' ' + lr + ' 0 0 ' + (under ? 0 : 1) + ' ' +
         q1[0].toFixed(2) + ' ' + q1[1].toFixed(2)
    }));

    var t = el('text', { class: 'sc-label', 'dominant-baseline': 'middle' });
    var tp = el('textPath', { 'text-anchor': 'middle', startOffset: '50%' });
    tp.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', '#' + arcId);
    tp.setAttribute('href', '#' + arcId);
    tp.textContent = p.name;
    t.appendChild(tp);
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
  hub.setAttribute('aria-label', 'Clear the selected project');
  hub.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
    'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M12 3.6c4.6 0 8.4 3.8 8.4 8.4s-3.8 8.4-8.4 8.4S3.6 16.6 3.6 12"/>' +
    '<path d="M12 7.8 16.2 12 12 16.2"/><path d="M7.8 12h8.4"/></svg>' +
    '<span class="sc-hub-t">Our work</span>';
  wheelBox.appendChild(hub);

  /* ------------------------------------------------------------- preview */

  var frames = {};        /* url -> iframe, so switching back never reloads */
  var current = -1;
  var closeTimer = null;
  var loadTimer = null;

  panel.innerHTML =
    /* A browser-style bar: three dots and the host, so the panel reads as a
       window onto someone else's site rather than part of this page. */
    '<div class="sc-bar" aria-hidden="true">' +
      '<span class="sc-dots"><i></i><i></i><i></i></span>' +
      '<span class="sc-addr" data-addr></span>' +
    '</div>' +
    '<div class="sc-view" data-view>' +
      '<div class="sc-ph" data-ph></div>' +
      '<div class="sc-load" data-load hidden><span class="sc-spin"></span></div>' +
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
  var loadEl = panel.querySelector('[data-load]');
  var addrEl = panel.querySelector('[data-addr]');
  var nameEl = panel.querySelector('[data-name]');
  var kindEl = panel.querySelector('[data-kind]');
  var goEl = panel.querySelector('[data-go]');

  function fallback(p, why) {
    loadEl.hidden = true;
    ph.className = 'sc-ph is-' + (p.thumb ? 'thumb' : 'plain');
    /* No loading="lazy" here on purpose. The image is only created when its
       segment is selected, which is already the lazy part; the attribute adds
       a second, viewport-based gate that can leave the panel blank when the
       browser decides the shot is not near enough to the fold. */
    ph.innerHTML = p.thumb
      ? '<img src="' + p.thumb + '" alt="' + p.name + ' — screenshot of the live site">'
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
      f.addEventListener('load', function () {
        f.classList.add('is-on'); clearTimeout(loadTimer);
        ph.hidden = true; loadEl.hidden = true;
      });
      f.addEventListener('error', function () { fallback(p, 'preview unavailable'); });
    }
    for (var u in frames) if (frames.hasOwnProperty(u)) frames[u].hidden = (u !== p.url);
    if (f.classList.contains('is-on')) { ph.hidden = true; loadEl.hidden = true; return; }
    /* Show the site's own shot behind the spinner while the live copy
       arrives, so the panel is never an empty rectangle. */
    fallback(p, 'loading preview…');
    loadEl.hidden = false;
    clearTimeout(loadTimer);
    loadTimer = setTimeout(function () {
      if (!f.classList.contains('is-on')) fallback(p, 'this site does not allow previews');
    }, 6000);
  }

  function select(i, viaPointer, passive) {
    if (i === current) return;
    current = i;
    var p = segs[i].data;

    segs.forEach(function (s, k) { s.g.classList.toggle('is-on', k === i); });

    addrEl.textContent = p.host;
    nameEl.textContent = p.name;
    kindEl.textContent = p.kind;
    kindEl.hidden = !p.kind;
    goEl.href = p.url;
    goEl.setAttribute('aria-label', 'Visit ' + p.name + ' — opens in a new tab');

    if (p.mode === 'live' && !passive) {
      showFrame(p);
    } else {
      for (var u in frames) if (frames.hasOwnProperty(u)) frames[u].hidden = true;
      fallback(p, p.mode === 'live' ? 'hover to load the live site'
                                    : 'this site does not allow previews');
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
    loadEl.hidden = true;
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

  /* There is no closed state. The wheel arrives expanded with every project
     reachable, and the hub clears the selection rather than hiding the work. */
  segs.forEach(function (s) { s.hit.setAttribute('tabindex', '0'); });

  hub.addEventListener('click', function () {
    clearTimeout(closeTimer);
    closePreview();
    hub.focus({ preventScroll: true });
  });

  /* ------------------------------------------------------------- pointers */

  var touch = false;
  window.addEventListener('touchstart', function () { touch = true; }, { passive: true, once: true });

  segs.forEach(function (s, i) {
    s.hit.addEventListener('mouseenter', function () {
      if (touch) return;
      holdOpen();
      select(i, true);
    });
    s.hit.addEventListener('click', function (e) {
      e.preventDefault();
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
        closePreview(); hub.focus({ preventScroll: true });
      }
    });
  });

  /* Focus events do not fire on SVG elements here. `wedge.focus()` moves
     document.activeElement -- Enter and the arrow keys work off it -- but no
     focus or focusin event is dispatched, so a listener on the wedge never
     runs and tabbing in would leave the panel empty. Every path that moves
     focus therefore calls select() itself, and these two catch a Tab from
     outside the wheel: focusin if the browser sends one, the keyup as the
     fallback that always works.  */
  function syncToFocus() {
    var i = segs.findIndex(function (s) { return s.hit === document.activeElement; });
    if (i > -1) { holdOpen(); select(i, true); }
  }
  document.addEventListener('focusin', syncToFocus);
  document.addEventListener('keyup', function (e) { if (e.key === 'Tab') syncToFocus(); });

  wheelBox.addEventListener('mouseleave', function () { if (!touch) armClose(); });
  wheelBox.addEventListener('mouseenter', holdOpen);
  panel.addEventListener('mouseenter', holdOpen);
  panel.addEventListener('mouseleave', function () { if (!touch) armClose(); });
  panel.querySelector('[data-x]').addEventListener('click', closePreview);

  root.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closePreview(); hub.focus({ preventScroll: true }); }
  });

  /* --------------------------------------------------------------- reveal */

  /* The wheel replaces the plain card grid once it is known to work. The grid
     stays in the document for anyone this script never reaches. */
  root.hidden = false;
  source.closest('section').classList.add('is-replaced');

  /* The entrance is armed only if it can also be disarmed. `is-armed` is what
     hides the segments, so it goes on just before the observer that takes it
     off again -- and a timer removes it regardless, because a wheel that
     never animates is a small loss and a wheel that never appears is not. */
  if (!reduced && 'IntersectionObserver' in window) {
    root.classList.add('is-armed');
    var reveal = function () { root.classList.add('in-view'); };
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        reveal(); io.disconnect();
      }
    }, { threshold: 0.18 });
    io.observe(root);
    setTimeout(reveal, 2500);
  }

  /* Open on the first project so the panel is never an empty column and the
     section explains itself without being touched. `true` keeps it to the
     still even for a live entry: nobody has asked for a site yet. */
  select(0, true, true);
})();
