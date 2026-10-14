/* WeWave — the work gallery.
 *
 * Filtering, the lightbox, and the entrance. No dependencies, nothing declared
 * at top level, and loaded with `src` because the site's CSP is
 * `script-src 'self'` with no 'unsafe-inline'.
 *
 * There is no second copy of the project data in here. Everything the gallery
 * needs is already in the markup the build wrote — the category on each tile,
 * the brand and title in its caption, the slug for the full-size file — so a
 * change to tools/work_data.py cannot leave this file describing something
 * else. Same rule as the showcase wheel.
 */
(function () {
  'use strict';

  var grid = document.getElementById('wkGrid');
  if (!grid) return;

  document.documentElement.classList.add('js');

  var items = Array.prototype.slice.call(grid.querySelectorAll('.wk-item'));
  var chips = Array.prototype.slice.call(document.querySelectorAll('.wk-chip'));
  var empty = document.getElementById('wkEmpty');
  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ filtering */

  var shown = items.slice();          /* what the lightbox walks through */

  function apply(cat) {
    shown = [];
    items.forEach(function (el) {
      var on = (cat === 'all' || el.getAttribute('data-cat') === cat);
      el.hidden = !on;
      if (on) shown.push(el);
    });
    chips.forEach(function (c) {
      var on = c.getAttribute('data-filter') === cat;
      c.classList.toggle('is-on', on);
      c.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    if (empty) empty.hidden = shown.length > 0;

    /* Keep the URL honest so a filtered view can be shared and the back
       button does something sensible. replaceState, not pushState: a filter
       is not a page, and twenty of them in the history is a trap. */
    try {
      var url = cat === 'all' ? location.pathname
        : location.pathname + '?filter=' + encodeURIComponent(cat);
      history.replaceState({ filter: cat }, '', url);
    } catch (e) { /* file:// and old browsers */ }
  }

  chips.forEach(function (c) {
    c.addEventListener('click', function () {
      apply(c.getAttribute('data-filter') || 'all');
    });
  });

  /* an incoming ?filter= is honoured, but only if it names a real chip */
  (function initial() {
    var want = null;
    try { want = new URLSearchParams(location.search).get('filter'); } catch (e) {}
    if (!want) return;
    var match = chips.filter(function (c) { return c.getAttribute('data-filter') === want; });
    if (match.length) apply(want);
  })();

  /* ------------------------------------------------------------- entrance */

  /* `is-armed` is what hides a tile for the entrance, so it is only ever put
     on when there is an observer standing by to take it off. Without one the
     gallery is simply visible, which is the right failure. */
  if (!reduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        e.target.classList.remove('is-armed');
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.05 });

    items.forEach(function (el, i) {
      el.classList.add('is-armed');
      el.style.transitionDelay = (Math.min(i, 8) * 45) + 'ms';
      io.observe(el);
    });

    /* A tab opened in the background never runs the observer callback, and a
       tile left armed is a tile nobody sees. Clear everything after a beat
       regardless — the animation is a nicety, the work is not. */
    setTimeout(function () {
      items.forEach(function (el) { el.classList.remove('is-armed'); });
    }, 3000);
  }

  /* ------------------------------------------------------------- lightbox */

  var box = document.getElementById('wkBox');
  var img = document.getElementById('wkImg');
  if (!box || !img) return;

  var bBrand = document.getElementById('wkBoxBrand');
  var bTitle = document.getElementById('wkBoxTitle');
  var bCount = document.getElementById('wkBoxCount');
  var btnClose = document.getElementById('wkClose');
  var btnPrev = document.getElementById('wkPrev');
  var btnNext = document.getElementById('wkNext');

  var at = -1;
  var lastFocus = null;

  function show(i) {
    if (!shown.length) return;
    at = (i + shown.length) % shown.length;
    var el = shown[at];
    var slug = el.getAttribute('data-slug');
    var thumb = el.querySelector('img');

    img.src = 'assets/work/' + slug + '.webp';
    img.alt = thumb ? thumb.getAttribute('alt') || '' : '';
    if (bBrand) bBrand.textContent = text(el, '.wk-brand');
    if (bTitle) bTitle.textContent = text(el, '.wk-title');
    if (bCount) bCount.textContent = (at + 1) + ' / ' + shown.length;

    var one = shown.length < 2;
    if (btnPrev) btnPrev.hidden = one;
    if (btnNext) btnNext.hidden = one;
  }

  function text(el, sel) {
    var n = el.querySelector(sel);
    return n ? n.textContent.trim() : '';
  }

  function open(i) {
    lastFocus = document.activeElement;
    show(i);
    box.hidden = false;
    box.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wk-locked');
    /* a reflow rather than requestAnimationFrame: rAF does not fire in a
       background tab, which would strand the box at opacity 0 */
    void box.offsetHeight;
    box.classList.add('is-open');
    if (btnClose) btnClose.focus();
  }

  function close() {
    box.classList.remove('is-open');
    box.hidden = true;
    box.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wk-locked');
    img.removeAttribute('src');          /* stop any in-flight download */
    at = -1;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  items.forEach(function (el) {
    el.addEventListener('click', function () {
      var i = shown.indexOf(el);
      if (i >= 0) open(i);
    });
  });

  if (btnClose) btnClose.addEventListener('click', close);
  if (btnPrev) btnPrev.addEventListener('click', function () { show(at - 1); });
  if (btnNext) btnNext.addEventListener('click', function () { show(at + 1); });

  /* the backdrop closes; the image and its caption do not */
  box.addEventListener('click', function (e) {
    if (e.target === box) close();
  });

  document.addEventListener('keydown', function (e) {
    if (box.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') show(at - 1);
    else if (e.key === 'ArrowRight') show(at + 1);
    else if (e.key === 'Tab') {
      /* keep focus inside the dialog */
      var f = [btnClose, btnPrev, btnNext].filter(function (b) { return b && !b.hidden; });
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });

  /* a swipe on a phone moves between pieces */
  (function swipe() {
    var x0 = null;
    box.addEventListener('touchstart', function (e) {
      x0 = e.touches && e.touches.length ? e.touches[0].clientX : null;
    }, { passive: true });
    box.addEventListener('touchend', function (e) {
      if (x0 === null || !e.changedTouches || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1));
    }, { passive: true });
  })();
})();
