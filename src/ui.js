// Tiny DOM toolkit: hyperscript, icons, bottom sheets, toasts.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon', 'g', 'text', 'tspan', 'defs', 'clipPath', 'title']);

export function h(tag, props, ...kids) {
  const isSvg = SVG_TAGS.has(tag);
  const el = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.setAttribute('class', Array.isArray(v) ? v.filter(Boolean).join(' ') : v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value' && !isSvg) el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') { if (v) el.setAttribute(k, ''); el[k] = !!v; }
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}
function add(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) add(el, k);
    else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

const P = {
  today: 'M4 9v6M7 6v12M17 6v12M20 9v6M7 12h10',
  plan: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM4 10h16M8 3v4M16 3v4',
  body: 'M12 4.6a1.9 1.9 0 1 0 0-.1M7 9.5c1.6-.9 3.3-1.3 5-1.3s3.4.4 5 1.3M9.2 9.2l.6 6-.8 5.3M14.8 9.2l-.6 6 .8 5.3M9.8 15.2h4.4',
  chart: 'M4 20V10M10 20V4M16 20v-7M21 20H3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  left: 'M15 5l-7 7 7 7', right: 'M9 5l7 7-7 7', down: 'M5 9l7 7 7-7', up: 'M5 15l7-7 7 7',
  trash: 'M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4',
  timer: 'M12 8v5l3 2M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM9 2h6',
  warn: 'M12 4l9 16H3L12 4zM12 10v4M12 17h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
  star: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5-4.9-2.6-4.9 2.6.9-5.5-4-3.9 5.5-.8L12 4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  cloud: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6 9.5 4.3 4.3 0 0 0 7 18z',
  run: 'M13.5 5.5a1.5 1.5 0 1 0 0-.1M6 20l3-5 3 2 1-5-3-2 3-3 3 3 3 1M9 9l-3 3',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6l1-7z',
  swap: 'M7 7h13l-3-3M17 17H4l3 3',
  copy: 'M9 9h10v11H9zM5 15V4h10',
  dl: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  ul: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1.2V4h-4v2.8L9 8 7 7 5 11l2 1v0l-2 1 2 4 2-1 2 1.2V20h4v-2.8l2-1.2 2 1 2-4-2-1z',
  layers: 'M12 4l9 5-9 5-9-5 9-5zM3 14l9 5 9-5',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4zM5 17a3 3 0 0 1 3-3h11',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  play: 'M7 5l12 7-12 7V5z',
  dots: 'M12 5h.01M12 12h.01M12 19h.01',
  move: 'M5 9l-2 3 2 3M19 9l2 3-2 3M3 12h18',
};
export function icon(name, size) {
  const s = h('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true', class: 'ic' }, h('path', { d: P[name] || P.info }));
  if (size) { s.style.width = size + 'px'; s.style.height = size + 'px'; }
  if (name === 'more' || name === 'dots') s.style.strokeWidth = 3;
  return s;
}
export function iconBtn(name, label, onClick, cls = '') {
  return h('button', { class: 'iconbtn ' + cls, 'aria-label': label, title: label, onClick }, icon(name));
}

// ---------- sheets
const stack = [];
export function sheet({ title, body, footer, onClose, wide }) {
  const close = (result) => {
    const i = stack.indexOf(api); if (i >= 0) stack.splice(i, 1);
    scrim.remove();
    document.removeEventListener('keydown', onKey);
    if (onClose) onClose(result);
  };
  const onKey = e => { if (e.key === 'Escape' && stack[stack.length - 1] === api) close(); };
  const sb = h('div', { class: 'sb' });
  const sf = footer ? h('div', { class: 'sf' }) : null;
  const titleEl = h('h2', null, title || '');
  const box = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', style: wide ? { maxWidth: '820px' } : null },
    h('div', { class: 'sh' }, titleEl, iconBtn('x', 'Close', () => close())), sb, sf);
  const scrim = h('div', { class: 'scrim', onMousedown: e => { if (e.target === scrim) close(); } }, box);
  const api = {
    close, el: box, body: sb,
    setTitle: t => { titleEl.textContent = t; },
    render() {
      const top = sb.scrollTop;
      sb.replaceChildren(); add(sb, [typeof body === 'function' ? body(api) : body]);
      if (sf) { sf.replaceChildren(); add(sf, [typeof footer === 'function' ? footer(api) : footer]); }
      sb.scrollTop = top;
    },
  };
  api.render();
  document.body.appendChild(scrim);
  document.addEventListener('keydown', onKey);
  stack.push(api);
  return api;
}
export function closeAllSheets() { while (stack.length) stack[stack.length - 1].close(); }
export function sheetOpen() { return stack.length > 0; }

export function confirmSheet(title, text, okLabel = 'OK', danger = false) {
  return new Promise(res => {
    let done = false;
    const s = sheet({
      title, body: h('p', { class: 'dim', style: { fontSize: '15px' } }, text),
      footer: api => [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'),
        h('button', { class: 'btn primary' + (danger ? ' danger' : ''), style: danger ? { background: 'var(--danger)', color: '#fff' } : null, onClick: () => { done = true; api.close(); } }, okLabel)],
      onClose: () => res(done),
    });
    return s;
  });
}

let toastEl = null, toastT = 0;
export function toast(msg, action) {
  if (toastEl) toastEl.remove();
  clearTimeout(toastT);
  toastEl = h('div', { class: 'toast', role: 'status' }, h('span', null, msg), action ? h('button', { onClick: () => { action.fn(); toastEl?.remove(); } }, action.label) : null);
  document.body.appendChild(toastEl);
  toastT = setTimeout(() => { toastEl?.remove(); toastEl = null; }, action ? 6000 : 2600);
}

export function field(label, input, hint) {
  return h('div', null, label ? h('label', { class: 'f' }, label) : null, input, hint ? h('div', { class: 'note tiny', style: { margin: '5px 2px 0' } }, hint) : null);
}
export function toggle(on, onChange, label) {
  const b = h('button', { class: 'switch' + (on ? ' on' : ''), role: 'switch', 'aria-checked': String(!!on), 'aria-label': label || 'Toggle', onClick: () => { on = !on; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); onChange(on); } });
  return b;
}
export function seg(options, value, onChange) {
  const el = h('div', { class: 'seg', role: 'tablist' });
  const draw = () => { el.replaceChildren(...options.map(o => h('button', { class: o.id === value ? 'on' : '', role: 'tab', 'aria-selected': String(o.id === value), onClick: () => { value = o.id; draw(); onChange(o.id); } }, o.name))); };
  draw();
  return el;
}
export function numInput(value, onInput, attrs = {}) {
  const el = h('input', { type: 'text', inputmode: attrs.int ? 'numeric' : 'decimal', autocomplete: 'off', enterkeyhint: 'done', value: value ?? '', ...attrs,
    onFocus: e => { try { e.target.select(); } catch { /* ignore */ } },
    onInput: e => { const raw = e.target.value.replace(',', '.'); const n = raw === '' ? null : parseFloat(raw); onInput(isNaN(n) ? null : n, e.target); },
    onKeydown: e => { if (e.key === 'Enter') e.target.blur(); } });
  return el;
}
