/* WeWave — case study dashboard.
 *
 * Counts the figures up when the section comes into view. Nothing else: the
 * case studies are stacked on the page, not switched between.
 *
 * The numbers are rendered into the HTML by the build, not by this file. It
 * only animates up to them and then puts the server's exact string back, so
 * what settles on screen is byte-identical to what the report says — and a
 * visitor with no JavaScript sees the right figures immediately.
 *
 * Self-contained IIFE declaring nothing at top level, loaded with `src`
 * because the site's CSP is `script-src 'self'` with no 'unsafe-inline'.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-cs]');
  if (!root) return;

  var reduced = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ counters */

  var cells = Array.prototype.slice.call(root.querySelectorAll('[data-count]'));

  function run(cell) {
    var target = parseFloat(cell.getAttribute('data-count'));
    if (!isFinite(target)) return;

    var final = cell.innerHTML;              /* the truth, kept verbatim */
    var unit = cell.querySelector('.cs-u');
    var unitHTML = unit ? unit.outerHTML : '';
    var decimals = (String(cell.getAttribute('data-count')).split('.')[1] || '').length;

    var start = null;
    var span = 1100;

    function frame(now) {
      if (start === null) start = now;
      var t = Math.min((now - start) / span, 1);
      /* ease out, so it decelerates onto the number rather than snapping */
      var v = target * (1 - Math.pow(1 - t, 3));
      cell.innerHTML = v.toLocaleString('en-US', {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals
      }) + unitHTML;
      if (t < 1) requestAnimationFrame(frame);
      else cell.innerHTML = final;           /* land on the exact string */
    }
    requestAnimationFrame(frame);
  }

  if (!reduced && cells.length && 'IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.4 });
    cells.forEach(function (c) { io.observe(c); });
  }
  /* With reduced motion, or no observer, the figures are already on screen —
     the build wrote them there. Nothing to do. */

  /* There is deliberately nothing else in here. The case studies are stacked
     on the page and reached by scrolling; the tab strip that used to switch
     between them hid two of the three well enough that they were reported
     missing. Counting the figures up is all this file does. */
})();
