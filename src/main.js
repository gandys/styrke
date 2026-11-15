// App shell: tabs, header, routing, autosave/sync wiring.

import { h, icon, iconBtn, closeAllSheets, sheetOpen, toast } from './ui.js';
import { state, local, saveLocal, load, on as onStore, flush, sessionsOn } from './store.js';
import { getSettings, analyze } from './model.js';
import { syncState, onSync, syncNow, syncSoon, syncKind, dailyFileBackup, isAndroid, inArtifact } from './sync.js';
import { ymd, addDays } from './util.js';
import { renderToday, setDate } from './views/today.js';
import { renderPlan, runAutoPlan } from './views/plan.js';
import { renderBody } from './views/body.js';
import { renderInsights } from './views/insights.js';
import { renderMore, morePage, setMorePage } from './views/more.js';

const TABS = [
  { id: 'today', name: 'Today', icon: 'today', render: renderToday },
  { id: 'plan', name: 'Plan', icon: 'plan', render: renderPlan },
  { id: 'body', name: 'Body', icon: 'body', render: renderBody },
  { id: 'insights', name: 'Insights', icon: 'chart', render: renderInsights },
  { id: 'more', name: 'More', icon: 'more', render: renderMore },
];
let tab = 'today';
let backFn = null;
let els = {};

const ctx = {
  setTitle(t, sub) { els.title.replaceChildren(...[t, sub ? h('span', { class: 'sub' }, sub) : null].filter(Boolean)); document.title = t + ' · Styrke'; },
  setBack(fn) { backFn = fn; els.back.classList.toggle('hide', !fn); },
  refresh(resetScroll) { render(resetScroll); },
  go(t, sub) { if (t === 'more' && sub) setMorePage(sub); else if (t === 'more') setMorePage('menu'); tab = t; setHash(); render(true); },
  openDate(d) { setDate(d); tab = 'today'; setHash(); render(true); },
  syncSoon,
  syncNow() { if (syncKind()) syncNow(); },
  replanSoon() {
    const today = ymd();
    const has = Object.values(state.plan).some(p => !p.deleted && p.on && p.date >= today && p.date <= addDays(today, 7) && p.auto);
    if (has) { runAutoPlan(today, addDays(today, 7)); toast('Plan for the next 7 days updated'); render(); }
  },
};

function setHash() { try { if (location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab); } catch { /* sandboxed */ } }

function render(resetScroll) {
  const y = window.scrollY;
  backFn = null; els.back.classList.add('hide');
  els.main.replaceChildren();
  const t = TABS.find(x => x.id === tab) || TABS[0];
  try { t.render(els.main, ctx); }
  catch (e) { console.error(e); els.main.appendChild(h('div', { class: 'empty' }, h('b', null, 'Something went wrong on this screen'), String(e.message || e), h('div', { style: { marginTop: '12px' } }, 'Your data is safe. Try another tab, or reload.'))); }
  els.main.classList.toggle('narrow', tab === 'today' || (tab === 'more' && !['settings', 'data'].includes(morePage())));
  if (tab === 'today') welcome();
  for (const b of els.nav.children) { const on = b.dataset.tab === tab; b.classList.toggle('on', on); b.setAttribute('aria-current', on ? 'page' : 'false'); }
  window.scrollTo(0, resetScroll ? 0 : y);
  drawSync();
  keepAwake();
}

function welcome() {
  if (local.welcomed || Object.values(state.sessions).some(s => !s.deleted)) return;
  els.main.insertBefore(h('div', { class: 'panel' },
    h('h2', null, 'Set up in three steps', h('button', { class: 'more', onClick: () => { local.welcomed = true; saveLocal(); render(); } }, 'Hide')),
    h('div', { class: 'list' },
      h('button', { onClick: () => ctx.go('more', 'library') }, h('span', { class: 'num dim', style: { width: '18px', fontSize: '18px' } }, '1'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'Choose your exercises'), h('div', { class: 's' }, 'Star what you do, or create your own.')), icon('right', 16)),
      h('button', { onClick: () => ctx.go('more', 'data') }, h('span', { class: 'num dim', style: { width: '18px', fontSize: '18px' } }, '2'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'Bring in your history'), h('div', { class: 's' }, 'Import your Notion or Excel log so charts and suggestions work from day one.')), icon('right', 16)),
      h('button', { onClick: () => ctx.go('more', 'data') }, h('span', { class: 'num dim', style: { width: '18px', fontSize: '18px' } }, '3'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'Keep a copy off this device'), h('div', { class: 's' }, inArtifact() ? 'Already on: this copy saves to your Claude storage.' : 'Turn on cloud sync so a lost phone does not lose your log.')), icon('right', 16)))),
    els.main.firstChild);
}

function drawSync() {
  const k = syncKind();
  const s = syncState.status;
  const cls = !k ? 'ok' : s === 'busy' ? 'busy' : s === 'err' ? 'err' : 'ok';
  const text = !k ? 'Saved' : s === 'busy' ? 'Syncing' : s === 'err' ? 'Not synced' : 'Synced';
  els.sync.className = 'sync ' + cls;
  els.sync.replaceChildren(h('i'), text);
  els.sync.title = !k ? 'Saved on this device. Tap to set up a cloud copy.' : s === 'err' ? syncState.msg : 'Saved on this device and in the cloud';
}

let wake = null;
async function keepAwake() {
  const s = tab === 'today' ? sessionsOn(ymd()).find(x => x.items?.length && !x.end) : null;
  try {
    if (isAndroid() && window.Android.keepAwake) { window.Android.keepAwake(!!s); return; }
    if (s && !wake && navigator.wakeLock) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
    else if (!s && wake) { await wake.release(); wake = null; }
  } catch { /* not allowed or not supported */ }
}

function shell() {
  const app = document.getElementById('app');
  els.back = iconBtn('left', 'Back', () => backFn && backFn(), 'hide');
  els.title = h('h1', null, 'Styrke');
  els.sync = h('button', { class: 'sync', onClick: () => ctx.go('more', 'data') });
  els.main = h('main', { id: 'view' });
  els.nav = h('nav', { class: 'nav', 'aria-label': 'Main' }, TABS.map(t => h('button', { 'data-tab': t.id, onClick: () => { if (tab === t.id && t.id === 'today') setDate(ymd()); ctx.go(t.id); } }, icon(t.icon), h('span', null, t.name))));
  app.replaceChildren(h('header', { class: 'top' }, els.back, els.title, els.sync), els.main, els.nav);
}

// Android hardware back button: close sheet, leave sub-page, go to Today, then exit.
window.styrkeBack = () => {
  if (sheetOpen()) { closeAllSheets(); return true; }
  if (backFn) { backFn(); return true; }
  if (tab !== 'today') { ctx.go('today'); return true; }
  return false;
};
window.setAndroidInsets = (top, bottom) => { document.documentElement.style.setProperty('--safe-b', (bottom || 0) + 'px'); };

async function boot() {
  await load();
  const s = getSettings(state);
  document.documentElement.dataset.theme = s.theme || 'dark';
  const hash = (location.hash || '').slice(1);
  if (TABS.some(t => t.id === hash)) tab = hash;
  shell();
  render(true);
  onStore(reason => {
    if (reason === 'saved') { drawSync(); return; }
    if (reason !== 'sync') syncSoon(); else if (!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') && !sheetOpen()) render();
    dailyFileBackup();
  });
  onSync(() => { drawSync(); });
  window.addEventListener('hashchange', () => { const hsh = location.hash.slice(1); if (TABS.some(t => t.id === hsh) && hsh !== tab) { tab = hsh; render(true); } });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { flush(); if (syncKind() && syncState.status !== 'busy') syncNow(); }
    else { if (syncKind() && Date.now() - syncState.last > 5 * 60000) syncNow(); keepAwake(); }
  });
  window.addEventListener('online', () => { if (syncKind()) syncNow(); });
  // Give the on-screen keyboard room: while it is up (the visible area shrinks), hide the tab bar
  // and add-buttons. Based on the viewport, not on focus, so closing the keyboard brings them back.
  let maxH = 0, lastW = 0;
  const vv = window.visualViewport;
  const checkKeyboard = () => {
    const hgt = vv ? vv.height : window.innerHeight, wid = vv ? vv.width : window.innerWidth;
    if (Math.abs(wid - lastW) > 40) { maxH = 0; lastW = wid; }
    maxH = Math.max(maxH, hgt);
    document.body.classList.toggle('typing', hgt < maxH * 0.78);
  };
  (vv || window).addEventListener('resize', checkKeyboard);
  window.addEventListener('resize', checkKeyboard);
  checkKeyboard();
  if (syncKind()) syncNow();
  dailyFileBackup();
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !inArtifact() && document.querySelector('link[rel=manifest]')) { try { navigator.serviceWorker.register('sw.js'); } catch { /* ignore */ } }
}
boot();
