/* Voice-note testimonials.
   Self-contained IIFE: declares nothing at top level, so it cannot collide
   with main.js or meeting-modal.js. Progress is driven by the audio element's
   own timeupdate event — no second requestAnimationFrame loop. */
(function () {
  'use strict';

  var cards = document.querySelectorAll('.voice');
  if (!cards.length) return;

  var players = [];

  var fmt = function (s) {
    if (!isFinite(s) || s < 0) s = 0;
    var m = Math.floor(s / 60);
    var r = Math.floor(s % 60);
    return m + ':' + (r < 10 ? '0' : '') + r;
  };

  Array.prototype.forEach.call(cards, function (card) {
    var audio = card.querySelector('.voice-audio');
    var btn = card.querySelector('.voice-play');
    var fill = card.querySelector('.voice-fill');
    var time = card.querySelector('.voice-time');
    if (!audio || !btn) return;

    // WhatsApp's Ogg/Opus files carry no duration header, so audio.duration
    // can be NaN or Infinity. data-duration is the declared fallback.
    var declared = parseFloat(audio.getAttribute('data-duration') || '0');
    var total = isFinite(declared) && declared > 0 ? declared : 0;

    var realDuration = function () {
      var d = audio.duration;
      return (isFinite(d) && d > 0) ? d : total;
    };

    var paint = function () {
      if (!total || !fill) return;
      var p = Math.min(1, audio.currentTime / total);
      fill.style.width = (p * 100).toFixed(2) + '%';
      if (time) time.textContent = fmt(total - audio.currentTime);
    };

    audio.addEventListener('loadedmetadata', function () {
      total = realDuration();
      card.classList.remove('is-loading');
      if (time) time.textContent = fmt(total);
    });
    audio.addEventListener('durationchange', function () { total = realDuration(); });
    audio.addEventListener('playing', function () { card.classList.remove('is-loading'); });
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('play', function () {
      card.classList.add('is-playing');
      players.forEach(function (other) {
        if (other !== audio && !other.paused) other.pause();
      });
    });
    audio.addEventListener('pause', function () { card.classList.remove('is-playing'); });
    audio.addEventListener('ended', function () {
      card.classList.remove('is-playing');
      audio.currentTime = 0;
      if (fill) fill.style.width = '0%';
      if (time && total) time.textContent = fmt(total);
    });
    audio.addEventListener('error', function () {
      card.classList.remove('is-playing', 'is-loading');
      if (time) time.textContent = '—';
      btn.disabled = true;
    });

    btn.addEventListener('click', function () {
      if (audio.paused) {
        card.classList.add('is-loading');
        var p = audio.play();
        if (p && p.catch) p.catch(function () { card.classList.remove('is-loading', 'is-playing'); });
      } else {
        audio.pause();
      }
    });

    // scrubbing
    var bar = card.querySelector('.voice-bar');
    if (bar) {
      bar.addEventListener('click', function (e) {
        if (!total) return;
        var r = bar.getBoundingClientRect();
        if (!r.width) return;
        audio.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * total;
        paint();
      });
    }

    players.push(audio);
  });

  // The stages are fixed crossfaded layers, so a card can be invisible while
  // still playing. Stop it when its stage stops being live.
  var stage = document.querySelector('.stage-voices');
  if (stage && 'MutationObserver' in window) {
    new MutationObserver(function () {
      if (stage.classList.contains('live')) return;
      players.forEach(function (a) { if (!a.paused) a.pause(); });
    }).observe(stage, { attributes: true, attributeFilter: ['class'] });
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    players.forEach(function (a) { if (!a.paused) a.pause(); });
  });
})();
