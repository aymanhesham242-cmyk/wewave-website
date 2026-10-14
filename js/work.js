/* WeWave — the work page.
 *
 * Two things: the entrance as chapters scroll in, and the viewer.
 *
 * There is no copy of the project data in here. Everything the viewer needs —
 * the brand, the title, the slug for the full-size file — is already on the
 * button the build wrote, so the data file cannot drift from the behaviour.
 * Same rule as the showcase wheel.
 *
 * Loaded with `src` because the site's CSP is `script-src 'self'` with no
 * 'unsafe-inline'. Declares nothing at top level.
 */
(function () {
  'use strict';

  var pieces = Array.prototype.slice.call(document.querySelectorAll('.wk-piece'));
  var films = Array.prototype.slice.call(document.querySelectorAll('.wk-film'));
  if (!pieces.length && !films.length) return;

  document.documentElement.classList.add('js');

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------- entrance */

  /* `is-armed` is what holds a piece back, so it only ever goes on where
     something is standing by to take it off — plus a timer behind that. A
     portfolio that never animates is a small loss; one that never appears is
     not a portfolio. */
  if (!reduced && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        e.target.classList.remove('is-armed');
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.04 });

    pieces.forEach(function (el, i) {
      el.classList.add('is-armed');
      el.style.transitionDelay = (Math.min(i % 6, 5) * 70) + 'ms';
      io.observe(el);
    });
    setTimeout(function () {
      pieces.forEach(function (el) { el.classList.remove('is-armed'); });
    }, 3000);
  }

  /* --------------------------------------------------------------- viewer */

  var view = document.getElementById('wkView');
  if (!view) return;

  var stage = document.getElementById('wkStage');
  var img = document.getElementById('wkViewImg');
  var elBrand = document.getElementById('wkViewBrand');
  var elTitle = document.getElementById('wkViewTitle');
  var strip = document.getElementById('wkStrip');
  var btnClose = document.getElementById('wkViewClose');
  var btnPrev = document.getElementById('wkViewPrev');
  var btnNext = document.getElementById('wkViewNext');

  var set = [];          /* the pieces of the chapter being viewed */
  var at = -1;
  var lastFocus = null;
  var video = null;

  function chapterOf(el) {
    var sec = el.closest ? el.closest('.wk-chapter') : null;
    return sec ? Array.prototype.slice.call(sec.querySelectorAll('.wk-piece')) : pieces;
  }

  function buildStrip() {
    if (!strip) return;
    strip.innerHTML = '';
    if (set.length < 2) return;
    set.forEach(function (el, i) {
      var t = el.querySelector('img');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'wk-thumb' + (i === at ? ' is-on' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-label', el.getAttribute('data-title') || ('Piece ' + (i + 1)));
      b.setAttribute('aria-selected', i === at ? 'true' : 'false');
      if (t) {
        var im = document.createElement('img');
        im.src = t.getAttribute('src');
        im.alt = '';
        im.loading = 'lazy';
        b.appendChild(im);
      }
      b.addEventListener('click', function () { show(i, i > at ? 1 : -1); });
      strip.appendChild(b);
    });
  }

  function markStrip() {
    if (!strip) return;
    Array.prototype.forEach.call(strip.children, function (b, i) {
      var on = i === at;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
      if (on && b.scrollIntoView) {
        try { b.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (e) {}
      }
    });
  }

  function show(i, dir) {
    if (!set.length) return;
    var next = (i + set.length) % set.length;
    var el = set[next];

    function paint() {
      at = next;
      img.src = el.getAttribute('data-full') || '';
      var t = el.querySelector('img');
      img.alt = t ? (t.getAttribute('alt') || '') : '';
      if (elBrand) elBrand.textContent = el.getAttribute('data-brand') || '';
      if (elTitle) {
        elTitle.textContent = (el.getAttribute('data-title') || '') +
          (set.length > 1 ? '  ·  ' + (at + 1) + ' / ' + set.length : '');
      }
      markStrip();
      if (stage) {
        stage.style.setProperty('--slide', (dir ? -dir * 18 : 0) + 'px');
        stage.classList.remove('is-swapping');
      }
    }

    if (reduced || at < 0 || !stage) { paint(); return; }
    stage.style.setProperty('--slide', ((dir || 1) * 18) + 'px');
    stage.classList.add('is-swapping');
    setTimeout(paint, 170);
  }

  function open(list, i) {
    lastFocus = document.activeElement;
    set = list;
    at = -1;
    stopFilm();
    img.hidden = false;
    show(i, 0);
    buildStrip();
    markStrip();
    reveal();
  }

  function reveal() {
    view.hidden = false;
    view.setAttribute('aria-hidden', 'false');
    document.body.classList.add('wk-locked');
    /* a reflow, not requestAnimationFrame: rAF never fires in a background
       tab and would strand the viewer at opacity 0 */
    void view.offsetHeight;
    view.classList.add('is-open');
    if (btnClose) btnClose.focus();
  }

  function stopFilm() {
    if (!video) return;
    try { video.pause(); video.removeAttribute('src'); video.load(); } catch (e) {}
    if (video.parentNode) video.parentNode.removeChild(video);
    video = null;
  }

  function openFilm(btn) {
    lastFocus = document.activeElement;
    set = [];
    at = -1;
    stopFilm();

    img.hidden = true;
    img.removeAttribute('src');

    video = document.createElement('video');
    video.src = btn.getAttribute('data-src') || '';
    video.controls = true;
    video.playsInline = true;
    video.preload = 'metadata';
    var poster = btn.querySelector('img');
    if (poster) video.poster = poster.getAttribute('src');
    stage.appendChild(video);

    if (elBrand) elBrand.textContent = btn.getAttribute('data-brand') || 'Motion & film';
    if (elTitle) elTitle.textContent = btn.getAttribute('data-title') || '';
    if (strip) strip.innerHTML = '';
    if (btnPrev) btnPrev.hidden = true;
    if (btnNext) btnNext.hidden = true;
    view.classList.add('is-film');

    reveal();
    /* only this one plays, and only once it is on screen */
    var p = video.play();
    if (p && p['catch']) p['catch'](function () { /* autoplay refused: controls are there */ });
  }

  function close() {
    view.classList.remove('is-open');
    view.hidden = true;
    view.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('wk-locked');
    stopFilm();
    view.classList.remove('is-film');
    img.hidden = false;
    img.removeAttribute('src');        /* stop any in-flight download */
    at = -1;
    if (btnPrev) btnPrev.hidden = false;
    if (btnNext) btnNext.hidden = false;
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  pieces.forEach(function (el) {
    el.addEventListener('click', function () {
      var list = chapterOf(el);
      open(list, list.indexOf(el));
    });
  });

  films.forEach(function (el) {
    el.addEventListener('click', function () { openFilm(el); });
  });

  if (btnClose) btnClose.addEventListener('click', close);
  if (btnPrev) btnPrev.addEventListener('click', function () { show(at - 1, -1); });
  if (btnNext) btnNext.addEventListener('click', function () { show(at + 1, 1); });

  /* the backdrop closes; the piece and its controls do not */
  view.addEventListener('click', function (e) {
    if (e.target === view || e.target === stage) close();
  });

  document.addEventListener('keydown', function (e) {
    if (view.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft' && set.length) show(at - 1, -1);
    else if (e.key === 'ArrowRight' && set.length) show(at + 1, 1);
    else if (e.key === 'Tab') {
      var f = [btnClose, btnPrev, btnNext].filter(function (b) { return b && !b.hidden; });
      if (strip) f = f.concat(Array.prototype.slice.call(strip.children));
      if (!f.length) return;
      var i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });

  /* swipe between pieces on a phone */
  (function swipe() {
    var x0 = null;
    view.addEventListener('touchstart', function (e) {
      x0 = e.touches && e.touches.length ? e.touches[0].clientX : null;
    }, { passive: true });
    view.addEventListener('touchend', function (e) {
      if (x0 === null || !e.changedTouches || !e.changedTouches.length || !set.length) return;
      var dx = e.changedTouches[0].clientX - x0;
      x0 = null;
      if (Math.abs(dx) > 50) show(at + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    }, { passive: true });
  })();
})();
