// Stylised front/back figure. Each muscle is its own shape, coloured by load; joints are dots.

import { h } from './ui.js';
import { MUSCLE, JOINT } from './library.js';

// Shapes are drawn for the figure's right-hand half (x >= 100) and mirrored.
const FRONT = {
  traps: 'M106,50 Q113,58 128,62 L108,64 Z',
  front_delt: 'M129,64 Q140,62 146,71 Q147,84 141,95 Q134,88 131,76 Z',
  side_delt: 'M147,71 Q155,76 155,90 Q153,99 148,101 Q147,90 148,84 Z',
  chest: 'M101,66 L126,66 Q132,78 130,96 Q118,106 101,102 Z',
  biceps: 'M142,98 Q150,96 154,106 Q157,122 153,136 Q147,140 143,134 Q139,116 142,98 Z',
  forearms: 'M146,146 Q154,142 159,150 Q164,172 163,192 L155,194 Q148,170 146,146 Z',
  abs: 'M101,106 Q112,108 117,105 L116,150 Q114,176 101,186 Z',
  obliques: 'M119,105 Q126,104 130,100 Q131,130 126,152 Q124,168 126,180 L118,176 Q118,150 119,105 Z',
  abductors: 'M127,184 Q134,190 135,204 L128,212 Q124,198 127,184 Z',
  adductors: 'M101,216 Q107,218 111,214 Q112,250 106,282 L101,264 Z',
  quads: 'M114,214 Q128,216 135,207 Q141,242 135,296 Q124,304 113,298 Q108,262 114,214 Z',
  calves: 'M112,316 Q122,311 132,317 Q134,352 128,390 L116,390 Q110,352 112,316 Z',
};
const BACK = {
  traps: 'M101,46 L107,50 Q116,60 130,64 Q118,70 110,84 L101,112 Z',
  rear_delt: 'M131,65 Q147,63 153,78 Q152,92 146,99 Q138,88 131,65 Z',
  upper_back: 'M112,84 Q120,72 130,67 Q138,84 143,99 Q135,109 126,112 L104,114 Z',
  lats: 'M101,117 L126,115 Q136,110 142,103 Q142,132 132,158 Q120,174 107,178 L101,162 Z',
  lower_back: 'M101,166 L106,182 Q116,179 124,172 Q122,186 126,198 Q114,204 101,204 Z',
  triceps: 'M143,99 Q151,97 155,107 Q158,122 154,137 Q148,141 144,135 Q140,116 143,99 Z',
  forearms: 'M146,146 Q154,142 159,150 Q164,172 163,192 L155,194 Q148,170 146,146 Z',
  abductors: 'M125,184 Q134,187 137,206 Q131,199 125,199 Z',
  glutes: 'M101,207 Q116,206 126,201 Q138,214 135,236 Q120,246 101,243 Z',
  hamstrings: 'M104,247 Q120,251 135,241 Q139,270 133,300 Q122,306 112,302 Q106,276 104,247 Z',
  calves: 'M111,314 Q122,306 133,314 Q137,340 130,366 Q126,378 126,392 L117,392 Q117,378 113,366 Q107,340 111,314 Z',
};
const JF = { shoulder: [139, 66], elbow: [151, 142], wrist: [160, 198], hip: [121, 203], knee: [123, 306] };
const JB = { lower_spine: [100, 188, true], achilles: [121, 402] };

function hexToRgb(hex) {
  hex = hex.trim().replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const n = parseInt(hex, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
let rampCache = null;
export function rampColors() {
  const cs = getComputedStyle(document.documentElement);
  const key = cs.getPropertyValue('--l0') + cs.getPropertyValue('--l4');
  if (rampCache && rampCache.key === key) return rampCache.stops;
  const stops = ['--l0', '--l1', '--l2', '--l3', '--l4'].map(v => hexToRgb(cs.getPropertyValue(v) || '#888888'));
  rampCache = { key, stops };
  return stops;
}
const POS = [0, 0.3, 0.55, 0.78, 1];
/** Load fraction (0..1+) -> colour on the load ramp. */
export function loadColor(frac) {
  const stops = rampColors();
  const f = Math.max(0, Math.min(1, frac || 0));
  let i = 0;
  while (i < POS.length - 2 && f > POS[i + 1]) i++;
  const t = (f - POS[i]) / (POS[i + 1] - POS[i]);
  const a = stops[i], b = stops[i + 1];
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * Math.max(0, Math.min(1, t))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function baseFigure() {
  const g = h('g', { class: 'base' });
  const half = () => [
    h('path', { d: 'M100,56 Q116,56 130,62 Q142,64 150,72 Q158,80 157,100 L160,138 Q166,170 166,196 Q168,212 162,220 Q154,222 153,208 L146,150 L139,112 Q138,150 132,176 Q134,196 138,210 Q144,250 137,300 Q138,330 135,352 Q130,380 129,398 Q134,410 132,416 L112,416 Q112,400 114,392 Q106,350 110,306 Q104,270 100,222 Z' }),
  ];
  g.appendChild(h('ellipse', { cx: 100, cy: 28, rx: 14.5, ry: 17 }));
  g.appendChild(h('path', { d: 'M92,40 L108,40 L108,58 L92,58 Z' }));
  for (const el of half()) g.appendChild(el);
  const m = h('g', { transform: 'translate(200,0) scale(-1,1)' }, half());
  g.appendChild(m);
  return g;
}

function figure(shapes, jointPos, data, side) {
  const svg = h('svg', { viewBox: '28 6 144 416', class: 'bodymap', role: 'img', 'aria-label': side + ' of the body, coloured by load' });
  svg.appendChild(baseFigure());
  const mk = (id, d, mirror) => {
    const frac = data.muscles?.[id] ?? 0;
    const p = h('path', { d, class: 'm' + (data.selected === id ? ' sel' : ''), fill: loadColor(frac), 'data-id': id, tabindex: '0', role: 'button', 'aria-label': `${MUSCLE[id].name}: ${Math.round(Math.min(frac, 1.5) * 100)}% load`,
      onClick: () => data.onPick && data.onPick('muscle', id),
      onKeydown: e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); data.onPick && data.onPick('muscle', id); } } });
    if (mirror) p.setAttribute('transform', 'translate(200,0) scale(-1,1)');
    p.appendChild(h('title', null, MUSCLE[id].name));
    return p;
  };
  for (const [id, d] of Object.entries(shapes)) { svg.appendChild(mk(id, d, false)); svg.appendChild(mk(id, d, true)); }
  if (data.showJoints !== false) {
    const jm = (id, x, y) => {
      const frac = data.joints?.[id] ?? 0;
      const pain = data.pain?.[id];
      const g = h('g', { class: 'jg', onClick: () => data.onPick && data.onPick('joint', id), style: { cursor: 'pointer' } });
      if (pain) g.appendChild(h('circle', { cx: x, cy: y, r: 10.5, class: 'jp' }));
      g.appendChild(h('circle', { cx: x, cy: y, r: pain ? 7.5 : 5.5, class: 'j', fill: pain ? 'var(--pain)' : loadColor(frac) }, h('title', null, JOINT[id].name)));
      if (pain) g.appendChild(h('text', { x, y: y + 3.8, class: 'jt' }, String(pain)));
      return g;
    };
    for (const [id, [x, y, single]] of Object.entries(jointPos)) {
      svg.appendChild(jm(id, x, y));
      if (!single) svg.appendChild(jm(id, 200 - x, y));
    }
  }
  return svg;
}

/** data: { muscles:{id:frac}, joints:{id:frac}, pain:{id:level}, onPick(kind,id), selected } */
export function bodyMap(data) {
  return h('div', { class: 'bodywrap' },
    h('figure', null, figure(FRONT, JF, data, 'Front'), h('figcaption', null, 'Front')),
    h('figure', null, figure(BACK, JB, data, 'Back'), h('figcaption', null, 'Back')));
}
