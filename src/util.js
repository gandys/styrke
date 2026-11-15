// Small shared helpers: dates, ids, numbers.

export const DAY = 86400000;

export function uid(prefix = '') {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function pad(n) { return String(n).padStart(2, '0'); }

/** Local date -> 'YYYY-MM-DD' */
export function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 'YYYY-MM-DD' -> local Date at noon (noon avoids DST edge cases) */
export function parseYmd(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(s, n) {
  const d = parseYmd(s);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

export function diffDays(a, b) {
  return Math.round((parseYmd(a) - parseYmd(b)) / DAY);
}

/** Monday of the week containing date s */
export function weekStart(s) {
  const d = parseYmd(s);
  const dow = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - dow);
  return ymd(d);
}

export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const MONTHS_SHORT = MONTHS.map(m => m.slice(0, 3));

export function dowIndex(s) { return (parseYmd(s).getDay() + 6) % 7; }

export function fmtDate(s, opts = {}) {
  const d = parseYmd(s);
  const base = `${DOW_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
  return opts.year ? `${base} ${d.getFullYear()}` : base;
}

export function relDay(s, today = ymd()) {
  const n = diffDays(s, today);
  if (n === 0) return 'Today';
  if (n === -1) return 'Yesterday';
  if (n === 1) return 'Tomorrow';
  return fmtDate(s);
}

export function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }

export function round(x, dp = 0) {
  const k = 10 ** dp;
  return Math.round(x * k) / k;
}

/** Compact number for display: 12 345 -> "12.3k" */
export function fmtNum(x, dp = 0) {
  if (x == null || isNaN(x)) return '–';
  const a = Math.abs(x);
  if (a >= 100000) return round(x / 1000, 0) + 'k';
  if (a >= 10000) return round(x / 1000, 1) + 'k';
  return String(round(x, dp));
}

/** Weight display: trims trailing zeros, max 2 dp */
export function fmtW(x) {
  if (x == null || x === '' || isNaN(x)) return '';
  return String(round(Number(x), 2));
}

export function num(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'));
  return isNaN(n) ? null : n;
}

export function sum(arr, f = x => x) { let s = 0; for (const x of arr) s += f(x) || 0; return s; }

export function groupBy(arr, f) {
  const m = new Map();
  for (const x of arr) { const k = f(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return m;
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => { t = null; fn(...a); }, ms); };
  /** Run now, but only if a call is waiting. */
  d.flush = (...a) => { if (t == null) return; clearTimeout(t); t = null; fn(...a); };
  return d;
}

export function fmtMin(min) {
  if (min == null) return '–';
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function fmtDur(sec) {
  sec = Math.max(0, Math.round(sec));
  return `${Math.floor(sec / 60)}:${pad(sec % 60)}`;
}

export function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function toCsv(rows) {
  return rows.map(r => r.map(csvEscape).join(',')).join('\n') + '\n';
}

/** Tolerant CSV parser (comma or semicolon, quoted fields). Returns array of arrays. */
export function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delim = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
  const rows = [];
  let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ''));
}

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
