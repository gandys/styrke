// Getting data in: Notion exports (xlsx or csv), planned sessions (from Claude or any tool), backups.

import { LIBRARY, LIB } from './library.js';
import { getEx, allExercises } from './model.js';
import { state, commit, touch } from './store.js';
import { presetItems } from './planner.js';
import { norm, num, parseCsv, ymd, uid, addDays } from './util.js';

// ---------- minimal .xlsx reader (zip + sheet xml), no dependencies
async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file.');
  const n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const td = new TextDecoder();
  for (let i = 0; i < n; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    const lnl = dv.getUint16(off + 26, true), lel = dv.getUint16(off + 28, true);
    const start = off + 30 + lnl + lel;
    files[name] = { method, data: u8.subarray(start, start + csize) };
    p += 46 + nl + el + cl;
  }
  return {
    has: name => !!files[name],
    names: () => Object.keys(files),
    async text(name) {
      const f = files[name]; if (!f) return null;
      const raw = f.method === 0 ? f.data : await inflateRaw(f.data);
      return td.decode(raw);
    },
  };
}

const xmlDecode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&#x([0-9a-f]+);/gi, (_, d) => String.fromCodePoint(parseInt(d, 16))).replace(/&amp;/g, '&');

function colIndex(ref) {
  let n = 0;
  for (const ch of ref) { const c = ch.charCodeAt(0); if (c >= 65 && c <= 90) n = n * 26 + (c - 64); else break; }
  return n - 1;
}

export async function readXlsx(buf) {
  const zip = await unzip(buf);
  const shared = [];
  const sst = await zip.text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) shared.push(xmlDecode([...m[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(t => t[1]).join('')));
  const sheetName = zip.names().filter(n => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => parseInt(a.match(/(\d+)\.xml/)[1]) - parseInt(b.match(/(\d+)\.xml/)[1]))[0];
  const xml = await zip.text(sheetName);
  if (!xml) throw new Error('No worksheet found in the file.');
  const rows = [];
  for (const rm of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || '';
      const ref = (attrs.match(/\br="([A-Z]+)\d+"/) || [])[1];
      const t = (attrs.match(/\bt="(\w+)"/) || [])[1];
      const idx = ref ? colIndex(ref) : row.length;
      let v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = xmlDecode([...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else if (t === 'str') val = xmlDecode(v || '');
      else if (v != null && v !== '') val = Number(v);
      row[idx] = val;
    }
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    rows.push(row);
  }
  return rows;
}

function excelDate(serial) {
  const ms = Math.round((serial - 25569) * 86400000);
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function toDate(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 20000 && v < 90000 ? excelDate(v) : null;
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const t = Date.parse(s.replace(/\s*→.*$/, ''));
  return isNaN(t) ? null : ymd(new Date(t));
}

// ---------- exercise name resolution
export function resolveExercise(name, { create = true, kind = 'strength' } = {}) {
  const n = norm(name);
  if (!n) return null;
  const mine = id => { if (!state.ex[id]?.mine) state.ex[id] = touch({ ...(state.ex[id] || { id }), mine: true }); return id; };
  for (const e of allExercises(state)) if (norm(e.name) === n) return mine(e.id);
  for (const u of Object.values(state.ex)) if (!u.deleted && (u.importNames || []).some(a => norm(a) === n)) return mine(u.id);
  let hit = LIBRARY.find(e => norm(e.name) === n) || LIBRARY.find(e => (e.alias || []).some(a => norm(a) === n));
  if (hit) {
    const u = state.ex[hit.id] || { id: hit.id };
    if (!u.name && norm(hit.name) !== n && !(u.importNames || []).length) u.name = name.trim();
    u.importNames = [...new Set([...(u.importNames || []), name.trim()])];
    u.mine = true; touch(u); state.ex[hit.id] = u;
    return hit.id;
  }
  if (!create) return null;
  const id = 'c_' + n.replace(/\s+/g, '_').slice(0, 30) + '_' + uid().slice(-3);
  state.ex[id] = touch({ id, name: name.trim(), kind, equip: 'other', mech: 'isolation', muscles: {}, joints: {}, cost: 1, repLo: 8, repHi: 12, rest: 90, custom: true, mine: true, needsSetup: true, rate: 0.7 });
  return id;
}

const CARDIO_WORDS = [
  [/treadmill|tredem|cinta/, 'treadmill_run'], [/bici|bike|sykkel|cycling|spinning/, 'bike'], [/correr|run|løp|lop|jog/, 'run'],
  [/boulder|klatr|climb|escal/, 'climbing'], [/swim|nadar|svøm/, 'swim'], [/ski|langrenn/, 'xc_ski'], [/tur\b|hike|fjell|senderismo/, 'hike'], [/walk|caminar|gåtur/, 'walk'], [/row|remo/, 'row_erg'],
];
export function parseCardioNote(note, fallbackEx) {
  const s = String(note || '').toLowerCase();
  let ex = fallbackEx;
  for (const [re, id] of CARDIO_WORDS) if (re.test(s)) { ex = id; break; }
  let min = 0;
  const h = s.match(/(\d+(?:[.,]\d+)?)\s*h(?![a-z])/); if (h) min += parseFloat(h[1].replace(',', '.')) * 60;
  const m = s.match(/(\d+)\s*min/); if (m) min += parseInt(m[1]);
  const hm = s.match(/(\d+)\s*h\s*(\d{1,2})(?!\s*min|\d)/); if (hm && !m) min = parseInt(hm[1]) * 60 + parseInt(hm[2]);
  const k = s.match(/(\d+(?:[.,]\d+)?)\s*km/);
  return { ex, min: Math.round(min), km: k ? parseFloat(k[1].replace(',', '.')) : 0 };
}

// ---------- Notion "Exercises" database (one row per set)
export function importSetRows(rows) {
  if (!rows.length) throw new Error('The file is empty.');
  const head = rows[0].map(h => norm(h));
  const col = (...names) => { for (const nm of names) { const i = head.indexOf(nm); if (i >= 0) return i; } return -1; };
  const cEx = col('exercise', 'name', 'ejercicio', 'ovelse'), cDate = col('date', 'fecha', 'dato'), cW = col('weight', 'weight kg', 'peso', 'vekt', 'kg'), cR = col('reps', 'repetitions', 'repeticiones'), cNote = col('notes', 'note', 'notas'), cId = col('id');
  if (cEx < 0 || cDate < 0) throw new Error('Could not find "Exercise" and "Date" columns in the first row.');
  const recs = [];
  rows.slice(1).forEach((r, i) => {
    const date = toDate(r[cDate]); const name = String(r[cEx] ?? '').trim();
    if (!date || !name) return;
    recs.push({ date, name, w: num(cW >= 0 ? r[cW] : null) || 0, r: num(cR >= 0 ? r[cR] : null), note: cNote >= 0 ? String(r[cNote] ?? '').trim() : '', id: cId >= 0 ? (num(r[cId]) ?? i) : i });
  });
  recs.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id);
  const byDate = new Map();
  for (const r of recs) { if (!byDate.has(r.date)) byDate.set(r.date, []); byDate.get(r.date).push(r); }
  const exCache = new Map();
  let nSets = 0, nCardio = 0, skipped = 0, keptEdited = 0;
  const created = new Set();
  const before = new Set(Object.keys(state.ex));
  for (const [date, list] of byDate) {
    const sid = 'imp-' + date;
    if (state.sessions[sid]?.edited) { keptEdited++; continue; }   // you changed this day in the app: leave it alone
    const items = []; const byEx = new Map();
    for (const r of list) {
      if (!exCache.has(r.name)) exCache.set(r.name, resolveExercise(r.name));
      const exId = exCache.get(r.name); const ex = getEx(state, exId);
      const isCardio = ex?.kind === 'cardio' || (!r.w && !r.r && r.note && !/dropset/i.test(r.note));
      if (isCardio) {
        const fb = ex?.kind === 'cardio' ? exId : 'cardio_other';
        const c = parseCardioNote(r.note, fb);
        const cx = getEx(state, c.ex) || getEx(state, fb);
        if (state.ex[c.ex]?.mine !== true) { state.ex[c.ex] = touch({ ...(state.ex[c.ex] || { id: c.ex }), mine: true }); }
        const min = c.min || (cx.id === 'hike' ? 180 : cx.id === 'climbing' ? 60 : 30);
        items.push({ id: uid('i'), k: 'cardio', ex: cx.id, min, km: c.km || undefined, rpe: 4, note: r.note + (c.min ? '' : ' (duration estimated)'), d: true });
        nCardio++; continue;
      }
      if (!(r.r > 0)) { skipped++; continue; }
      let it = byEx.get(exId);
      if (!it) { it = { id: uid('i'), k: 'ex', ex: exId, sets: [] }; byEx.set(exId, it); items.push(it); }
      const set = { w: r.w, r: r.r, d: true };
      if (/dropset/i.test(r.note)) set.f = 'd';
      it.sets.push(set); nSets++;
    }
    if (!items.length) continue;
    state.sessions[sid] = touch({ id: sid, date, items, imported: true });
  }
  for (const id of Object.keys(state.ex)) if (!before.has(id) && state.ex[id].custom) created.add(state.ex[id].name);
  commit('import');
  return { days: byDate.size - keptEdited, sets: nSets, cardio: nCardio, skipped, keptEdited, created: [...created], from: recs[0]?.date, to: recs[recs.length - 1]?.date };
}

export async function importFile(file) {
  const name = (file.name || '').toLowerCase();
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf.slice(0, 2));
  // Android's file picker does not always pass a file name, so recognise .xlsx by its zip signature
  if (name.endsWith('.xlsx') || (head[0] === 0x50 && head[1] === 0x4b)) return { kind: 'sets', ...importSetRows(await readXlsx(buf)) };
  const text = new TextDecoder().decode(buf);
  if (name.endsWith('.json') || /^\s*\{/.test(text)) {
    const obj = JSON.parse(text);
    if (obj.styrke === 'plan') return { kind: 'plan', ...importPlan(obj) };
    if (obj.app === 'styrke') return { kind: 'backup', obj };
    throw new Error('This JSON file is neither a Styrke backup nor a Styrke plan.');
  }
  return { kind: 'sets', ...importSetRows(parseCsv(text)) };
}

// ---------- planned sessions (the format Claude writes; see docs/CLAUDE_SYNC.md)
const KIND_EX = { run: 'run', treadmill: 'treadmill_run', bike: 'bike', hike: 'hike', swim: 'swim', walk: 'walk', ski: 'xc_ski', row: 'row_erg', climb: 'climbing', cardio: 'cardio_other' };
const TYPE_IDS = ['auto', 'upper', 'lower', 'full', 'push', 'pull', 'legs', 'arms', 'core', 'cardio', 'custom', 'rest'];

export function importPlan(obj) {
  if (!obj || !Array.isArray(obj.sessions)) throw new Error('Plan file needs a "sessions" list.');
  const source = String(obj.source || 'import');
  let removed = 0, added = 0, madePresets = 0; const dates = new Set(); const missing = new Set();
  const findPreset = name => Object.values(state.presets).find(p => !p.deleted && norm(p.name) === norm(name));
  // presets defined in the file: created, or replaced when one with the same name exists
  for (const def of obj.presets || []) {
    if (!def?.name || !Array.isArray(def.items)) continue;
    const items = [];
    for (const it of def.items) {
      const kind = String(it.kind || '').toLowerCase();
      if (it.block) { const b = Object.values(state.blocks).find(b => !b.deleted && norm(b.name) === norm(it.block)); if (b) items.push({ k: 'block', block: b.id, rounds: num(it.rounds) || b.rounds }); }
      else if (kind && kind !== 'strength') {
        let exId = KIND_EX[kind] || (it.activity ? resolveExercise(it.activity, { kind: 'cardio' }) : 'cardio_other');
        if (!state.ex[exId]?.mine) state.ex[exId] = touch({ ...(state.ex[exId] || { id: exId }), mine: true });
        items.push({ k: 'cardio', ex: exId, min: num(it.minutes) || 30, km: num(it.km) || undefined, rpe: num(it.effort) || 4, ...(it.name ? { name: it.name } : {}) });
      } else if (it.exercise || it.name) { const exId = resolveExercise(it.exercise || it.name); if (exId) items.push({ k: 'ex', ex: exId, sets: num(it.sets) || 3 }); }
    }
    if (!items.length) continue;
    const old = findPreset(def.name);
    const rec = touch({ id: old?.id || uid('p'), name: String(def.name).trim(), items, plan: old?.plan ?? true });
    state.presets[rec.id] = rec; madePresets++;
  }
  if (obj.replace && obj.replace.from && obj.replace.to) {
    for (const pd of Object.values(state.plan)) {
      if (pd.deleted || pd.date < obj.replace.from || pd.date > obj.replace.to) continue;
      const keep = (pd.items || []).filter(it => !(it.src === 'import' && (it.source || 'import') === source));
      if (keep.length !== (pd.items || []).length) { removed += (pd.items || []).length - keep.length; pd.items = keep; touch(pd); }
    }
  }
  for (const s of obj.sessions) {
    const date = toDate(s.date); if (!date) continue;
    if (String(s.kind || '').toLowerCase() === 'rest') continue;   // a rest day is simply a day that is not committed
    const pd = state.plan[date] && !state.plan[date].deleted ? state.plan[date] : { date, on: true, type: 'auto', items: [] };
    pd.on = true; pd.items = pd.items || [];
    const kind = String(s.kind || 'strength').toLowerCase();
    if (kind === 'strength') {
      if (s.type && TYPE_IDS.includes(s.type)) pd.type = s.type;
      // one or several presets on the day, e.g. "presets": ["Easy run", "Lower", "Hip 3"]
      const names = [].concat(s.presets || [], s.preset || []);
      for (const nm of names) { const p = findPreset(nm); if (!p) { missing.add(String(nm)); continue; } const its = presetItems(state, p, 'import', { source }); pd.items.push(...its); added += its.length; }
      if (names.length && (pd.type || 'auto') === 'auto' && !s.type) pd.type = 'custom';
      for (const it of s.items || []) {
        const exId = resolveExercise(it.exercise || it.name); if (!exId) continue;
        const reps = String(it.reps || '').match(/(\d+)\s*[-–]\s*(\d+)/);
        pd.items.push({ id: uid('i'), k: 'ex', ex: exId, sets: it.sets || 3, repLo: reps ? +reps[1] : (num(it.reps) || undefined), repHi: reps ? +reps[2] : (num(it.reps) || undefined), note: it.note, src: 'import', source });
        added++;
      }
      if (s.note && !(s.items || []).length) pd.note = [pd.note, s.note].filter(Boolean).join(' / ');
      if (s.minutes && !(s.items || []).length) pd.minutes = s.minutes;
    } else {
      let exId = KIND_EX[kind];
      if (!exId && s.activity) exId = resolveExercise(s.activity, { kind: 'cardio' });
      if (!exId) exId = 'cardio_other';
      if (!state.ex[exId]?.mine) state.ex[exId] = touch({ ...(state.ex[exId] || { id: exId }), mine: true });
      pd.items.push({ id: uid('i'), k: 'cardio', ex: exId, name: s.name, min: num(s.minutes) || undefined, km: num(s.km) || undefined, rpe: num(s.effort) || 4, note: s.note, src: 'import', source });
      added++;
    }
    touch(pd); state.plan[date] = pd; dates.add(date);
  }
  commit('import');
  const sorted = [...dates].sort();
  return { added, removed, days: dates.size, from: sorted[0], to: sorted[sorted.length - 1], source, presets: madePresets, missing: [...missing] };
}

/** A small, valid example of the plan format, shown in the app and docs. */
export function examplePlan(today = ymd()) {
  return {
    styrke: 'plan', source: 'marathon',
    replace: { from: today, to: addDays(today, 6) },
    sessions: [
      { date: addDays(today, 1), kind: 'run', name: 'Easy run', minutes: 35, effort: 3, note: 'Talk-test pace' },
      { date: addDays(today, 3), kind: 'run', name: 'Easy run + strides', minutes: 30, effort: 4 },
      { date: addDays(today, 5), kind: 'run', name: 'Long run', minutes: 60, effort: 4 },
      { date: addDays(today, 2), kind: 'strength', type: 'pull' },
    ],
  };
}

export { LIB };
