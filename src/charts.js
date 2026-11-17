// Small SVG charts: lines and stacked bars with a hover/tap tooltip. One y-axis, thin marks,
// recessive grid, legend for two or more series.

import { h } from './ui.js';
import { fmtNum } from './util.js';

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 4 ? 4 : n <= 5 ? 5 : n <= 8 ? 8 : 10;
  return m * p;
}

function mount(draw) {
  const el = h('div', { class: 'chart' });
  let w = 0;
  const run = () => { const nw = el.clientWidth; if (nw && nw !== w) { w = nw; draw(el, w); } };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(run).observe(el);
  requestAnimationFrame(run);
  return el;
}

export function legend(items) {
  return h('div', { class: 'legend' }, items.map(i => h('span', null, h('i', { style: { background: i.color, ...(i.dash ? { height: '3px', borderRadius: '2px', verticalAlign: '3px' } : {}) } }), i.name)));
}

function tipBox(el) {
  const tip = h('div', { class: 'tip hide' });
  el.appendChild(tip);
  return {
    show(x, html, w) { tip.innerHTML = html; tip.classList.remove('hide'); const tw = tip.offsetWidth; tip.style.left = Math.max(0, Math.min(w - tw, x - tw / 2)) + 'px'; },
    hide() { tip.classList.add('hide'); },
  };
}

/** series: [{name, color, dash, values:[number|null]}], labels: [string] (one per x position) */
export function lineChart({ series, labels, height = 180, fmt = v => fmtNum(v), min0 = true, unit = '' }) {
  return mount((el, W) => {
    el.replaceChildren();
    const H = height, L = 38, R = 8, T = 14, B = 22;
    const all = series.flatMap(s => s.values).filter(v => v != null && !isNaN(v));
    if (!all.length) { el.appendChild(h('div', { class: 'note', style: { padding: '24px 0', textAlign: 'center' } }, 'Not enough data yet.')); return; }
    let lo = min0 ? 0 : Math.min(...all), hi = Math.max(...all);
    if (!min0) { const pad = (hi - lo) * 0.15 || hi * 0.05 || 1; lo = Math.max(0, lo - pad); hi += pad; } else hi = niceMax(hi);
    const n = labels.length;
    const x = i => L + (n === 1 ? (W - L - R) / 2 : (W - L - R) * i / (n - 1));
    const y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (let g = 0; g <= 3; g++) {
      const v = lo + (hi - lo) * g / 3, yy = y(v);
      svg.appendChild(h('line', { class: 'grid', x1: L, x2: W - R, y1: yy, y2: yy, 'stroke-dasharray': g === 0 ? null : '2 4' }));
      svg.appendChild(h('text', { class: 'ax', x: L - 6, y: yy + 4, 'text-anchor': 'end' }, fmt(v)));
    }
    if (unit) svg.appendChild(h('text', { class: 'ax', x: 0, y: 9 }, unit));
    const ticks = n <= 1 ? [0] : n <= 4 ? [...Array(n).keys()] : [0, Math.floor((n - 1) / 2), n - 1];
    for (const i of ticks) svg.appendChild(h('text', { class: 'ax', x: x(i), y: H - 5, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle' }, labels[i]));
    for (const s of series) {
      let d = '', pen = false, last = null;
      s.values.forEach((v, i) => { if (v == null || isNaN(v)) { return; } d += (pen ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(v).toFixed(1); pen = true; last = i; });
      svg.appendChild(h('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'stroke-dasharray': s.dash ? '5 4' : null }));
      const pts = s.values.filter(v => v != null).length;
      if (s.dots === false) continue;
      if (pts <= 24) s.values.forEach((v, i) => { if (v != null) svg.appendChild(h('circle', { cx: x(i), cy: y(v), r: 2.6, fill: s.color })); });
      else if (last != null) svg.appendChild(h('circle', { cx: x(last), cy: y(s.values[last]), r: 4, fill: s.color, stroke: 'var(--panel)', 'stroke-width': 2 }));
    }
    const cross = h('line', { class: 'grid', y1: T, y2: H - B, stroke: 'var(--dim)', style: { display: 'none' } });
    svg.appendChild(cross);
    el.appendChild(svg);
    const tip = tipBox(el);
    const move = e => {
      const r = svg.getBoundingClientRect();
      const px = (e.clientX - r.left);
      const i = Math.max(0, Math.min(n - 1, Math.round((px - L) / ((W - L - R) / Math.max(1, n - 1)))));
      cross.style.display = ''; cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i));
      tip.show(x(i), `<div style="opacity:.7">${labels[i]}</div>` + series.map(s => s.values[i] == null ? '' : `<div><i style="background:${s.color}"></i>${series.length > 1 ? s.name + ' ' : ''}<b>${fmt(s.values[i])}</b>${unit ? ' ' + unit : ''}</div>`).join(''), W);
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { cross.style.display = 'none'; tip.hide(); });
  });
}

/** bars: [{label, segs:[{name,color,v}], note}] */
export function barChart({ bars, height = 170, fmt = v => fmtNum(v), unit = '', marker }) {
  return mount((el, W) => {
    el.replaceChildren();
    const H = height, L = 38, R = 4, T = 14, B = 22;
    const totals = bars.map(b => b.segs.reduce((a, s) => a + (s.v || 0), 0));
    const hi = niceMax(Math.max(...totals, marker || 0, 0));
    if (!totals.some(t => t > 0)) { el.appendChild(h('div', { class: 'note', style: { padding: '24px 0', textAlign: 'center' } }, 'Not enough data yet.')); return; }
    const n = bars.length, slot = (W - L - R) / n, bw = Math.max(3, Math.min(26, slot - 4));
    const y = v => T + (H - T - B) * (1 - v / hi);
    const svg = h('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H });
    for (let g = 0; g <= 3; g++) {
      const v = hi * g / 3, yy = y(v);
      svg.appendChild(h('line', { class: 'grid', x1: L, x2: W - R, y1: yy, y2: yy, 'stroke-dasharray': g === 0 ? null : '2 4' }));
      svg.appendChild(h('text', { class: 'ax', x: L - 6, y: yy + 4, 'text-anchor': 'end' }, fmt(v)));
    }
    if (unit) svg.appendChild(h('text', { class: 'ax', x: 0, y: 9 }, unit));
    const rects = [];
    bars.forEach((b, i) => {
      const cx = L + slot * (i + 0.5);
      let acc = 0;
      const live = b.segs.filter(s => s.v > 0);
      live.forEach((s, k) => {
        const y0 = y(acc), y1 = y(acc + s.v); acc += s.v;
        const gap = k > 0 ? 2 : 0;
        const hh = Math.max(1, y0 - y1 - gap);
        svg.appendChild(h('rect', { x: cx - bw / 2, y: y1, width: bw, height: hh, rx: Math.min(3, bw / 2, hh / 2), fill: s.color }));
      });
      rects.push(cx);
    });
    const step = n <= 8 ? 1 : Math.ceil(n / 6);
    bars.forEach((b, i) => { if (i % step === 0 || i === n - 1) { if (i === n - 1 && (n - 1) % step !== 0 && step > 1 && (n - 1) % step < step / 2) return; svg.appendChild(h('text', { class: 'ax', x: rects[i], y: H - 5, 'text-anchor': 'middle' }, b.label)); } });
    el.appendChild(svg);
    const hl = h('rect', { y: T, width: slot, height: H - T - B, fill: 'var(--text)', opacity: 0.06, style: { display: 'none' } });
    svg.insertBefore(hl, svg.firstChild);
    const tip = tipBox(el);
    const move = e => {
      const r = svg.getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left - L) / slot)));
      hl.style.display = ''; hl.setAttribute('x', L + slot * i);
      const b = bars[i];
      tip.show(rects[i], `<div style="opacity:.7">${b.tip || b.label}</div>` + b.segs.filter(s => s.v > 0).map(s => `<div><i style="background:${s.color}"></i>${b.segs.length > 1 ? s.name + ' ' : ''}<b>${fmt(s.v)}</b>${unit ? ' ' + unit : ''}</div>`).join('') + (b.segs.length > 1 ? `<div style="opacity:.7">Total <b>${fmt(totals[i])}</b></div>` : ''), W);
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { hl.style.display = 'none'; tip.hide(); });
  });
}

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
