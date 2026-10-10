/**
 * WeWave — Case Study Analytics: charts.
 *
 * Hand-rolled SVG. The site has no bundler and no dependencies, and a charting
 * library would be the first exception -- these are line charts over at most a
 * few hundred points, which is well inside what plain SVG does comfortably.
 *
 * The data always arrives already computed by the engine, so nothing in here
 * invents a value: a chart is a drawing of `series()` output and no more. Null
 * points (a day whose CPC cannot be calculated) break the line rather than
 * being drawn as zero, which would read as real performance.
 */

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs, parent) {
  const node = document.createElementNS(NS, name);
  for (const k in attrs) {
    if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
  }
  if (parent) parent.appendChild(node);
  return node;
}

/** Round axis bounds out to a readable step, so gridlines land on sane numbers. */
function niceBounds(min, max) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, step: 0.25 };
  if (min === max) {
    if (min === 0) return { lo: 0, hi: 1, step: 0.25 };
    const pad = Math.abs(min) * 0.2;
    min -= pad; max += pad;
  }
  const lo = Math.min(0, min);                 /* value charts read better from zero */
  const span = max - lo || 1;
  const raw = span / 4;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10) * mag;
  return { lo: Math.floor(lo / step) * step, hi: Math.ceil(max / step) * step, step };
}

function shortDate(iso) {
  const d = new Date(iso + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

/**
 * Draw one line chart into `host`.
 *
 *   dates    ISO date strings, one per point
 *   values   numbers, or null where the metric cannot be calculated
 *   format   fn(value) -> display string, used for the axis and the tooltip
 *   colour   stroke colour; the fill is derived from it
 *
 * Re-rendering is a full redraw. At this size that is cheaper and far less
 * error-prone than diffing, and it means a chart can never show a stale point.
 */
export function lineChart(host, opts) {
  const dates  = opts.dates || [];
  const values = opts.values || [];
  const format = opts.format || (v => String(v));
  const colour = opts.colour || '#0866FF';

  host.textContent = '';

  const real = values.filter(v => v !== null && Number.isFinite(v));
  if (!dates.length || !real.length) {
    const p = document.createElement('p');
    p.className = 'chart-empty';
    p.textContent = 'Nothing to chart for this range yet.';
    host.appendChild(p);
    return;
  }

  /* A viewBox plus width:100% is what makes these responsive without a resize
     listener: the browser scales the drawing and we never recompute on resize. */
  const W = 720, H = 220;
  const pad = { top: 14, right: 12, bottom: 26, left: 56 };
  const plotW = W - pad.left - pad.right;
  const plotH = H - pad.top - pad.bottom;

  const { lo, hi, step } = niceBounds(Math.min(...real), Math.max(...real));
  const span = hi - lo || 1;

  const x = i => pad.left + (dates.length === 1 ? plotW / 2 : (i / (dates.length - 1)) * plotW);
  const y = v => pad.top + plotH - ((v - lo) / span) * plotH;

  const svg = el('svg', {
    viewBox: '0 0 ' + W + ' ' + H, class: 'chart-svg',
    preserveAspectRatio: 'none', role: 'img',
    'aria-label': (opts.label || 'Chart') + ' over ' + dates.length + ' days'
  }, host);

  const gid = 'g' + Math.random().toString(36).slice(2, 8);
  const grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
    el('defs', {}, svg));
  el('stop', { offset: '0%',   'stop-color': colour, 'stop-opacity': 0.22 }, grad);
  el('stop', { offset: '100%', 'stop-color': colour, 'stop-opacity': 0 }, grad);

  /* gridlines + value axis */
  for (let v = lo; v <= hi + step / 2; v += step) {
    const gy = y(v);
    el('line', { x1: pad.left, y1: gy, x2: W - pad.right, y2: gy, class: 'chart-grid' }, svg);
    el('text', { x: pad.left - 8, y: gy + 3.5, class: 'chart-axis chart-axis-y' }, svg)
      .textContent = format(v);
  }

  /* date axis — at most five labels, so they never collide */
  const ticks = Math.min(5, dates.length);
  for (let t = 0; t < ticks; t++) {
    const i = ticks === 1 ? 0 : Math.round((t / (ticks - 1)) * (dates.length - 1));
    el('text', { x: x(i), y: H - 8, class: 'chart-axis chart-axis-x' }, svg)
      .textContent = shortDate(dates[i]);
  }

  /* The line is drawn as segments split on nulls, so a gap in the data reads
     as a gap rather than a plunge to the axis. */
  const segments = [];
  let run = [];
  values.forEach((v, i) => {
    if (v === null || !Number.isFinite(v)) {
      if (run.length) { segments.push(run); run = []; }
    } else {
      run.push([x(i), y(v)]);
    }
  });
  if (run.length) segments.push(run);

  for (const seg of segments) {
    if (seg.length > 1) {
      const base = pad.top + plotH;
      el('path', {
        class: 'chart-area', fill: 'url(#' + gid + ')',
        d: 'M' + seg[0][0] + ',' + base + 'L' +
           seg.map(p => p[0] + ',' + p[1]).join('L') +
           'L' + seg[seg.length - 1][0] + ',' + base + 'Z'
      }, svg);
    }
    el('path', {
      class: 'chart-line', stroke: colour, fill: 'none',
      d: (seg.length === 1 ? 'M' : 'M') + seg.map(p => p[0] + ',' + p[1]).join('L')
    }, svg);
    if (seg.length === 1) {
      el('circle', { cx: seg[0][0], cy: seg[0][1], r: 3, fill: colour }, svg);
    }
  }

  /* hover readout */
  const focus = el('g', { class: 'chart-focus', opacity: 0 }, svg);
  el('line', { y1: pad.top, y2: pad.top + plotH, class: 'chart-crosshair' }, focus);
  const dot = el('circle', { r: 4, class: 'chart-dot', stroke: colour }, focus);

  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  host.appendChild(tip);

  const hit = el('rect', {
    x: pad.left, y: pad.top, width: plotW, height: plotH,
    fill: 'transparent', class: 'chart-hit'
  }, svg);

  function at(clientX) {
    const box = svg.getBoundingClientRect();
    if (!box.width) return -1;
    const vx = ((clientX - box.left) / box.width) * W;
    const i = dates.length === 1 ? 0
      : Math.round(((vx - pad.left) / plotW) * (dates.length - 1));
    return Math.max(0, Math.min(dates.length - 1, i));
  }

  function show(e) {
    const i = at(e.clientX);
    if (i < 0) return;
    const v = values[i];
    focus.setAttribute('opacity', 1);
    focus.querySelector('.chart-crosshair').setAttribute('x1', x(i));
    focus.querySelector('.chart-crosshair').setAttribute('x2', x(i));

    if (v === null || !Number.isFinite(v)) {
      dot.setAttribute('opacity', 0);
    } else {
      dot.setAttribute('opacity', 1);
      dot.setAttribute('cx', x(i));
      dot.setAttribute('cy', y(v));
    }

    tip.hidden = false;
    tip.innerHTML = '<b>' + (v === null || !Number.isFinite(v) ? '—' : format(v)) +
                    '</b><span>' + shortDate(dates[i]) + '</span>';

    /* Keep the tooltip inside the card rather than letting it hang off an edge. */
    const box = host.getBoundingClientRect();
    const left = ((x(i) / W) * box.width);
    tip.style.left = Math.max(4, Math.min(box.width - tip.offsetWidth - 4,
                                          left - tip.offsetWidth / 2)) + 'px';
  }

  function hide() {
    focus.setAttribute('opacity', 0);
    tip.hidden = true;
  }

  hit.addEventListener('mousemove', show);
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('touchstart', e => { if (e.touches[0]) show(e.touches[0]); }, { passive: true });
  hit.addEventListener('touchmove',  e => { if (e.touches[0]) show(e.touches[0]); }, { passive: true });
  hit.addEventListener('touchend', hide);
}

/**
 * A sparkline: the same data, no axes, for the summary cards.
 *
 * Deliberately unlabelled — it shows shape, and the number above it carries the
 * value. Anything more would compete with the figure it sits under.
 */
export function sparkline(host, values, colour) {
  host.textContent = '';
  const real = values.filter(v => v !== null && Number.isFinite(v));
  if (real.length < 2) return;

  const W = 120, H = 30;
  const min = Math.min(...real), max = Math.max(...real);
  const span = (max - min) || 1;
  const x = i => (i / (values.length - 1)) * W;
  const y = v => H - 2 - ((v - min) / span) * (H - 4);

  const svg = el('svg', {
    viewBox: '0 0 ' + W + ' ' + H, class: 'spark-svg',
    preserveAspectRatio: 'none', 'aria-hidden': 'true'
  }, host);

  const pts = [];
  values.forEach((v, i) => {
    if (v !== null && Number.isFinite(v)) pts.push(x(i) + ',' + y(v));
  });
  if (pts.length > 1) {
    el('path', { class: 'spark-line', stroke: colour || '#0866FF', fill: 'none',
                 d: 'M' + pts.join('L') }, svg);
  }
}
