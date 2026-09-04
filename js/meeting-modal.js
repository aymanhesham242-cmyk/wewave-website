/* =========================================================
   WeWave - meeting request modal

   Self-contained: the booking dialog, its calendar, validation and submit
   path. Nothing in the scroll engine reaches into this file, and this file
   touches nothing in the engine.

   Load order matters. It borrows $ and $$ from js/main.js, which is a classic
   script, so those bindings are already in scope by the time this runs. Keep
   the <script> tag for this file AFTER main.js, and do not redeclare $ or $$
   here -- a second top-level `const $` would be a SyntaxError, not a shadow.
   ========================================================= */

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
