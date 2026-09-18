/**
 * WeWave — visitor analytics client.
 *
 * Self-contained IIFE: declares nothing at top level, so it cannot collide with
 * main.js or meeting-modal.js, and every entry point is wrapped so a failure
 * here can never stop the site. It reads the page; it never modifies it.
 *
 * What it does NOT collect: form values, keystrokes, text the visitor types,
 * IP addresses, or anything that identifies a person. The session id is random
 * and expires; country and device are derived server-side from the request.
 *
 * Scroll depth is taken from the scroll driver, which on this site *is* the
 * timeline the seven fixed stages are choreographed against — so "75% scrolled"
 * means three quarters of the way through the experience, not of a document.
 *
 * Development mode: add ?wwtest=1 to the URL. Everything from that browser is
 * then flagged is_test and is excluded from the dashboard unless you ask for
 * it, and can be deleted wholesale from Settings.
 */
(function () {
  'use strict';

  try {
    /* Honour an explicit Do-Not-Track signal. Remove this block if you would
       rather count those visits; everything else still works. */
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

    var ENDPOINT   = '/api/a';
    var SESSION_MS = 30 * 60 * 1000;  /* a pause longer than this starts a new session */
    var FLUSH_MS   = 5000;
    var FLUSH_AT   = 15;              /* events queued before an early flush */
    var MOVE_MS    = 180;             /* attention sampling interval */
    var MOVE_KEEP  = 3;               /* keep 1 of every N samples */

    var LS = 'ww_a_sid';
    var LS_AT = 'ww_a_seen';

    /* ---------------------------------------------------------- session */

    var store = {
      get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
      set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
    };

    var rid = function () {
      try {
        if (crypto && crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '').slice(0, 24);
      } catch (e) {}
      return String(Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
    };

    var now = Date.now();
    var last = parseInt(store.get(LS_AT) || '0', 10);
    var sid = store.get(LS);
    var fresh = !sid || !last || (now - last) > SESSION_MS;
    if (fresh) { sid = rid(); store.set(LS, sid); }
    store.set(LS_AT, String(now));

    var params = new URLSearchParams(location.search);
    /* Three ways a visit is marked as ours rather than a real visitor's:
       an explicit ?wwtest=1, a sticky flag from an earlier ?wwtest=1, or the
       presence of the admin token — if you can open the dashboard from this
       browser, you are the owner, and counting yourself skews everything. */
    var ownsAdmin = (function () {
      try { return !!localStorage.getItem('wewave_admin_token'); } catch (e) { return false; }
    })();
    var isTest = ownsAdmin || params.get('wwtest') === '1' ||
      (function () { try { return sessionStorage.getItem('ww_a_test') === '1'; } catch (e) { return false; } })();
    if (params.get('wwtest') === '1') { try { sessionStorage.setItem('ww_a_test', '1'); } catch (e) {} }

    var ctx = {
      vw: window.innerWidth,
      vh: window.innerHeight,
      referrer: document.referrer || '',
      utm_source:   params.get('utm_source')   || '',
      utm_medium:   params.get('utm_medium')   || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content:  params.get('utm_content')  || '',
      utm_term:     params.get('utm_term')     || ''
    };

    /* ------------------------------------------------------------ queue */

    var queue = [];
    var timer = null;
    var startedAt = Date.now();

    /* Engaged time: wall-clock between first and last event counts a tab left
       open all afternoon as an afternoon of attention. This accumulates only
       while the page is visible AND something happened recently, which is what
       "how long did they actually spend" means. */
    var IDLE_MS = 30000;          /* no activity for this long = not engaged */
    var engagedMs = 0;
    var lastTickAt = Date.now();
    var lastActivityAt = Date.now();

    function markActivity() { lastActivityAt = Date.now(); }

    setInterval(function () {
      try {
        var t = Date.now();
        var slice = t - lastTickAt;
        lastTickAt = t;
        if (document.visibilityState === 'visible' && (t - lastActivityAt) < IDLE_MS && slice < 15000) {
          engagedMs += slice;
        }
      } catch (e) {}
    }, 1000);

    ['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach(function (ev) {
      window.addEventListener(ev, markActivity, { passive: true });
    });
    document.addEventListener('visibilitychange', function () {
      lastTickAt = Date.now();
      if (document.visibilityState === 'visible') markActivity();
    });

    function send(useBeacon) {
      if (!queue.length) return;
      var batch = queue.splice(0, 60);
      /* The Worker assigns timestamps; each event carries how long ago it
         happened so ordering and spacing inside a batch survive the trip. */
      var t = Date.now();
      for (var i = 0; i < batch.length; i++) {
        batch[i].dt = Math.max(0, t - (batch[i]._at || t));
        delete batch[i]._at;
      }
      var body = JSON.stringify({ sid: sid, test: isTest ? 1 : 0, ctx: ctx, events: batch });
      try {
        if (useBeacon && navigator.sendBeacon) {
          navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
          return;
        }
        fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
          credentials: 'omit'
        })['catch'](function () { /* analytics must stay silent on failure */ });
      } catch (e) { /* ignore */ }
    }

    function schedule() {
      if (timer) return;
      timer = setTimeout(function () { timer = null; send(false); }, FLUSH_MS);
    }

    /** Queue an event. Never throws. */
    function track(type, data) {
      try {
        if (!type) return;
        var e = data || {};
        e.type = type;
        e._at = Date.now();          /* turned into a relative offset at send time */
        e.path = location.pathname || '/';
        if (e.scroll === undefined) e.scroll = progress();
        if (e.section === undefined) e.section = liveSection();
        e.meta = e.meta || {};
        e.meta.engaged = engagedMs;
        queue.push(e);
        if (queue.length >= FLUSH_AT) { clearTimeout(timer); timer = null; send(false); }
        else schedule();
      } catch (err) { /* never surface */ }
    }

    /* expose a tiny hook so new events can be added later without touching this file */
    window.wwTrack = function (type, data) { track(String(type || '').toUpperCase(), data || {}); };

    /* --------------------------------------------------------- helpers */

    function scrollable() {
      var d = document.documentElement;
      return Math.max(1, (d.scrollHeight || 0) - window.innerHeight);
    }

    /** 0..100 along the scroll driver — the site's own stage timeline. */
    function progress() {
      try {
        return Math.min(100, Math.max(0, (window.scrollY / scrollable()) * 100));
      } catch (e) { return 0; }
    }

    var currentSection = null;
    function liveSection() { return currentSection; }

    function describe(el) {
      if (!el || !el.tagName) return null;
      if (el.id) return '#' + el.id;
      var cls = (el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className);
      if (typeof cls === 'string' && cls.trim()) {
        return el.tagName.toLowerCase() + '.' + cls.trim().split(/\s+/).slice(0, 2).join('.');
      }
      return el.tagName.toLowerCase();
    }

    /** Visible label only — never the value of an input. */
    function labelOf(el) {
      try {
        if (!el) return null;
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
          return el.getAttribute('name') || el.getAttribute('id') || el.tagName.toLowerCase();
        }
        var t = (el.getAttribute && el.getAttribute('aria-label')) || el.textContent || '';
        return t.replace(/\s+/g, ' ').trim().slice(0, 80) || null;
      } catch (e) { return null; }
    }

    function closestLink(el) {
      while (el && el !== document.body) {
        if (el.tagName === 'A' || el.tagName === 'BUTTON') return el;
        el = el.parentElement;
      }
      return null;
    }

    /* ------------------------------------------------------ page + session */

    /* Only a genuinely new session starts one. A reload inside the 30-minute
       window continues the existing session and just adds a page view. */
    if (fresh) track('SESSION_START', {});
    track('PAGE_VIEW', { label: document.title ? document.title.slice(0, 80) : null });

    /* ------------------------------------------------- section visibility */

    (function sections() {
      var stages = document.querySelectorAll('.stage[data-stage]');
      if (!stages.length) return;
      var seen = {};

      /* main.js toggles `.live` / `.active` on stages every frame. Watching the
         attribute keeps this in step with the real engine without touching it
         or adding a second rAF loop. */
      var obs = new MutationObserver(function (muts) {
        try {
          for (var i = 0; i < muts.length; i++) {
            var el = muts[i].target;
            var key = el.getAttribute('data-stage');
            if (!key) continue;
            if (el.classList.contains('active')) {
              if (currentSection !== key) currentSection = key;
              if (!seen[key]) { seen[key] = 1; track('SECTION_VIEW', { section: key }); }
            }
          }
        } catch (e) {}
      });
      for (var i = 0; i < stages.length; i++) {
        obs.observe(stages[i], { attributes: true, attributeFilter: ['class'] });
      }
    })();

    /* -------------------------------------------------------- scroll depth */

    (function scrollDepth() {
      var marks = [25, 50, 75, 90, 100];
      var hit = {};
      var maxSeen = 0;
      var ticking = false;

      function check() {
        ticking = false;
        var p = progress();
        if (p > maxSeen) maxSeen = p;
        for (var i = 0; i < marks.length; i++) {
          if (!hit[marks[i]] && p >= marks[i] - 0.5) {
            hit[marks[i]] = 1;
            track('SCROLL', { scroll: marks[i], meta: { milestone: marks[i] } });
          }
        }
      }
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        setTimeout(check, 200);
      }, { passive: true });
    })();

    /* -------------------------------------------------------------- clicks */

    document.addEventListener('click', function (ev) {
      try {
        var el = ev.target;
        if (!el || !el.tagName) return;
        var link = closestLink(el) || el;
        var id = describe(link);
        var label = labelOf(link);
        var x = ev.clientX / Math.max(1, window.innerWidth);
        var y = ev.clientY / Math.max(1, window.innerHeight);

        var type = 'CLICK';
        var href = link.getAttribute ? (link.getAttribute('href') || '') : '';

        if (link.classList && link.classList.contains('brand')) type = 'LOGO_CLICK';
        else if (link.closest && link.closest('.nav')) type = 'NAVIGATION_CLICK';
        else if (link.id === 'meetingBtn' || (link.classList && (link.classList.contains('pill') || link.classList.contains('hero-cta')))) type = 'CTA_CLICK';
        else if (/^mailto:|^tel:|^https?:\/\/wa\.me/.test(href)) type = 'CTA_CLICK';
        else if (/^https?:\/\//.test(href) && href.indexOf(location.origin) !== 0) type = 'EXTERNAL_LINK_CLICK';
        else if (link.classList && link.classList.contains('btn')) type = 'CTA_CLICK';

        track(type, { x: x, y: y, element: id, label: label, meta: href ? { href: href.slice(0, 200) } : undefined });

        /* a CTA is also a click for heatmap purposes, and vice versa — one row
           is enough: the heatmap query unions the click-like types. */
      } catch (e) {}
    }, { passive: true, capture: true });

    /* --------------------------------------------------------------- touch */

    window.addEventListener('touchstart', function (ev) {
      try {
        if (!ev.touches || !ev.touches.length) return;
        var t = ev.touches[0];
        track('TOUCH', {
          x: t.clientX / Math.max(1, window.innerWidth),
          y: t.clientY / Math.max(1, window.innerHeight),
          element: describe(ev.target)
        });
      } catch (e) {}
    }, { passive: true });

    /* ---------------------------------------------------- attention / move */

    (function attention() {
      /* Pointer movement is only meaningful with a real pointer, and it is the
         highest-frequency signal on the page — so it is throttled, sampled, and
         batched with everything else rather than sent per move. */
      if (window.matchMedia && window.matchMedia('(hover: none), (pointer: coarse)').matches) return;
      var lastAt = 0, kept = 0;
      window.addEventListener('mousemove', function (ev) {
        try {
          var t = Date.now();
          if (t - lastAt < MOVE_MS) return;
          lastAt = t;
          if ((kept++ % MOVE_KEEP) !== 0) return;
          track('MOVE', {
            x: ev.clientX / Math.max(1, window.innerWidth),
            y: ev.clientY / Math.max(1, window.innerHeight)
          });
        } catch (e) {}
      }, { passive: true });
    })();

    /* ------------------------------------------------------ service cards */

    (function services() {
      var cards = document.querySelectorAll('.scard');
      if (!cards.length) return;
      var seen = {};
      var obs = new MutationObserver(function (muts) {
        try {
          for (var i = 0; i < muts.length; i++) {
            var el = muts[i].target;
            if (!el.classList || !el.classList.contains('is-active')) continue;
            var name = labelOf(el.querySelector('h3, .scard-title')) || describe(el);
            if (seen[name]) continue;
            seen[name] = 1;
            track('SERVICE_VIEW', { section: 'services', element: describe(el), label: name });
          }
        } catch (e) {}
      });
      for (var i = 0; i < cards.length; i++) {
        obs.observe(cards[i], { attributes: true, attributeFilter: ['class'] });
      }
    })();

    /* -------------------------------------------------------- meeting flow */

    (function meeting() {
      var modal = document.getElementById('mreq');
      if (!modal) return;

      var wasOpen = !modal.hasAttribute('hidden');
      new MutationObserver(function () {
        try {
          var open = !modal.hasAttribute('hidden');
          if (open && !wasOpen) track('MEETING_MODAL_OPEN', { section: 'contact' });
          wasOpen = open;
        } catch (e) {}
      }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });

      /* "Started" means the visitor engaged with the form — the field name is
         recorded, never anything they typed. */
      var started = false;
      modal.addEventListener('input', function (ev) {
        try {
          if (started) return;
          started = true;
          track('MEETING_FORM_START', {
            section: 'contact',
            element: describe(ev.target),
            label: (ev.target && (ev.target.name || ev.target.id)) || null
          });
        } catch (e) {}
      }, { passive: true, capture: true });

      var form = document.getElementById('mreqForm');
      if (form) {
        form.addEventListener('submit', function () {
          try { track('MEETING_FORM_SUBMIT', { section: 'contact' }); } catch (e) {}
        }, { passive: true, capture: true });
      }
    })();

    /* ------------------------------------------------------------- closing */

    function finish() {
      try {
        track('SESSION_END', { scroll: progress(), meta: { engaged: engagedMs } });
        send(true);
      } catch (e) {}
    }

    window.addEventListener('pagehide', finish);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') { try { send(true); } catch (e) {} }
    });

    /* keeps "active now" honest for a visitor who sits reading */
    /* A heartbeat keeps "active now" honest for someone reading. It stops once
       they go idle, so a forgotten open tab cannot extend a session forever. */
    setInterval(function () {
      try {
        if (document.visibilityState !== 'visible') return;
        if ((Date.now() - lastActivityAt) > 2 * 60 * 1000) return;
        store.set(LS_AT, String(Date.now()));
        track('HEARTBEAT', {});
      } catch (e) {}
    }, 60000);

  } catch (err) {
    /* Analytics is never allowed to break the page. */
  }
})();
