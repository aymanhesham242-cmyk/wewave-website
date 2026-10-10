/* WeWave — Analytics dashboard.
   Lifted out of the page so the Content-Security-Policy can keep
   `script-src 'self'` with no 'unsafe-inline'. Behaviour is unchanged:
   this is the same code that used to sit in a <script> block. */
/* ============================================================
   Everything below talks to /api/a/* with the admin bearer
   token. No analytics data is embedded in this file.
   ============================================================ */
const KEY = 'wewave_admin_token';
let token = localStorage.getItem(KEY) || '';
let days = 7;
let view = 'overview';
let realtimeTimer = null;
let showTest = localStorage.getItem('wewave_a_test') === '1';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path) {
  const url = path + (path.includes('?') ? '&' : '?') + 'days=' + days + (showTest ? '&test=1' : '');
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 401) throw new Error('unauthorised');
  if (!r.ok) throw new Error('request failed (' + r.status + ')');
  return r.json();
}

/* ---------- formatting ---------- */
const nf = n => (n == null ? '0' : Number(n).toLocaleString('en-US'));
const pct = v => (v == null ? '0%' : (v * 100).toFixed(1).replace(/\.0$/, '') + '%');
function dur(s) {
  s = Math.round(s || 0);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  return m + 'm ' + String(s % 60).padStart(2, '0') + 's';
}
const clock = ts => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dayStr = ts => new Date(ts).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
const empty = msg => '<div class="empty">' + esc(msg) + '</div>';

/* A readable sentence for one event, used in the feed and the session timeline. */
function phrase(e) {
  const sec = e.section ? ' · ' + e.section : '';
  switch (e.type) {
    case 'SESSION_START': return 'Session started';
    case 'SESSION_END': return 'Session ended';
    case 'PAGE_VIEW': return 'Opened ' + (e.path || '/');
    case 'SECTION_VIEW': return 'Viewed ' + (e.section || 'a section');
    case 'SCROLL': return 'Reached ' + Math.round(e.scroll || 0) + '% scroll';
    case 'SERVICE_VIEW': return 'Focused service: ' + (e.label || '');
    case 'CTA_CLICK': return 'Clicked CTA “' + (e.label || e.element || '') + '”' + sec;
    case 'NAVIGATION_CLICK': return 'Navigation: ' + (e.label || '');
    case 'LOGO_CLICK': return 'Clicked the logo';
    case 'EXTERNAL_LINK_CLICK': return 'Left via ' + (e.label || 'an external link');
    case 'MEETING_MODAL_OPEN': return 'Opened the meeting form';
    case 'MEETING_FORM_START': return 'Started filling the form';
    case 'MEETING_FORM_SUBMIT': return 'Submitted a meeting request';
    case 'CLICK': return 'Clicked ' + (e.label ? '“' + e.label + '”' : (e.element || 'the page')) + sec;
    case 'TOUCH': return 'Tapped ' + (e.element || 'the page') + sec;
    case 'MOVE': return 'Pointer activity' + sec;
    case 'HEARTBEAT': return 'Still reading' + sec;
    default: return e.type;
  }
}

/* ---------- tiny chart helpers (no libraries) ---------- */
function lineChart(points, w, h) {
  if (!points.length) return empty('No visitor data yet.');
  const max = Math.max(1, ...points.map(p => p.v));
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const xy = points.map((p, i) => [i * step, h - (p.v / max) * (h - 18) - 8]);
  const d = xy.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const area = d + ' L' + w + ' ' + h + ' L0 ' + h + ' Z';
  const grid = [0, .25, .5, .75, 1].map(f =>
    '<line class="gl" x1="0" y1="' + (8 + f * (h - 18)).toFixed(1) + '" x2="' + w + '" y2="' + (8 + f * (h - 18)).toFixed(1) + '"/>').join('');
  const dots = xy.map((p, i) =>
    '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.5" fill="var(--glow-2)"><title>' +
    esc(points[i].k + ': ' + points[i].v) + '</title></circle>').join('');
  return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:' + h + 'px">' +
    '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" stop-color="#35C97A" stop-opacity=".30"/><stop offset="1" stop-color="#35C97A" stop-opacity="0"/>' +
    '</linearGradient></defs>' + grid +
    '<path class="ar" d="' + area + '"/><path class="ln" d="' + d + '"/>' + dots + '</svg>' +
    '<div style="display:flex;justify-content:space-between;font-family:var(--mono);font-size:10px;color:var(--faint);margin-top:6px">' +
    '<span>' + esc(points[0].k) + '</span><span>' + esc(points[points.length - 1].k) + '</span></div>';
}

function barRows(rows, keyName, valName, total) {
  if (!rows.length) return empty('Nothing recorded yet.');
  const max = Math.max(1, ...rows.map(r => r[valName]));
  return rows.map(r => {
    const v = r[valName] || 0;
    return '<div style="margin-bottom:11px">' +
      '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">' +
      '<span>' + esc(r[keyName] || 'unknown') + '</span>' +
      '<span class="mono" style="color:var(--dim)">' + nf(v) +
      (total ? ' · ' + pct(v / total) : '') + '</span></div>' +
      '<div class="bar"><i style="width:' + ((v / max) * 100).toFixed(1) + '%"></i></div></div>';
  }).join('');
}

/* ============================================================
   Views
   ============================================================ */
const views = {};

views.overview = async () => {
  const d = await api('/api/a/overview');
  const k = d.kpi;
  if (!k.sessions && !k.pageviews) {
    return '<div class="card">' + empty('No visitor data yet. Once someone visits the site, this fills in automatically.') + '</div>';
  }

  const kpi = (t, v, s) => '<div class="card kpi"><h3>' + t + '</h3><div class="v">' + v + '</div>' +
    (s ? '<div class="s">' + esc(s) + '</div>' : '') + '</div>';

  /* trend comes back as "days ago"; turn it into a dense series */
  const byDay = {};
  d.trend.forEach(r => { byDay[r.days_ago] = r.sessions; });
  const pts = [];
  for (let i = days - 1; i >= 0; i--) {
    pts.push({ k: dayStr(d.range.to - i * 86400000), v: byDay[i] || 0 });
  }

  const devTotal = d.devices.reduce((a, r) => a + r.n, 0);

  return '<div class="grid kpis">' +
      kpi('Unique sessions', nf(k.sessions)) +
      kpi('Page views', nf(k.pageviews)) +
      kpi('Avg engaged time', dur(k.avgSeconds), 'tab open ' + dur(k.avgSpan)) +
      kpi('Avg scroll depth', Math.round(k.avgScroll) + '%') +
      kpi('Interactions', nf(k.interactions)) +
      kpi('CTA clicks', nf(k.ctaClicks)) +
      kpi('Meeting requests', nf(k.meetingRequests)) +
      kpi('Conversion rate', pct(k.conversionRate), nf(k.meetingRequests) + ' of ' + nf(k.sessions)) +
    '</div>' +
    '<div class="grid three" style="margin-top:12px">' +
      '<div class="card"><h3>Visitors over time</h3>' + lineChart(pts, 640, 170) + '</div>' +
      '<div class="card"><h3>Devices</h3>' + barRows(d.devices, 'device', 'n', devTotal) + '</div>' +
    '</div>' +
    '<div class="grid two" style="margin-top:12px">' +
      '<div class="card"><h3>Top pages</h3>' + (d.pages.length ? '<table><thead><tr><th>Page</th><th class="num">Views</th><th class="num">Sessions</th></tr></thead><tbody>' +
        d.pages.map(p => '<tr><td>' + esc(p.path) + '</td><td class="num">' + nf(p.views) + '</td><td class="num">' + nf(p.sessions) + '</td></tr>').join('') +
        '</tbody></table>' : empty('No page views yet.')) + '</div>' +
      '<div class="card"><h3>Traffic sources</h3>' + barRows(d.sources, 'source', 'sessions', k.sessions) + '</div>' +
    '</div>' +
    '<div class="card" style="margin-top:12px"><h3>Recent activity</h3><div class="feed" id="feed"><div class="loading">…</div></div></div>';
};

views.heatmaps = async () => {
  const sections = ['all', 'hero', 'manifesto', 'services', 'process', 'clients', 'voices', 'contact'];
  const sel = (id, opts, cur) => '<select id="' + id + '">' +
    opts.map(o => '<option value="' + o[0] + '"' + (o[0] === cur ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>';

  return '<div class="hm-controls">' +
      sel('hmSection', sections.map(s => [s, s === 'all' ? 'All sections' : s[0].toUpperCase() + s.slice(1)]), 'hero') +
      sel('hmMode', [['clicks', 'Clicks'], ['touch', 'Touches'], ['move', 'Attention'], ['scroll', 'Scroll depth']], 'clicks') +
      sel('hmDevice', [['all', 'All devices'], ['desktop', 'Desktop'], ['mobile', 'Mobile'], ['tablet', 'Tablet']], 'all') +
      '<button class="btn sm ghost" id="hmReload">Refresh</button>' +
    '</div>' +
    '<div class="grid kpis" id="hmStats" style="margin-bottom:12px"></div>' +
    '<div id="hmBody"></div>';
};

views.sessions = async () => {
  const d = await api('/api/a/sessions');
  if (!d.sessions.length) return '<div class="card">' + empty('No sessions recorded yet.') + '</div>';
  return '<div class="card"><h3>' + nf(d.sessions.length) + ' sessions</h3><table><thead><tr>' +
    '<th>Started</th><th>Engaged</th><th>Tab open</th><th class="num">Pages</th><th class="num">Actions</th>' +
    '<th class="num">Scroll</th><th>Device</th><th>Country</th><th>Source</th></tr></thead><tbody>' +
    d.sessions.map(s => '<tr class="clickable" data-sid="' + esc(s.id) + '">' +
      '<td>' + dayStr(s.started_at) + ' <span class="mono" style="color:var(--faint)">' + clock(s.started_at) + '</span></td>' +
      '<td>' + dur((s.engaged_ms || 0) / 1000) + '</td>' +
      '<td style="color:var(--faint)">' + dur((s.last_at - s.started_at) / 1000) + '</td>' +
      '<td class="num">' + nf(s.pageviews) + '</td>' +
      '<td class="num">' + nf(s.interactions) + '</td>' +
      '<td class="num">' + Math.round(s.max_scroll || 0) + '%</td>' +
      '<td><span class="tag" title="' + esc(s.ua || 'user-agent not recorded') + '">' + esc(s.device || '?') + '</span></td>' +
      '<td>' + esc(s.country || '–') + '</td>' +
      '<td>' + esc(s.utm_source || s.ref_source || 'direct') + '</td></tr>').join('') +
    '</tbody></table></div>';
};

async function sessionDetail(id) {
  $('#view').innerHTML = '<div class="loading">Loading session…</div>';
  const d = await api('/api/a/session/' + encodeURIComponent(id));
  const s = d.session || {};
  $('#view').innerHTML = '<a class="back" href="#" id="backSessions">&larr; All sessions</a>' +
    '<div class="grid kpis" style="margin-bottom:12px">' +
      '<div class="card kpi"><h3>Engaged</h3><div class="v">' + dur((s.engaged_ms || 0) / 1000) + '</div>' +
        '<div class="s">tab open ' + dur(((s.last_at || 0) - (s.started_at || 0)) / 1000) + '</div></div>' +
      '<div class="card kpi"><h3>Interactions</h3><div class="v">' + nf(s.interactions) + '</div></div>' +
      '<div class="card kpi"><h3>Max scroll</h3><div class="v">' + Math.round(s.max_scroll || 0) + '%</div></div>' +
      '<div class="card kpi"><h3>Source</h3><div class="v" style="font-size:17px">' + esc(s.utm_source || s.ref_source || 'direct') + '</div>' +
        '<div class="s">' + esc([s.device, s.browser, s.os, s.country].filter(Boolean).join(' · ')) + '</div></div>' +
    '</div>' +
    '<div class="card"><h3>Event timeline</h3><div class="timeline">' +
      (d.events.length ? d.events.map(e => '<div class="tl"><span class="t">' + clock(e.ts) + '</span>' +
        '<span class="e"><b>' + esc(phrase(e)) + '</b>' +
        (e.element ? '<small>' + esc(e.element) + '</small>' : '') + '</span></div>').join('')
        : empty('No events in this session.')) +
    '</div></div>';
  $('#backSessions').addEventListener('click', e => { e.preventDefault(); render(); });
}

views.pages = async () => {
  const d = await api('/api/a/pages');
  if (!d.pages.length) return '<div class="card">' + empty('No pages tracked yet.') + '</div>';
  return '<div class="card"><table><thead><tr><th>Page</th><th class="num">Views</th>' +
    '<th class="num">Sessions</th><th class="num">Avg time</th><th class="num">Avg scroll</th>' +
    '<th class="num">CTA clicks</th><th class="num">Exits</th></tr></thead><tbody>' +
    d.pages.map(p => '<tr><td>' + esc(p.path) + '</td>' +
      '<td class="num">' + nf(p.views) + '</td><td class="num">' + nf(p.sessions) + '</td>' +
      '<td class="num">' + dur(p.avgSeconds) + '</td>' +
      '<td class="num">' + Math.round(p.avg_scroll || 0) + '%</td>' +
      '<td class="num">' + nf(p.cta) + '</td><td class="num">' + nf(p.exits) + '</td></tr>').join('') +
    '</tbody></table></div>';
};

views.conversions = async () => {
  const [f, sc] = await Promise.all([api('/api/a/funnel'), api('/api/a/scroll')]);
  const top = f.steps[0] ? f.steps[0].n : 0;
  if (!top) return '<div class="card">' + empty('No visitors in this range yet.') + '</div>';

  const rows = f.steps.map((s, i) => {
    const prev = i ? f.steps[i - 1].n : s.n;
    const w = top ? (s.n / top) * 100 : 0;
    return '<div class="fun-row"><span class="lbl">' + esc(s.label) + '</span>' +
      '<div class="fun-track"><i style="width:' + w.toFixed(1) + '%"></i></div>' +
      '<span class="n">' + nf(s.n) + ' <span>' + (i ? pct(prev ? s.n / prev : 0) : '100%') + '</span></span></div>';
  }).join('');

  const depth = sc.reached.map(r => '<div style="margin-bottom:11px">' +
    '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">' +
    '<span>' + r.depth + '% of the timeline</span><span class="mono" style="color:var(--dim)">' +
    nf(r.sessions) + ' · ' + pct(sc.total ? r.sessions / sc.total : 0) + '</span></div>' +
    '<div class="bar"><i style="width:' + (sc.total ? (r.sessions / sc.total) * 100 : 0).toFixed(1) + '%"></i></div></div>').join('');

  return '<div class="card"><h3>Conversion funnel</h3><div class="fun">' + rows + '</div>' +
      '<p class="hm-note">Each percentage is the share carried over from the step above.</p></div>' +
    '<div class="grid two" style="margin-top:12px">' +
      '<div class="card"><h3>Scroll depth reached</h3>' + depth +
        '<p class="hm-note">Average maximum depth: <b>' + Math.round(sc.avg) + '%</b> across ' + nf(sc.total) + ' sessions.</p></div>' +
      '<div class="card"><h3>Sections reached</h3>' + barRows(sc.sections, 'section', 'sessions', sc.total) + '</div>' +
    '</div>';
};

views.sources = async () => {
  const d = await api('/api/a/sources');
  if (!d.sources.length) return '<div class="card">' + empty('No traffic recorded yet.') + '</div>';
  return '<div class="card"><table><thead><tr><th>Source</th><th>Medium</th><th>Campaign</th>' +
    '<th class="num">Sessions</th><th class="num">CTA sessions</th><th class="num">Conversions</th>' +
    '<th class="num">Rate</th></tr></thead><tbody>' +
    d.sources.map(r => '<tr><td>' + esc(r.source) + '</td><td>' + esc(r.medium || '–') + '</td>' +
      '<td>' + esc(r.campaign || '–') + '</td><td class="num">' + nf(r.sessions) + '</td>' +
      '<td class="num">' + nf(r.cta_sessions) + '</td><td class="num">' + nf(r.conversions) + '</td>' +
      '<td class="num">' + pct(r.sessions ? r.conversions / r.sessions : 0) + '</td></tr>').join('') +
    '</tbody></table></div>';
};

views.devices = async () => {
  const d = await api('/api/a/devices');
  const tot = d.devices.reduce((a, r) => a + r.n, 0);
  if (!tot) return '<div class="card">' + empty('No device data yet.') + '</div>';
  const table = (rows, head) => '<table><thead><tr><th>' + head + '</th><th class="num">Sessions</th>' +
    '<th class="num">Avg scroll</th><th class="num">Avg time</th></tr></thead><tbody>' +
    rows.map(r => '<tr><td>' + esc(r.k) + '</td><td class="num">' + nf(r.n) + '</td>' +
      '<td class="num">' + Math.round(r.avg_scroll || 0) + '%</td>' +
      '<td class="num">' + dur(r.avg_seconds) + '</td></tr>').join('') + '</tbody></table>';
  return '<div class="grid two">' +
      '<div class="card"><h3>Device type</h3>' + table(d.devices, 'Device') + '</div>' +
      '<div class="card"><h3>Browser</h3>' + table(d.browsers, 'Browser') + '</div>' +
    '</div><div class="grid two" style="margin-top:12px">' +
      '<div class="card"><h3>Operating system</h3>' + table(d.os, 'OS') + '</div>' +
      '<div class="card"><h3>Country</h3>' + table(d.countries, 'Country') + '</div>' +
    '</div><div class="card" style="margin-top:12px"><h3>Viewport sizes</h3>' +
      (d.screens.length ? '<table><thead><tr><th>Viewport</th><th class="num">Sessions</th></tr></thead><tbody>' +
        d.screens.map(s => '<tr><td class="mono">' + s.vw + ' × ' + s.vh + '</td><td class="num">' + nf(s.n) + '</td></tr>').join('') +
        '</tbody></table>' : empty('No viewport data yet.')) + '</div>';
};

views.events = async () => {
  const d = await api('/api/a/events');
  if (!d.types.length) return '<div class="card">' + empty('No events recorded yet.') + '</div>';
  return '<div class="grid two">' +
    '<div class="card"><h3>Event types</h3><table><thead><tr><th>Type</th><th class="num">Count</th>' +
      '<th class="num">Sessions</th></tr></thead><tbody>' +
      d.types.map(t => '<tr><td class="mono">' + esc(t.type) + '</td><td class="num">' + nf(t.n) + '</td>' +
        '<td class="num">' + nf(t.sessions) + '</td></tr>').join('') + '</tbody></table></div>' +
    '<div class="card"><h3>Latest events</h3><div class="feed">' +
      d.recent.map(e => '<div class="feed-row"><span class="tm">' + clock(e.ts) + '</span><span>' +
        esc(phrase(e)) + '</span></div>').join('') + '</div></div></div>';
};

views.settings = async () => {
  return '<div class="card"><h3>Data collection</h3>' +
    '<p style="color:var(--dim);font-size:13px">Events are collected by <span class="mono">js/analytics.js</span> ' +
    'and stored in the D1 database bound as <span class="mono">DB</span>, in the tables ' +
    '<span class="mono">a_event</span> and <span class="mono">a_session</span>. No IP addresses, form values ' +
    'or personal details are stored — the session id is random and expires after 30 minutes of inactivity.</p>' +
    '<p style="color:var(--dim);font-size:13px;margin-top:10px">Visitors who send a Do-Not-Track header are not counted.</p>' +
    '</div>' +
    '<div class="card" style="margin-top:12px"><h3>Development mode</h3>' +
    '<p style="color:var(--dim);font-size:13px">Append <span class="mono">?wwtest=1</span> to any page URL to mark ' +
    'that browser as a test client. Its events are stored separately and never appear in the figures above ' +
    'unless you switch the toggle below.</p>' +
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">' +
      '<button class="btn sm ghost" id="toggleTest">' + (showTest ? 'Showing test data — switch to live' : 'Show test data instead') + '</button>' +
      '<button class="btn sm ghost" id="purgeTest" style="border-color:rgba(212,104,91,.5);color:#E4998E">Delete all test data</button>' +
    '</div><p class="err" id="setErr"></p></div>' +
    '<div class="card" style="margin-top:12px"><h3>How the numbers are measured</h3>' +
    '<table><tbody>' +
      '<tr><td>Engaged time</td><td style="color:var(--dim)">Seconds the tab was visible <em>and</em> the visitor moved, scrolled, typed or tapped within the last 30s. A tab left open adds nothing.</td></tr>' +
      '<tr><td>Tab open</td><td style="color:var(--dim)">First to last event. Shown alongside engaged time so a gap between them is visible rather than hidden.</td></tr>' +
      '<tr><td>Session</td><td style="color:var(--dim)">One anonymous id, continuing while gaps stay under 30 minutes. A reload continues it; it does not start a new one.</td></tr>' +
      '<tr><td>Bounce</td><td style="color:var(--dim)">No interaction <em>and</em> under 10 seconds engaged.</td></tr>' +
      '<tr><td>Scroll depth</td><td style="color:var(--dim)">Progress along the stage timeline, not a document position — 100% means the contact stage.</td></tr>' +
      '<tr><td>Device / OS / country</td><td style="color:var(--dim)">Derived server-side from the request. Browser device-emulation reports the emulated device, so DevTools testing shows up as that phone.</td></tr>' +
      '<tr><td>Your own visits</td><td style="color:var(--dim)">Any browser holding the admin token is flagged as test automatically and kept out of these figures.</td></tr>' +
    '</tbody></table></div>' +
    '<div class="card" style="margin-top:12px"><h3>Start clean for launch</h3>' +
    '<p style="color:var(--dim);font-size:13px">Deletes every live session and event so the first real visitor starts the record. ' +
    'Test data and meeting requests are not touched. This cannot be undone.</p>' +
    '<button class="btn sm ghost" id="resetLive" style="margin-top:12px;border-color:rgba(212,104,91,.5);color:#E4998E">Delete all live analytics</button>' +
    '<p class="err" id="resetErr"></p></div>';
};

/* ============================================================
   Heatmap rendering
   ============================================================ */

/* Classic density field: every point stamps a radial alpha gradient, then the
   accumulated alpha is mapped through a colour ramp. That is what gives the
   smooth blended look rather than a scatter of dots. */
function paintHeat(canvas, points, w, h) {
  const ctx = canvas.getContext('2d');
  canvas.width = w; canvas.height = h;
  ctx.clearRect(0, 0, w, h);
  if (!points.length) return;

  const maxW = Math.max(...points.map(p => p.w));
  const radius = Math.max(26, Math.round(Math.min(w, h) * 0.055));

  points.forEach(p => {
    const x = p.x * w, y = p.y * h;
    const a = Math.min(1, 0.22 + 0.78 * (p.w / maxW));
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, 'rgba(0,0,0,' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  });

  /* map accumulated alpha -> colour ramp */
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const ramp = [
    [0.00, [0, 0, 0, 0]],
    [0.20, [0, 90, 255, 90]],
    [0.40, [0, 230, 180, 150]],
    [0.60, [240, 220, 60, 200]],
    [0.80, [245, 120, 40, 225]],
    [1.00, [230, 40, 40, 240]]
  ];
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] / 255;
    if (!a) continue;
    let lo = ramp[0], hi = ramp[ramp.length - 1];
    for (let j = 0; j < ramp.length - 1; j++) {
      if (a >= ramp[j][0] && a <= ramp[j + 1][0]) { lo = ramp[j]; hi = ramp[j + 1]; break; }
    }
    const t = (a - lo[0]) / Math.max(0.0001, hi[0] - lo[0]);
    d[i]     = Math.round(lo[1][0] + (hi[1][0] - lo[1][0]) * t);
    d[i + 1] = Math.round(lo[1][1] + (hi[1][1] - lo[1][1]) * t);
    d[i + 2] = Math.round(lo[1][2] + (hi[1][2] - lo[1][2]) * t);
    d[i + 3] = Math.round(lo[1][3] + (hi[1][3] - lo[1][3]) * t);
  }
  ctx.putImageData(img, 0, 0);
}

/* Stage windows mirror STAGES in js/main.js — used to park the live site at the
   right point behind the heatmap. */
const STAGE_AT = {
  hero: 0.04, manifesto: 0.17, services: 0.35, process: 0.55,
  clients: 0.70, voices: 0.81, contact: 0.94
};

async function renderHeatmap() {
  const section = $('#hmSection').value;
  const mode = $('#hmMode').value;
  const device = $('#hmDevice').value;
  const body = $('#hmBody');
  const stats = $('#hmStats');

  body.innerHTML = '<div class="loading">Loading…</div>';

  if (mode === 'scroll') {
    const sc = await api('/api/a/scroll');
    stats.innerHTML = '<div class="card kpi"><h3>Sessions</h3><div class="v">' + nf(sc.total) + '</div></div>' +
      '<div class="card kpi"><h3>Average depth</h3><div class="v">' + Math.round(sc.avg) + '%</div></div>';
    body.innerHTML = '<div class="card"><h3>Where visitors stop</h3>' +
      sc.reached.map(r => '<div style="margin-bottom:11px">' +
        '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">' +
        '<span>' + r.depth + '%</span><span class="mono" style="color:var(--dim)">' + nf(r.sessions) + ' sessions · ' +
        pct(sc.total ? r.sessions / sc.total : 0) + '</span></div>' +
        '<div class="bar"><i style="width:' + (sc.total ? (r.sessions / sc.total) * 100 : 0).toFixed(1) + '%"></i></div>' +
        '</div>').join('') + '</div>';
    return;
  }

  const q = '/api/a/heatmap?mode=' + mode + '&section=' + encodeURIComponent(section) + '&device=' + device;
  const d = await api(q);

  stats.innerHTML =
    '<div class="card kpi"><h3>Interactions</h3><div class="v">' + nf(d.total) + '</div></div>' +
    '<div class="card kpi"><h3>Unique sessions</h3><div class="v">' + nf(d.sessions) + '</div></div>' +
    '<div class="card kpi"><h3>Most engaged element</h3><div class="v" style="font-size:15px">' +
      esc(d.top[0] ? (d.top[0].label || d.top[0].element) : '–') + '</div>' +
      '<div class="s">' + (d.top[0] ? nf(d.top[0].n) + ' interactions' : '') + '</div></div>' +
    '<div class="card kpi"><h3>Avg scroll depth</h3><div class="v">' + Math.round(d.avgScroll) + '%</div></div>';

  if (!d.points.length) {
    body.innerHTML = '<div class="card">' + empty('No ' + mode + ' recorded for this selection yet.') + '</div>';
    return;
  }

  /* The live site is loaded behind the overlay and parked at the selected
     stage, so the heatmap always sits on the real current page. */
  const at = STAGE_AT[section] !== undefined ? STAGE_AT[section] : 0.04;
  body.innerHTML = '<div class="hm-stage" id="hmStage">' +
      '<iframe id="hmFrame" src="/?wwtest=1#analytics-preview" title="Site preview" scrolling="no"></iframe>' +
      '<canvas id="hmCanvas"></canvas>' +
    '</div>' +
    '<div class="hm-legend"><span>Low</span><span class="hm-scale"></span><span>High</span>' +
      '<span style="margin-left:auto">' + nf(d.total) + ' interactions · ' + nf(d.sessions) + ' sessions</span></div>' +
    '<p class="hm-note">The page behind the overlay is the live site, parked at the ' +
      esc(section === 'all' ? 'hero' : section) + ' stage. Coordinates are stored normalised to the viewport, ' +
      'so clicks from every screen size line up.</p>' +
    (d.top.length ? '<div class="card" style="margin-top:12px"><h3>Most interacted elements</h3>' +
      '<table><thead><tr><th>Element</th><th>Label</th><th class="num">Interactions</th></tr></thead><tbody>' +
      d.top.map(t => '<tr><td class="mono">' + esc(t.element) + '</td><td>' + esc(t.label || '–') +
        '</td><td class="num">' + nf(t.n) + '</td></tr>').join('') + '</tbody></table></div>' : '');

  const frame = $('#hmFrame');
  const stage = $('#hmStage');
  /* keep the preview at the site's own aspect so normalised coords map 1:1 */
  const wRect = stage.getBoundingClientRect();
  const ratio = device === 'mobile' ? 16 / 9 : 9 / 16;
  const fh = Math.round(device === 'mobile' ? wRect.width * 1.6 : wRect.width * 0.5625);
  frame.style.height = fh + 'px';

  const canvas = $('#hmCanvas');
  const draw = () => paintHeat(canvas, d.points, Math.round(wRect.width), fh);
  draw();

  frame.addEventListener('load', () => {
    try {
      const w = frame.contentWindow;
      const doc = w.document;
      /* park the timeline; the site reads scrollY, so setting it is enough */
      const target = () => {
        const max = Math.max(1, doc.documentElement.scrollHeight - w.innerHeight);
        w.scrollTo(0, max * at);
      };
      target();
      setTimeout(target, 400);
      setTimeout(target, 1200);
      /* the preview is for looking at, not clicking through */
      doc.documentElement.style.pointerEvents = 'none';
    } catch (e) { /* cross-origin would land here; same origin in practice */ }
  });
}

/* ============================================================
   Shell
   ============================================================ */
async function render() {
  const el = $('#view');
  el.innerHTML = '<div class="loading">Loading…</div>';
  $('#title').textContent = ({
    overview: 'Overview', heatmaps: 'Heatmaps', sessions: 'Sessions', pages: 'Pages',
    conversions: 'Conversions', sources: 'Traffic sources', devices: 'Devices',
    events: 'Events', settings: 'Settings'
  })[view] || 'Overview';

  try {
    el.innerHTML = await views[view]();
  } catch (e) {
    if (e.message === 'unauthorised') return lock('That token was not accepted.');
    el.innerHTML = '<div class="card">' + empty('Could not load: ' + e.message) + '</div>';
    return;
  }

  if (view === 'heatmaps') {
    ['hmSection', 'hmMode', 'hmDevice'].forEach(id =>
      $('#' + id).addEventListener('change', () => renderHeatmap().catch(() => {})));
    $('#hmReload').addEventListener('click', () => renderHeatmap().catch(() => {}));
    renderHeatmap().catch(() => {});
  }

  if (view === 'sessions') {
    $$('tr.clickable').forEach(tr =>
      tr.addEventListener('click', () => sessionDetail(tr.dataset.sid).catch(() => {})));
  }

  if (view === 'overview') refreshFeed();

  if (view === 'settings') {
    $('#toggleTest').addEventListener('click', () => {
      showTest = !showTest;
      localStorage.setItem('wewave_a_test', showTest ? '1' : '0');
      $('#modeLabel').textContent = showTest ? 'TEST data' : 'live data';
      render();
    });
    $('#resetLive').addEventListener('click', async () => {
      if (!confirm('Delete ALL live analytics? Test data and meeting requests are kept. This cannot be undone.')) return;
      try {
        const r = await fetch('/api/a/reset-live?confirm=RESET', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
        $('#resetErr').textContent = r.ok ? 'Live analytics cleared.' : 'Could not clear live analytics.';
      } catch (e) { $('#resetErr').textContent = 'Could not clear live analytics.'; }
    });
    $('#purgeTest').addEventListener('click', async () => {
      try {
        await fetch('/api/a/purge-test', { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
        $('#setErr').textContent = 'Test data deleted.';
      } catch (e) { $('#setErr').textContent = 'Could not delete test data.'; }
    });
  }
}

async function refreshFeed() {
  try {
    const d = await api('/api/a/realtime');
    $('#activeNow').textContent = d.active;
    const feed = $('#feed');
    if (!feed) return;
    feed.innerHTML = d.feed.length
      ? d.feed.map(e => '<div class="feed-row"><span class="tm">' + clock(e.ts) + '</span><span>' +
          esc(phrase(e)) + (e.country ? ' <span class="tag">' + esc(e.country) + '</span>' : '') + '</span></div>').join('')
      : empty('Nothing in the last 30 minutes.');
  } catch (e) { /* leave the last good state on screen */ }
}

async function tickActive() {
  try {
    const d = await api('/api/a/realtime');
    $('#activeNow').textContent = d.active;
    if (view === 'overview') refreshFeed();
  } catch (e) {}
}

function unlock() {
  $('#modeLabel').textContent = showTest ? 'TEST data' : 'live data';
  $('#gate').hidden = true;
  $('#shell').hidden = false;
  render();
  clearInterval(realtimeTimer);
  realtimeTimer = setInterval(tickActive, 15000);
  tickActive();
}

function lock(msg) {
  localStorage.removeItem(KEY); token = '';
  clearInterval(realtimeTimer);
  $('#shell').hidden = true;
  $('#gate').hidden = false;
  $('#gateErr').textContent = msg || '';
}

$('#go').addEventListener('click', async () => {
  token = $('#tok').value.trim();
  if (!token) return;
  localStorage.setItem(KEY, token);
  $('#gateErr').textContent = '';
  try { await api('/api/a/realtime'); unlock(); }
  catch (e) { lock(e.message === 'unauthorised' ? 'That token was not accepted.' : 'Could not reach the API.'); }
});
$('#tok').addEventListener('keydown', e => { if (e.key === 'Enter') $('#go').click(); });
$('#lock').addEventListener('click', () => lock(''));

$('#nav').addEventListener('click', e => {
  const b = e.target.closest('button[data-v]');
  if (!b) return;
  $$('#nav button').forEach(x => x.classList.toggle('on', x === b));
  view = b.dataset.v;
  render();
});

$('#ranges').addEventListener('click', e => {
  const b = e.target.closest('button[data-d]');
  if (!b) return;
  $$('#ranges button').forEach(x => x.classList.toggle('on', x === b));
  days = Number(b.dataset.d);
  render();
});

if (token) unlock();
