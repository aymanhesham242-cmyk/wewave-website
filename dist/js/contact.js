/* Contact channels on the contact stage.
   Self-contained IIFE: declares nothing at top level, so it cannot collide
   with main.js, meeting-modal.js or voice.js. It reads the page and toggles
   one class -- no layout is written, and no second rAF loop is started. */
(function () {
  'use strict';

  var btn = document.getElementById('contactBtn');
  var ways = document.getElementById('contactWays');
  if (!btn || !ways) return;

  var open = function (want) {
    if (want === ways.classList.contains('is-open')) return;
    ways.classList.toggle('is-open', want);
    btn.setAttribute('aria-expanded', want ? 'true' : 'false');
    if (want && typeof window.wwTrack === 'function') {
      try { window.wwTrack('CONTACT_WAYS_OPEN', {}); } catch (e) { /* never break the page */ }
    }
  };

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    open(!ways.classList.contains('is-open'));
  });

  /* The stages are fixed crossfaded layers, so the panel can stay open behind
     another stage. Fold it away when contact stops being live, the same way
     voice.js stops a note that is no longer on screen. */
  var stage = document.querySelector('.stage-contact');
  if (stage && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (!stage.classList.contains('live')) open(false);
    }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' || e.key === 'Esc') open(false);
  });
})();
