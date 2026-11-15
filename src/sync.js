// Keeping the data safe off the phone: cloud sync (a private GitHub repo, or Claude artifact
// storage when the app runs as an artifact), backup files, and the Android bridge.

import { state, local, saveLocal, merge, isAheadOf, serialize, commit, exportCsv, exportJson, COLLECTIONS } from './store.js';
import { importPlan } from './importers.js';
import { ymd, debounce } from './util.js';

export const syncState = { status: 'off', msg: '', last: 0, kind: null };
const listeners = new Set();
export function onSync(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function set(status, msg = '') { syncState.status = status; syncState.msg = msg; if (status === 'ok') { syncState.last = Date.now(); local.lastSync = syncState.last; saveLocal(); } for (const f of listeners) f(syncState); }

export const isAndroid = () => typeof window !== 'undefined' && !!window.Android;
export const inArtifact = () => typeof window !== 'undefined' && !!window.claude && typeof window.claude.use === 'function';

// ---------- base64 for UTF-8 text
function b64enc(text) {
  const bytes = new TextEncoder().encode(text); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64dec(b64) {
  const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

// ---------- GitHub
const DATA_FILE = 'styrke-data.json';
function ghFetch(cfg, path, opts = {}) {
  return fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}/${path}`, {
    ...opts, cache: 'no-store',
    headers: { Authorization: `Bearer ${cfg.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) },
  });
}
async function ghGet(cfg, file) {
  const r = await ghFetch(cfg, `contents/${file}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(await ghErr(r));
  const j = await r.json();
  if (Array.isArray(j)) return { list: j };
  let text;
  if (j.content) text = b64dec(j.content);
  else { const r2 = await ghFetch(cfg, `contents/${file}`, { headers: { Accept: 'application/vnd.github.raw+json' } }); if (!r2.ok) throw new Error(await ghErr(r2)); text = await r2.text(); }
  return { sha: j.sha, text };
}
async function ghPut(cfg, file, text, sha, message) {
  const r = await ghFetch(cfg, `contents/${file}`, { method: 'PUT', body: JSON.stringify({ message, content: b64enc(text), ...(sha ? { sha } : {}) }) });
  if (!r.ok) { const e = new Error(await ghErr(r)); e.status = r.status; throw e; }
  return (await r.json()).content?.sha;
}
async function ghDelete(cfg, file, sha, message) {
  const r = await ghFetch(cfg, `contents/${file}`, { method: 'DELETE', body: JSON.stringify({ message, sha }) });
  if (!r.ok && r.status !== 404) throw new Error(await ghErr(r));
}
async function ghErr(r) {
  let m = ''; try { m = (await r.json()).message || ''; } catch { /* ignore */ }
  if (r.status === 401) return 'GitHub rejected the token. Create a new one and paste it again.';
  if (r.status === 403) return 'The token is not allowed to do this. It needs "Contents: read and write" on the data repository. ' + m;
  if (r.status === 404) return 'Repository not found. Check the owner and name, and that the token covers it.';
  return `GitHub error ${r.status}. ${m}`;
}

export async function testGithub(cfg) {
  const r = await ghFetch(cfg, '');
  if (!r.ok) throw new Error(await ghErr(r));
  const j = await r.json();
  if (!j.permissions?.push) throw new Error('The token can read this repository but not write to it. Give it "Contents: read and write".');
  return { private: j.private, name: j.full_name };
}

async function syncGithub() {
  const cfg = local.github;
  let imported = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    const remote = await ghGet(cfg, DATA_FILE);
    let robj = null, changed = false;
    if (remote?.text) { try { robj = JSON.parse(remote.text); } catch { throw new Error('The data file in the repository is damaged. Restore an earlier version from its history on GitHub.'); } changed = merge(robj); }
    // plan files dropped into inbox/ (by Claude or by hand)
    const inbox = await ghGet(cfg, 'inbox');
    for (const f of inbox?.list || []) {
      if (!/\.json$/i.test(f.name)) continue;
      const file = await ghGet(cfg, f.path);
      try { const res = importPlan(JSON.parse(file.text)); imported += res.added; changed = true; await ghDelete(cfg, f.path, file.sha, `Styrke: imported ${f.name}`); }
      catch (e) { console.warn('inbox file skipped', f.name, e); }
    }
    if (changed) commit('sync');
    if (!remote || isAheadOf(robj) || imported) {
      try { await ghPut(cfg, DATA_FILE, JSON.stringify(serialize()), remote?.sha, `Styrke sync ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`); }
      catch (e) { if ((e.status === 409 || e.status === 422) && attempt === 0) continue; throw e; }
    }
    break;
  }
  // readable CSV copies, at most once a day
  const today = ymd();
  if (local.lastCsv !== today) {
    try {
      const dir = await ghGet(cfg, 'export'); const shas = Object.fromEntries((dir?.list || []).map(f => [f.name, f.sha]));
      const files = exportCsv();
      for (const [name, text] of Object.entries(files)) await ghPut(cfg, 'export/' + name, text, shas[name], `Styrke export ${today}`);
      local.lastCsv = today; saveLocal();
    } catch (e) { console.warn('csv export failed', e); }
  }
  return imported;
}

// ---------- Claude artifact storage
let artDb = null; const artSeen = new Map();
/** Cheap fingerprint of a stored document: how many records and the newest change in it. */
function sigOf(id, data) {
  let n = 0, mx = 0;
  const scan = o => { for (const r of Object.values(o || {})) { n++; if ((r?.u || 0) > mx) mx = r.u; } };
  if (id === 'core') { for (const c of ['ex', 'blocks', 'presets', 'pain', 'body']) scan(data[c]); mx = Math.max(mx, data.settings?._u || 0); }
  else scan(data.sessions || data.plan);
  return n + ':' + mx;
}
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
async function getArtDb() {
  if (artDb) return artDb;
  if (!inArtifact()) return null;
  try { artDb = await window.claude.use('db'); } catch { artDb = null; }
  return artDb;
}
function artDocs() {
  const s = serialize(); const docs = {};
  docs.core = { savedAt: s.savedAt, settings: s.settings, ex: s.ex, blocks: s.blocks, presets: s.presets, pain: s.pain, body: s.body };
  for (const [id, x] of Object.entries(s.sessions)) { const k = 's-' + (x.date || '0000-00').slice(0, 7); (docs[k] ||= { sessions: {} }).sessions[id] = x; }
  for (const [id, x] of Object.entries(s.plan)) { const k = 'p-' + (x.date || id).slice(0, 7); (docs[k] ||= { plan: {} }).plan[id] = x; }
  return docs;
}
async function syncArtifact() {
  const db = await getArtDb();
  if (!db) throw new Error('Artifact storage is not available in this view.');
  const snap = await withTimeout(db.collection('styrke').get(), 12000, 'Claude storage cannot be reached right now. Your changes are safe on this device.');
  const robj = { settings: null }; for (const c of COLLECTIONS) robj[c] = {};
  for (const d of snap.docs) {
    const data = d.data(); if (!data) continue;
    artSeen.set(d.id, sigOf(d.id, data));
    if (d.id === 'core') { robj.settings = data.settings; for (const c of ['ex', 'blocks', 'presets', 'pain', 'body']) Object.assign(robj[c], data[c] || {}); }
    else if (d.id.startsWith('s-')) Object.assign(robj.sessions, data.sessions || {});
    else if (d.id.startsWith('p-')) Object.assign(robj.plan, data.plan || {});
  }
  let changed = merge(robj), imported = 0;
  try {
    const inbox = await db.collection('inbox').get();
    for (const d of inbox.docs) { try { const res = importPlan(d.data()); imported += res.added; changed = true; } catch (e) { console.warn('inbox doc skipped', d.id, e); } await db.doc('inbox/' + d.id).delete(); }
  } catch (e) { console.warn('inbox read failed', e); }
  if (changed) commit('sync');
  const docs = artDocs();
  for (const [id, data] of Object.entries(docs)) {
    const sig = sigOf(id, data);
    if (artSeen.get(id) === sig) continue;
    await db.doc('styrke/' + id).set(JSON.parse(JSON.stringify(data)));   // plain JSON, no undefined
    artSeen.set(id, sig);
  }
  return imported;
}

// ---------- orchestration
export function syncKind() { return local.github?.token ? 'github' : inArtifact() ? 'artifact' : null; }
let running = null, again = false;
export async function syncNow() {
  const kind = syncKind(); syncState.kind = kind;
  if (!kind) { set('off'); return { ok: false, off: true }; }
  if (running) { again = true; return running; }
  set('busy');
  running = (async () => {
    try {
      const imported = kind === 'github' ? await syncGithub() : await syncArtifact();
      set('ok', imported ? `Imported ${imported} planned sessions` : '');
      return { ok: true, imported };
    } catch (e) {
      console.warn('sync failed', e);
      set('err', (typeof navigator !== 'undefined' && navigator.onLine === false) ? 'Offline. Changes are safe on this device and sync when you are back online.' : (e.message || 'Sync failed'));
      return { ok: false, error: e };
    } finally { running = null; if (again) { again = false; syncSoon(); } }
  })();
  return running;
}
// Sync after two quiet minutes (and whenever the app goes to the background or a workout is finished),
// so a workout does not turn into dozens of uploads.
export const syncSoon = debounce(() => { if (syncKind()) syncNow(); }, 120000);

// ---------- files
export async function saveFile(name, text, mime = 'application/json') {
  if (isAndroid() && window.Android.saveFile) {
    const where = window.Android.saveFile(name, text, mime);
    if (where) return { ok: true, where };
    throw new Error('Could not write the file.');
  }
  if (inArtifact()) {
    const dl = await window.claude.use('downloads');
    if (dl) { await dl.save({ filename: name, data: text }); return { ok: true, where: 'your downloads' }; }
    try { await navigator.clipboard.writeText(text); return { ok: true, where: 'the clipboard (downloads are not available here)' }; } catch { throw new Error('Downloads are not available in this view.'); }
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return { ok: true, where: 'your downloads folder' };
}
export async function shareFile(name, text, mime = 'application/json') {
  if (isAndroid() && window.Android.shareFile) { window.Android.shareFile(name, text, mime); return true; }
  try {
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return true; }
  } catch { /* fall through */ }
  return false;
}

/** Android only: drop a dated backup file into Download/Styrke once a day. */
export function dailyFileBackup() {
  if (!isAndroid() || !window.Android.saveBackup || local.fileBackup === false) return;
  const today = ymd();
  if (local.lastBackup === today) return;
  try { const where = window.Android.saveBackup(`styrke-backup-${today}.json`, exportJson()); if (where) { local.lastBackup = today; local.lastBackupPath = where; saveLocal(); } } catch (e) { console.warn('file backup failed', e); }
}
