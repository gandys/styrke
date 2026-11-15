// Today: the gym screen. Log sets in a table, tick them off, rest timer, autosave on every keystroke.

import { h, icon, iconBtn, sheet, toast, confirmSheet, numInput, field } from '../ui.js';
import { state, commit, touch, put, sessionsOn, newSession, flush } from '../store.js';
import { analyze, getEx, suggest, loadAt, currentPain, statusOf, sessionSummary, getSettings } from '../model.js';
import { planMinutes, painCheck } from '../planner.js';
import { MUSCLE, JOINT, TYPE } from '../library.js';
import { ymd, addDays, relDay, fmtDate, fmtW, fmtNum, fmtDur, uid, diffDays, fmtMin } from '../util.js';
import { pickExercise, pickBlock, exName, itemLabel, editExercise, muscleSummary } from './common.js';
import { showExerciseHistory } from './insights.js';
import { openDaySheet, planDayNow } from './plan.js';

let curDate = ymd();
export function setDate(d) { curDate = d; }
export function getDate() { return curDate; }

// ---------- rest timer (survives re-renders)
const timer = { end: 0, total: 0, label: '', iv: 0, buzzed: false };
function startTimer(sec, label) {
  if (!getSettings(state).restTimer || !sec) return;
  timer.end = Date.now() + sec * 1000; timer.total = sec; timer.label = label; timer.buzzed = false;
  drawTimer();
  clearInterval(timer.iv); timer.iv = setInterval(drawTimer, 250);
}
function stopTimer() { timer.end = 0; clearInterval(timer.iv); drawTimer(); }
function drawTimer() {
  const host = document.getElementById('timer-host'); if (!host) return;
  if (!timer.end) { host.replaceChildren(); return; }
  const left = (timer.end - Date.now()) / 1000;
  if (left < -90) { stopTimer(); return; }
  if (left <= 0 && !timer.buzzed) { timer.buzzed = true; try { navigator.vibrate && navigator.vibrate([180, 90, 180]); } catch { /* not supported */ } }
  const over = left <= 0;
  host.replaceChildren(h('div', { class: 'timer' + (over ? ' over' : '') },
    h('span', { class: 't' }, over ? '+' + fmtDur(-left) : fmtDur(left)),
    h('span', { class: 'l ell' }, over ? 'Rest is over. Go.' : 'Rest' + (timer.label ? ' before ' + timer.label : '')),
    over ? null : h('button', { onClick: () => { timer.end += 30000; timer.total += 30; drawTimer(); } }, '+30 s'),
    h('button', { onClick: stopTimer }, over ? 'Done' : 'Skip'),
    over ? null : h('div', { class: 'p', style: { width: Math.max(0, Math.min(100, (1 - left / timer.total) * 100)) + '%' } })));
}

// ---------- building session items
function templateSets(an, exId, n, date) {
  const last = (an.exHist.get(exId) || []).filter(x => x.date < date).pop();
  if (last && last.sets.length) {
    const rows = last.sets.map(s => ({ w: s.w, r: null, ph: s.r, d: false, ...(s.f === 'w' ? { f: 'w' } : {}) }));
    if (n && rows.length < n) while (rows.length < n) rows.push({ ...rows[rows.length - 1] });
    return rows;
  }
  return Array.from({ length: n || 3 }, () => ({ w: null, r: null, d: false }));
}
function makeExItem(an, exId, sets, date) { return { id: uid('i'), k: 'ex', ex: exId, sets: templateSets(an, exId, sets, date) }; }
function makeBlockItem(an, b, rounds, date) {
  const n = rounds || b.rounds || 3;
  const lastW = id => { const hs = an.exHist.get(id); const l = hs?.[hs.length - 1]; return l ? { w: l.sets[l.sets.length - 1].w, ph: l.sets[l.sets.length - 1].r } : { w: null }; };
  return { id: uid('i'), k: 'block', block: b.id, name: b.name, exIds: [...b.exIds], rest: b.rest, restRound: b.restRound, sameWeight: !!b.sameWeight,
    rounds: Array.from({ length: n }, () => b.exIds.map(id => ({ ...lastW(id), r: null, d: false }))) };
}
function activeSession(date, create) {
  const list = sessionsOn(date);
  let s = list[list.length - 1];
  if (!s && create) s = newSession(date);
  return s;
}
function save(s, reason = 'log') { touch(s); commit(reason); }

function startFromPlan(pd, an) {
  const s = activeSession(pd.date, true);
  for (const it of pd.items || []) {
    if (it.k === 'ex') { const item = makeExItem(an, it.ex, it.sets, pd.date); if (it.note) item.note = it.note; if (it.easy) item.easy = true; s.items.push(item); }
    else if (it.k === 'block') { const b = state.blocks[it.block]; if (b && !b.deleted) s.items.push(makeBlockItem(an, b, it.rounds, pd.date)); }
    else if (it.k === 'cardio') s.items.push({ id: uid('i'), k: 'cardio', ex: it.ex, name: it.name, min: it.min ?? null, km: it.km ?? null, rpe: it.rpe || 4, note: it.note || '', d: false, planned: true });
  }
  s.fromPlan = true;
  save(s);
}

// ---------- view
export function renderToday(root, ctx) {
  const today = ymd();
  const an = analyze(state);
  const settings = an.settings;
  const sessions = sessionsOn(curDate);
  const pd = state.plan[curDate] && !state.plan[curDate].deleted && state.plan[curDate].on ? state.plan[curDate] : null;
  const future = curDate > today;
  const hasItems = sessions.some(s => s.items?.length);
  const pain = currentPain(state);

  ctx.setTitle(relDay(curDate, today) === fmtDate(curDate) ? (curDate > today ? 'Planned day' : 'Past day') : relDay(curDate, today), '');

  // date bar
  root.appendChild(h('div', { class: 'datebar' },
    iconBtn('left', 'Previous day', () => { curDate = addDays(curDate, -1); ctx.refresh(true); }),
    h('button', { class: 'd' }, fmtDate(curDate, { year: curDate.slice(0, 4) !== today.slice(0, 4) }),
      h('input', { type: 'date', value: curDate, 'aria-label': 'Pick a date', onChange: e => { if (e.target.value) { curDate = e.target.value; ctx.refresh(true); } } })),
    curDate !== today ? h('button', { class: 'btn small ghost', onClick: () => { curDate = today; ctx.refresh(true); } }, 'Today') : null,
    iconBtn('right', 'Next day', () => { curDate = addDays(curDate, 1); ctx.refresh(true); })));

  // readiness + pain strip (today and future)
  if (curDate >= today) {
    const chips = [];
    for (const [region, p] of Object.entries(pain)) chips.push(h('button', { class: 'tag pain', style: { height: '26px' }, onClick: () => ctx.go('body') }, `${JOINT[region]?.name || region} ${p.level}/10`));
    if (curDate === today) {
      const l = loadAt(an, Date.now());
      const loaded = Object.entries(l.fm).filter(([, f]) => f >= 0.45).sort((a, b) => b[1] - a[1]).slice(0, 4);
      for (const [m, f] of loaded) chips.push(h('button', { class: 'tag ' + (f >= 0.75 ? 'warn' : ''), style: { height: '26px' }, onClick: () => ctx.go('body') }, `${MUSCLE[m].name} ${statusOf(f).label.toLowerCase()}`));
      if (!loaded.length && !chips.length && an.events.length) chips.push(h('button', { class: 'tag good', style: { height: '26px' }, onClick: () => ctx.go('body') }, 'All muscles recovered'));
    }
    if (chips.length) root.appendChild(h('div', { class: 'chips', style: { margin: '0 0 12px' } }, chips));
  }

  // planned workout
  const planPending = pd && !sessions.some(s => s.fromPlan);
  if (pd && planPending) {
    const items = pd.items || [];
    const typeName = pd.type?.startsWith('preset:') ? (state.presets[pd.type.slice(7)]?.name || 'Preset') : (TYPE[pd.type || 'auto']?.name || 'Workout');
    const warns = [];
    for (const it of items) {
      const ex = it.k !== 'block' ? getEx(state, it.ex) : null;
      const pc = ex && painCheck(state, ex, curDate, settings, pain, today);
      if (pc) warns.push(`${JOINT[pc.region].name} at ${pc.pain}/10: ${pc.level === 'avoid' ? 'think about moving or swapping' : 'go easy on'} ${it.name || ex.name}.`);
    }
    root.appendChild(h('div', { class: 'panel' },
      h('h2', null, 'Planned: ' + (pd.type === 'auto' || !pd.type ? 'workout' : typeName), h('span', { class: 'note', style: { fontWeight: 400 } }, items.length ? 'about ' + fmtMin(planMinutes(state, items)) : ''),
        h('button', { class: 'more', onClick: () => openDaySheet(curDate, ctx) }, 'Change')),
      warns.length ? h('div', { class: 'banner pain', style: { margin: '0 0 8px' } }, icon('warn'), h('div', null, [...new Set(warns)].map(w => h('div', null, w)))) : null,
      pd.note ? h('p', { class: 'note', style: { marginBottom: '6px' } }, pd.note) : null,
      !warns.length && pd.notes?.length ? h('div', { class: 'banner', style: { margin: '0 0 8px', fontSize: '13.5px' } }, icon('info'), h('div', null, pd.notes.map(n => h('div', null, n)))) : null,
      items.length ? h('div', null, items.map(it => { const l = itemLabel(it); return h('div', { class: 'plan-item' }, h('div', { class: 'grow' }, h('div', { style: { fontWeight: 500 } }, l.name, it.easy ? h('span', { class: 'tag pain', style: { marginLeft: '8px' } }, 'easy') : null), l.sub ? h('div', { class: 'note tiny ell' }, l.sub) : null), h('span', { class: 'q' }, l.q)); }))
        : h('p', { class: 'note' }, 'You committed to training this day. Nothing is filled in yet.'),
      future ? null : h('div', { class: 'row', style: { marginTop: '12px' } },
        items.length ? h('button', { class: 'btn primary grow', onClick: () => { startFromPlan(pd, an); ctx.refresh(); } }, icon('play'), hasItems ? 'Add planned workout' : 'Start this workout') : null,
        !items.length || pd.type !== 'custom' ? h('button', { class: 'btn' + (items.length ? '' : ' primary grow'), onClick: () => { const r = planDayNow(curDate); toast(r ? 'Day planned' : 'Nothing to plan'); ctx.refresh(); } }, icon('bolt'), items.length ? 'Re-plan' : 'Plan it for me') : null),
      future ? h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn grow', onClick: () => { planDayNow(curDate); ctx.refresh(); } }, icon('bolt'), items.length ? 'Re-plan this day' : 'Plan it for me')) : null));
  }

  // logged sessions
  for (const s of sessions) {
    s.items.forEach((it, idx) => root.appendChild(renderItem(s, it, idx, an, ctx)));
  }

  if (!hasItems && !(pd && planPending)) {
    root.appendChild(h('div', { class: 'empty' }, h('b', null, future ? 'Nothing planned' : curDate === today ? 'Nothing logged yet today' : 'Nothing logged this day'),
      future ? 'Commit to this day in the Plan tab and it shows up here.' : 'Add the first exercise below. Everything saves as you type.',
      future ? h('div', { style: { marginTop: '14px' } }, h('button', { class: 'btn primary', onClick: () => { put('plan', { date: curDate, on: true, type: 'auto', items: [] }, 'plan'); ctx.refresh(); } }, 'Plan a workout this day')) : null));
  }

  // summary + finish
  if (hasItems) {
    const s = sessions[sessions.length - 1];
    let sets = 0, vol = 0, wav = 0, hard = 0; const prs = [];
    for (const ss of sessions) { const sm = sessionSummary(state, an, ss); sets += sm.sets; vol += sm.vol; wav += sm.wav; hard += sm.hard; prs.push(...sm.prs); }
    if (sets) {
      root.appendChild(h('div', { class: 'tiles', style: { marginTop: '4px' } },
        h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtNum(hard, 1), h('small', null, '/ ' + sets)), h('div', { class: 'k' }, 'Hard sets')),
        h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtNum(vol), h('small', null, 'kg')), h('div', { class: 'k' }, 'Volume')),
        h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtNum(wav), h('small', null, 'kg')), h('div', { class: 'k' }, 'Weight-adjusted'))));
      if (prs.length) root.appendChild(h('div', { class: 'chips', style: { marginTop: '10px' } }, [...new Map(prs.map(p => [p.ex, p])).values()].map(p => h('span', { class: 'tag good', style: { height: '26px' } }, `Best yet: ${exName(p.ex)} ${fmtW(p.top.w)} × ${p.top.r}`))));
    }
    if (!future) root.appendChild(h('div', { class: 'row', style: { marginTop: '12px' } },
      h('button', { class: 'btn grow', onClick: () => finishSheet(s, ctx) }, s.end ? 'Session notes and effort' : 'Finish workout'),
      s.end ? h('span', { class: 'tag good' }, 'Finished') : null));
  }

  // dock: timer + add buttons
  if (!future) {
    const addEx = () => pickExercise({ kind: 'strength', onPick: ex => { const s = activeSession(curDate, true); s.items.push(makeExItem(an, ex.id, 0, curDate)); save(s); ctx.refresh(); scrollToEnd(); } });
    const addBlock = () => pickBlock(b => { const s = activeSession(curDate, true); s.items.push(makeBlockItem(an, b, 0, curDate)); save(s); ctx.refresh(); scrollToEnd(); });
    const addCardio = () => pickExercise({ kind: 'cardio', title: 'Add cardio or activity', onPick: ex => { const s = activeSession(curDate, true); s.items.push({ id: uid('i'), k: 'cardio', ex: ex.id, min: null, km: null, rpe: 4, note: '', d: true }); save(s); ctx.refresh(); scrollToEnd(); } });
    root.appendChild(h('div', { class: 'dock' }, h('div', null, h('div', { id: 'timer-host' }),
      h('div', { class: 'addbar' },
        h('button', { class: 'btn primary', onClick: addEx }, icon('plus'), 'Exercise'),
        h('button', { class: 'btn', onClick: addBlock }, 'Block'),
        h('button', { class: 'btn', onClick: addCardio }, 'Cardio')))));
    drawTimer();
  }
}
function scrollToEnd() { requestAnimationFrame(() => { const cards = document.querySelectorAll('.xcard'); cards[cards.length - 1]?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }); }

function tick() { return icon('check'); }

function setRow(s, set, i, opts) {
  const { onDone, label, block, weightChanged } = opts;
  const row = h('div', { class: 'set' + (block ? ' bset' : '') + (set.d ? ' done' : '') });
  const repsEl = numInput(set.r, v => { set.r = v; save(s); }, { int: true, placeholder: set.ph != null ? String(set.ph) : 'reps', 'aria-label': 'Reps' });
  const wEl = numInput(set.w, (v, el) => { set.w = v; save(s); weightChanged && weightChanged(v, el); }, { placeholder: opts.wph || 'kg', 'aria-label': 'Weight in kg' });
  const okBtn = h('button', { class: 'ok', 'aria-label': set.d ? 'Mark set as not done' : 'Mark set as done', 'aria-pressed': String(!!set.d), onClick: () => {
    if (!set.d) {
      if (set.r == null) set.r = set.ph ?? opts.prev?.r ?? null;
      if (set.r == null || !(set.r > 0)) { toast('Type the reps first.'); repsEl.focus(); return; }
      if (set.w == null) set.w = opts.prev?.w ?? 0;
      set.d = true; save(s); onDone(true);
    } else { set.d = false; save(s); onDone(false); }
  } }, tick());
  if (block) row.appendChild(h('div', { class: 'bn' }, label));
  else row.appendChild(h('button', { class: 'n' + (set.f ? ' ' + set.f : ''), title: 'Tap to mark as W warm-up, H hard set, D drop set', 'aria-label': `Set ${i + 1}${set.f === 'w' ? ', warm-up' : set.f === 'h' ? ', counted as a hard set' : set.f === 'd' ? ', drop set' : ''}. Tap to change type`, onClick: () => { set.f = set.f === 'w' ? 'h' : set.f === 'h' ? 'd' : set.f === 'd' ? undefined : 'w'; if (!set.f) delete set.f; save(s); opts.rerender(); } }, set.f === 'w' ? 'W' : set.f === 'h' ? 'H' : set.f === 'd' ? 'D' : String(opts.num ?? i + 1)));
  row.append(wEl, h('span', { class: 'x' }, '×'), repsEl, okBtn);
  return row;
}

function renderItem(s, it, idx, an, ctx) {
  const card = h('div', { class: 'xcard' });
  const menu = () => itemMenu(s, it, idx, ctx);
  if (it.k === 'ex') {
    const ex = getEx(state, it.ex);
    const sg = suggest(state, an, it.ex, s.date);
    const wl = w => (ex?.bw && !w ? 'BW' : fmtW(w));
    const last = sg?.last;
    card.appendChild(h('div', { class: 'xhead' },
      h('button', { class: 'grow', style: { textAlign: 'left' }, onClick: () => showExerciseHistory(it.ex) },
        h('div', { class: 'name' }, ex?.name || 'Unknown exercise', it.easy ? h('span', { class: 'tag pain', style: { marginLeft: '8px' } }, 'go easy') : null, ex?.needsSetup ? h('span', { class: 'tag warn', style: { marginLeft: '8px' } }, 'set muscles') : null),
        last ? h('div', { class: 'meta' }, 'Last ', h('b', null, last.sets.filter(x => x.f !== 'w').slice(0, 5).map(x => `${wl(x.w)}×${x.r}`).join('  ')), sg.target ? [h('span', null, '   Aim '), h('b', { style: { color: 'var(--accent)' } }, `${wl(sg.target.w)}×${sg.target.r}`)] : null)
          : h('div', { class: 'meta' }, 'First time. ', ex ? `Aim for ${ex.repLo}–${ex.repHi} reps.` : '')),
      iconBtn('dots', 'More options', menu)));
    const sets = h('div', { class: 'sets' });
    if (idx === 0 && it.sets.length) card.appendChild(h('div', { class: 'sethead' }, h('span'), h('span', null, ex?.bw ? 'added kg' : ex?.perSide ? 'kg per hand' : 'kg'), h('span'), h('span', null, 'reps'), h('span', null, 'done')));
    let n = 0;
    it.sets.forEach((set, i) => {
      const num = set.f === 'w' ? null : ++n;
      sets.appendChild(setRow(s, set, i, { num, prev: it.sets[i - 1], rerender: () => ctx.refresh(), wph: ex?.bw ? '+ kg' : 'kg',
        onDone: on => { if (on) startTimer(ex?.rest || 90, i < it.sets.length - 1 ? 'set ' + (i + 2) : ''); ctx.refresh(); } }));
    });
    card.appendChild(sets);
    card.appendChild(h('div', { class: 'xfoot' },
      h('button', { class: 'btn ghost small', onClick: () => { const p = it.sets[it.sets.length - 1]; it.sets.push({ w: p?.w ?? null, r: null, ph: p?.r ?? p?.ph, d: false }); save(s); ctx.refresh(); } }, icon('plus'), 'Set'),
      it.sets.length ? h('button', { class: 'btn ghost small', style: { color: 'var(--dim)' }, onClick: async () => { const p = it.sets[it.sets.length - 1]; if (p.d && !(await confirmSheet('Remove this set?', `${fmtW(p.w)} kg × ${p.r} is already ticked off.`, 'Remove', true))) return; it.sets.pop(); save(s); ctx.refresh(); } }, 'Remove last') : null,
      it.note ? h('span', { class: 'note tiny ell grow', style: { textAlign: 'right' } }, it.note) : null));
  } else if (it.k === 'block') {
    card.appendChild(h('div', { class: 'xhead' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, it.name || 'Block', h('span', { class: 'tag acc', style: { marginLeft: '8px' } }, 'block')),
        h('div', { class: 'meta' }, `${it.rest ?? 30} s between exercises, ${it.restRound ?? 60} s after each round`)),
      iconBtn('dots', 'More options', menu)));
    const sets = h('div', { class: 'sets' });
    it.rounds.forEach((round, ri) => {
      sets.appendChild(h('div', { class: 'round' }, `Round ${ri + 1}`, round.every(x => x.d) ? h('span', { class: 'tag good' }, 'done') : null));
      round.forEach((set, ei) => {
        const ex = getEx(state, it.exIds[ei]);
        sets.appendChild(setRow(s, set, ei, { block: true, label: ex?.name || '?', prev: it.rounds[ri - 1]?.[ei], rerender: () => ctx.refresh(),
          weightChanged: (v, el) => { if (!it.sameWeight) return; const inputs = el.closest('.sets').querySelectorAll('.bset'); round.forEach((o, k) => { if (o !== set && !o.d) { o.w = v; const rowEl = inputs[ri * round.length + k]; const inp = rowEl?.querySelector('input'); if (inp && inp !== el) inp.value = v ?? ''; } }); },
          onDone: on => { if (on) { const lastInRound = ei === round.length - 1; const lastRound = ri === it.rounds.length - 1; if (!(lastInRound && lastRound)) startTimer(lastInRound ? (it.restRound ?? 60) : (it.rest ?? 30), lastInRound ? 'round ' + (ri + 2) : getEx(state, it.exIds[ei + 1])?.name); } ctx.refresh(); } }));
      });
    });
    card.appendChild(sets);
    card.appendChild(h('div', { class: 'xfoot' },
      h('button', { class: 'btn ghost small', onClick: () => { const p = it.rounds[it.rounds.length - 1]; it.rounds.push(it.exIds.map((_, k) => ({ w: p?.[k]?.w ?? null, r: null, ph: p?.[k]?.r ?? p?.[k]?.ph, d: false }))); save(s); ctx.refresh(); } }, icon('plus'), 'Round'),
      it.rounds.length > 1 ? h('button', { class: 'btn ghost small', style: { color: 'var(--dim)' }, onClick: async () => { const p = it.rounds[it.rounds.length - 1]; if (p.some(x => x.d) && !(await confirmSheet('Remove this round?', 'It has sets ticked off.', 'Remove', true))) return; it.rounds.pop(); save(s); ctx.refresh(); } }, 'Remove last') : null));
  } else if (it.k === 'cardio') {
    const ex = getEx(state, it.ex);
    const pending = it.d === false;
    card.appendChild(h('div', { class: 'xhead' },
      h('div', { class: 'grow' }, h('div', { class: 'name' }, it.name || ex?.name || 'Cardio', pending ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'planned') : null),
        h('div', { class: 'meta' }, it.name && ex ? ex.name + '. ' : '', 'Effort 1 is a stroll, 10 is all-out.')),
      iconBtn('dots', 'More options', menu)));
    card.appendChild(h('div', { class: 'cardio' },
      h('div', null, h('label', null, 'Minutes'), numInput(it.min, v => { it.min = v; save(s); }, { int: true, placeholder: 'min' })),
      ex?.dist !== false ? h('div', null, h('label', null, 'Distance, km'), numInput(it.km, v => { it.km = v; save(s); }, { placeholder: 'km' })) : h('div'),
      h('div', null, h('label', null, 'Effort'), numInput(it.rpe, v => { it.rpe = v ? Math.max(1, Math.min(10, v)) : 4; save(s); }, { int: true, placeholder: '1–10' }))));
    card.appendChild(h('div', { style: { padding: '0 14px 12px' } },
      h('input', { type: 'text', placeholder: 'Note (route, how it felt)', value: it.note || '', onInput: e => { it.note = e.target.value; save(s); } }),
      pending ? h('button', { class: 'btn primary block', style: { marginTop: '10px' }, onClick: () => { if (!(it.min > 0) && !(it.km > 0)) return toast('Type the minutes or the distance.'); it.d = true; save(s); ctx.refresh(); } }, icon('check'), 'Mark as done') : null));
  }
  return card;
}

function itemMenu(s, it, idx, ctx) {
  const act = (label, ic, fn, cls = '') => h('button', { class: cls, onClick: () => { sh.close(); fn(); } }, icon(ic), h('span', { class: 't' }, label));
  const sh = sheet({
    title: it.k === 'ex' ? exName(it.ex) : it.k === 'block' ? (it.name || 'Block') : (it.name || exName(it.ex)),
    body: h('div', { class: 'list' },
      it.k === 'ex' ? act('History and progress', 'chart', () => showExerciseHistory(it.ex)) : null,
      it.k === 'ex' ? act('Swap for another exercise', 'swap', () => pickExercise({ kind: 'strength', title: 'Swap exercise', onPick: ex => { it.ex = ex.id; save(s); ctx.refresh(); } })) : null,
      it.k !== 'block' ? act('Edit exercise details', 'edit', () => editExercise(it.ex, {}, () => ctx.refresh())) : null,
      it.k === 'ex' ? act(it.note ? 'Edit note' : 'Add a note', 'list', () => noteSheet(it.note, v => { it.note = v; save(s); ctx.refresh(); })) : null,
      idx > 0 ? act('Move up', 'up', () => { s.items.splice(idx - 1, 0, s.items.splice(idx, 1)[0]); save(s); ctx.refresh(); }) : null,
      idx < s.items.length - 1 ? act('Move down', 'down', () => { s.items.splice(idx + 1, 0, s.items.splice(idx, 1)[0]); save(s); ctx.refresh(); }) : null,
      act('Remove from this workout', 'trash', async () => {
        const removed = s.items.splice(idx, 1)[0]; save(s); ctx.refresh();
        toast('Removed', { label: 'Undo', fn: () => { s.items.splice(idx, 0, removed); save(s); ctx.refresh(); } });
      }, 'danger')),
  });
}

function noteSheet(value, onSave) {
  let v = value || '';
  sheet({ title: 'Note', body: h('textarea', { placeholder: 'Seat height, grip, how it felt', onInput: e => { v = e.target.value; } }, v),
    footer: api => [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => { api.close(); onSave(v.trim()); } }, 'Save note')] });
}

function finishSheet(s, ctx) {
  const an = analyze(state);
  const sm = sessionSummary(state, an, s);
  const muscles = Object.entries(sm.muscles).filter(([m, v]) => v >= 0.5 && MUSCLE[m]).sort((a, b) => b[1] - a[1]);
  sheet({
    title: s.end ? 'Session' : 'Finish workout',
    body: [
      h('div', { class: 'tiles' },
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, fmtNum(sm.hard, 1)), h('div', { class: 'k' }, 'Hard sets')),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, fmtNum(sm.vol)), h('div', { class: 'k' }, 'Volume, kg')),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, fmtNum(sm.wav)), h('div', { class: 'k' }, 'Weight-adjusted'))),
      muscles.length ? h('div', { class: 'chips', style: { margin: '12px 0 0' } }, muscles.map(([m, v]) => h('span', { class: 'chip sm' }, `${MUSCLE[m].name} ${fmtNum(v, 1)}`))) : null,
      h('div', { class: 'stack', style: { marginTop: '14px' } },
        field('How hard was the whole session? (1 easy, 10 maximal)', h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '4px' } }, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => h('button', { class: 'chip sm' + (s.rpe === n ? ' on' : ''), style: { padding: 0, justifyContent: 'center', minHeight: '36px' }, onClick: e => { s.rpe = s.rpe === n ? undefined : n; save(s); e.target.parentNode.querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('on', s.rpe === i + 1)); } }, n)))),
        field('Notes', h('textarea', { placeholder: 'Anything worth remembering', onInput: e => { s.note = e.target.value; save(s); } }, s.note || ''))),
    ],
    footer: api => [h('button', { class: 'btn primary', onClick: () => { if (!s.end) { s.end = Date.now(); save(s); flush(); toast('Workout saved'); } api.close(); ctx.refresh(); ctx.syncNow && ctx.syncNow(); } }, s.end ? 'Done' : 'Finish and save')],
  });
}
