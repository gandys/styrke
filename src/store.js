// App state, autosave and merging. Every record carries `u` (last-updated ms) so two
// copies of the data (phone, laptop, cloud) can be merged record by record without loss.

import { STARTER_MINE } from './library.js';
import { DEFAULTS, analyze, getEx } from './model.js';
import { uid, ymd, toCsv, debounce } from './util.js';

const KEY = 'styrke.state.v1';
const LOCAL_KEY = 'styrke.local.v1';
export const COLLECTIONS = ['ex', 'blocks', 'presets', 'sessions', 'plan', 'pain', 'body'];

export const state = blank();
/** Device-only settings (sync credentials, last sync times). Never synced or exported. */
export const local = { github: null, lastSync: 0, lastBackup: '', lastCsv: '', tab: 'today' };

function blank() {
  return { v: 1, _rev: 0, savedAt: 0, settings: { _u: 0 }, ex: {}, blocks: {}, presets: {}, sessions: {}, plan: {}, pain: {}, body: {} };
}

const listeners = new Set();
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) { for (const fn of listeners) { try { fn(reason); } catch (e) { console.error(e); } } }

const hasLS = () => { try { return typeof localStorage !== 'undefined' && !!localStorage; } catch { return false; } };

// ---------- IndexedDB (second copy + daily snapshots)
let idb = null;
function openIdb() {
  return new Promise(res => {
    try {
      if (typeof indexedDB === 'undefined') return res(null);
      const rq = indexedDB.open('styrke', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
      rq.onblocked = () => res(null);
    } catch { res(null); }
  });
}
function idbGet(key) {
  return new Promise(res => {
    if (!idb) return res(null);
    try { const rq = idb.transaction('kv').objectStore('kv').get(key); rq.onsuccess = () => res(rq.result ?? null); rq.onerror = () => res(null); } catch { res(null); }
  });
}
function idbSet(key, val) {
  return new Promise(res => {
    if (!idb) return res(false);
    try { const tx = idb.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => res(true); tx.onerror = () => res(false); } catch { res(false); }
  });
}
function idbKeys() {
  return new Promise(res => {
    if (!idb) return res([]);
    try { const rq = idb.transaction('kv').objectStore('kv').getAllKeys(); rq.onsuccess = () => res(rq.result || []); rq.onerror = () => res([]); } catch { res([]); }
  });
}
function idbDel(key) {
  return new Promise(res => { if (!idb) return res(); try { const tx = idb.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(key); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch { res(); } });
}

export let saveStatus = { ok: true, at: 0, where: '' };

export function serialize(s = state) {
  const o = { v: 1, app: 'styrke', savedAt: Date.now() };
  o.settings = s.settings;
  for (const c of COLLECTIONS) o[c] = s[c];
  return o;
}

function writeNow() {
  const snap = serialize();
  state.savedAt = snap.savedAt;
  const json = JSON.stringify(snap);
  let ok = false; const where = [];
  if (hasLS()) { try { localStorage.setItem(KEY, json); ok = true; where.push('device'); } catch (e) { console.warn('localStorage save failed', e); } }
  if (idb) {
    idbSet('state', json).then(r => { if (r && !ok) { saveStatus = { ok: true, at: Date.now(), where: 'device' }; emit('saved'); } });
    const snapKey = 'snap-' + ymd();
    idbSet(snapKey, json).then(pruneSnaps);
    ok = ok || true;
  }
  saveStatus = { ok, at: Date.now(), where: where.join('+') };
  emit('saved');
}
async function pruneSnaps() {
  const keys = (await idbKeys()).filter(k => String(k).startsWith('snap-')).sort();
  while (keys.length > 7) await idbDel(keys.shift());
}
const saveSoon = debounce(writeNow, 250);
export function flush() { saveSoon.flush(); }

export function saveLocal() { if (hasLS()) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(local)); } catch { /* ignore */ } } }

/** Call after every change to state. Saves (debounced) and tells the UI. */
export function commit(reason = 'change') {
  state._rev++;
  saveSoon();
  emit(reason);
}

export function touch(rec) { rec.u = Date.now(); return rec; }
export function put(coll, rec, reason) { touch(rec); state[coll][rec.id ?? rec.date] = rec; commit(reason || coll); return rec; }
export function del(coll, id, reason) {
  const rec = state[coll][id]; if (!rec) return;
  state[coll][id] = { id: rec.id, date: rec.date, deleted: true, u: Date.now() };
  commit(reason || coll);
}
export function setSetting(key, val) { state.settings[key] = val; state.settings._u = Date.now(); commit('settings'); }

export function adopt(snap) {
  state.settings = snap.settings || { _u: 0 };
  for (const c of COLLECTIONS) state[c] = snap[c] || {};
  state.savedAt = snap.savedAt || 0;
  state._rev++;
}

/** Merge another copy of the data into this one. Newest record wins. Returns true if anything changed locally. */
export function merge(remote) {
  if (!remote || typeof remote !== 'object') return false;
  let changed = false;
  for (const c of COLLECTIONS) {
    const src = remote[c] || {};
    for (const id of Object.keys(src)) {
      const r = src[id], l = state[c][id];
      if (!l || (r.u || 0) > (l.u || 0)) { state[c][id] = r; changed = true; }
    }
  }
  if (remote.settings && (remote.settings._u || 0) > (state.settings._u || 0)) { state.settings = remote.settings; changed = true; }
  if (changed) state._rev++;
  return changed;
}

/** True if this copy has records the other copy lacks or has older. */
export function isAheadOf(remote) {
  if (!remote) return true;
  for (const c of COLLECTIONS) {
    const src = remote[c] || {};
    for (const id of Object.keys(state[c])) if (!src[id] || (state[c][id].u || 0) > (src[id].u || 0)) return true;
  }
  return (state.settings._u || 0) > (remote.settings?._u || 0);
}

function firstRun() {
  const now = Date.now();
  state.settings = { ...state.settings, bodyweight: DEFAULTS.bodyweight, _u: 1 };
  for (const id of STARTER_MINE) state.ex[id] = { id, mine: true, u: 1 };
  state.blocks.b_dumbbell = {
    id: 'b_dumbbell', name: 'Dumbbell circuit', exIds: ['db_fly', 'db_lateral_raise', 'db_curl', 'db_reverse_fly'],
    rounds: 3, rest: 30, restRound: 60, sameWeight: true, plan: true, u: 1,
  };
  state.firstRunAt = now;
}

export async function load() {
  let best = null;
  const consider = json => {
    if (!json) return;
    try { const o = typeof json === 'string' ? JSON.parse(json) : json; if (o && o.app === 'styrke' && (!best || (o.savedAt || 0) > (best.savedAt || 0))) best = o; } catch { /* ignore corrupt copy */ }
  };
  if (hasLS()) { try { consider(localStorage.getItem(KEY)); } catch { /* ignore */ } try { Object.assign(local, JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')); } catch { /* ignore */ } }
  idb = await openIdb();
  consider(await idbGet('state'));
  if (best) adopt(best); else firstRun();
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    // another tab of the app saved: fold its changes in instead of overwriting them later
    window.addEventListener('storage', e => {
      if (e.key !== KEY || !e.newValue) return;
      try { if (merge(JSON.parse(e.newValue))) emit('sync'); } catch { /* ignore */ }
    });
  }
  return !!best;
}

export async function listSnapshots() {
  const keys = (await idbKeys()).filter(k => String(k).startsWith('snap-')).sort().reverse();
  return keys.map(k => String(k).slice(5));
}
export async function restoreSnapshot(date) {
  const json = await idbGet('snap-' + date);
  if (!json) return false;
  adopt(JSON.parse(json)); commit('restore'); return true;
}

// ---------- export
export function exportJson() { return JSON.stringify(serialize(), null, 0); }

export function importJson(obj, mode = 'merge') {
  if (!obj || obj.app !== 'styrke') throw new Error('This is not a Styrke backup file.');
  if (mode === 'replace') { adopt(obj); commit('import'); return true; }
  const ch = merge(obj); commit('import'); return ch;
}

export function exportCsv() {
  const an = analyze(state);
  const setsRows = [['date', 'exercise', 'set', 'weight_kg', 'reps', 'effective_load_kg', 'volume_kg', 'weight_adjusted_volume', 'hard_set', 'zone', 'est_1rm', 'block']];
  const counter = new Map();
  for (const s of an.allSets) {
    const k = s.sid + '|' + s.ex; const n = (counter.get(k) || 0) + 1; counter.set(k, n);
    const ex = getEx(state, s.ex);
    setsRows.push([s.date, ex?.name || s.ex, n, s.w, s.r, r2(s.load), r2(s.vol), r2(s.wav), r2(s.hard), s.zone, r2(s.e1), s.block === true ? 'yes' : (s.block || '')]);
  }
  const cardioRows = [['date', 'activity', 'minutes', 'km', 'effort_1_10', 'note']];
  for (const s of an.sessions) for (const it of s.items || []) if (it.k === 'cardio' && it.d !== false) cardioRows.push([s.date, it.name || getEx(state, it.ex)?.name || it.ex, it.min || '', it.km || '', it.rpe || '', it.note || '']);
  const planRows = [['date', 'type', 'item', 'detail', 'source']];
  for (const pd of Object.values(state.plan).filter(p => p.on && !p.deleted).sort((a, b) => a.date < b.date ? -1 : 1)) {
    if (!pd.items?.length) planRows.push([pd.date, pd.type || 'auto', '', '', '']);
    for (const it of pd.items || []) {
      const name = it.k === 'block' ? (state.blocks[it.block]?.name || 'Block') : (it.name || getEx(state, it.ex)?.name || it.ex);
      const detail = it.k === 'cardio' ? `${it.min || ''} min ${it.km ? it.km + ' km' : ''}`.trim() : it.k === 'block' ? `${it.rounds || ''} rounds` : `${it.sets || 3} sets`;
      planRows.push([pd.date, pd.type || 'auto', name, detail, it.src || 'user']);
    }
  }
  const painRows = [['date', 'region', 'level_0_10', 'note']];
  for (const p of Object.values(state.pain).filter(p => !p.deleted).sort((a, b) => a.t - b.t)) painRows.push([ymd(new Date(p.t)), p.region, p.level, p.note || '']);
  return { 'sets.csv': toCsv(setsRows), 'cardio.csv': toCsv(cardioRows), 'plan.csv': toCsv(planRows), 'pain.csv': toCsv(painRows) };
}
function r2(x) { return x == null ? '' : Math.round(x * 100) / 100; }

// ---------- sessions
export function sessionsOn(date) {
  return Object.values(state.sessions).filter(s => !s.deleted && s.date === date).sort((a, b) => (a.start || 0) - (b.start || 0));
}
export function newSession(date) {
  const s = { id: uid('s'), date, start: date === ymd() ? Date.now() : null, items: [], u: Date.now() };
  state.sessions[s.id] = s;
  return s;
}

/** Test helper: reset to a blank state. */
export function _reset(snap) { adopt(snap || blank()); }
