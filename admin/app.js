/* WeWave — Meeting-request moderation panel.
   Lifted out of the page so the Content-Security-Policy can keep
   `script-src 'self'` with no 'unsafe-inline'. Behaviour is unchanged:
   this is the same code that used to sit in a <script> block. */
const KEY = 'wewave_admin_token';
let token = localStorage.getItem(KEY) || '';
let filter = 'all';
let data = { meetings: [], counts: {} };

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  if (res.status === 401) throw new Error('unauthorised');
  if (!res.ok) throw new Error('Request failed (' + res.status + ')');
  return res.json();
}

function fmtWhen(iso) {
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
}
function fmtDate(s) {
  const d = new Date(s + 'T00:00:00');
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'long', year:'numeric' });
}
const linkify = u => /^https?:\/\//i.test(u) ? u : 'https://' + u;

function renderTabs() {
  const c = data.counts || {};
  const total = Object.values(c).reduce((a, b) => a + b, 0);
  const defs = [['all','All',total],['new','New',c.new||0],['contacted','Contacted',c.contacted||0],
                ['booked','Booked',c.booked||0],['archived','Archived',c.archived||0]];
  $('#tabs').innerHTML = defs.map(([k,label,n]) =>
    `<button class="tab ${filter===k?'on':''}" data-f="${k}">${label}<b>${n}</b></button>`).join('');
  document.querySelectorAll('.tab').forEach(t =>
    t.onclick = () => { filter = t.dataset.f; load(); });
}

function renderList() {
  const list = $('#list');
  if (!data.meetings.length) {
    list.innerHTML = '<p class="empty">No requests here yet.</p>';
    return;
  }
  list.innerHTML = data.meetings.map(m => `
    <div class="row s-${esc(m.status)}" data-id="${esc(m.id)}">
      <div class="r-top">
        <span class="r-name">${esc(m.name)}</span>
        <span class="r-when">${esc(fmtWhen(m.created_at))}</span>
      </div>
      <div class="r-meta">
        <a href="${esc(linkify(m.brand_link))}" target="_blank" rel="noopener">${esc(m.brand_link)}</a>
        <a href="tel:${esc(m.phone.replace(/\s/g,''))}">${esc(m.phone)}</a>
      </div>
      <div class="r-date">Wants: ${esc(fmtDate(m.meeting_date))}</div>
      <div class="r-tags">${m.services.map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
      ${m.message ? `<p class="r-msg">${esc(m.message)}</p>` : ''}
      <div class="r-foot">
        <select class="sel" data-status>
          ${['new','contacted','booked','archived'].map(s =>
            `<option value="${s}" ${m.status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <input class="note" data-note placeholder="Internal note…" value="${esc(m.notes || '')}">
        <span class="saved">saved</span>
      </div>
    </div>`).join('');

  list.querySelectorAll('.row').forEach(row => {
    const id = row.dataset.id;
    const flash = () => {
      const s = row.querySelector('.saved');
      s.classList.add('on'); setTimeout(() => s.classList.remove('on'), 1200);
    };
    row.querySelector('[data-status]').onchange = async e => {
      await api('/api/meetings/' + id, { method:'PATCH', body: JSON.stringify({ status: e.target.value }) });
      flash(); load();
    };
    let t;
    row.querySelector('[data-note]').oninput = e => {
      clearTimeout(t);
      t = setTimeout(async () => {
        await api('/api/meetings/' + id, { method:'PATCH', body: JSON.stringify({ notes: e.target.value }) });
        flash();
      }, 600);                                   /* debounce so typing isn't a write per keystroke */
    };
  });
}

async function load() {
  try {
    const q = filter === 'all' ? '' : '?status=' + filter;
    data = await api('/api/meetings' + q);
    renderTabs(); renderList();
  } catch (e) {
    if (e.message === 'unauthorised') return lock('That token was not accepted.');
    $('#list').innerHTML = '<p class="empty">' + esc(e.message) + '</p>';
  }
}

function unlock() {
  $('#gate').hidden = true;
  $('#app').hidden = false;
  load();
}
function lock(msg) {
  localStorage.removeItem(KEY); token = '';
  $('#app').hidden = true;
  $('#gate').hidden = false;
  $('#gateErr').textContent = msg || '';
}

$('#tokGo').onclick = () => {
  token = $('#tok').value.trim();
  if (!token) return;
  localStorage.setItem(KEY, token);
  $('#gateErr').textContent = '';
  unlock();
};
$('#tok').addEventListener('keydown', e => { if (e.key === 'Enter') $('#tokGo').click(); });
$('#refresh').onclick = load;
$('#logout').onclick = () => lock('');

if (token) unlock();
