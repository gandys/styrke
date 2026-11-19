// Plan: commit to training days on a calendar (up to three months ahead), give days a type or
// leave them open, and let the planner fill them.

import { h, icon, iconBtn, sheet, toast, confirmSheet, seg, field, numInput, toggle, slider } from '../ui.js';
import { state, put, del, commit, touch, setSetting, sessionsOn } from '../store.js';
import { analyze, getSettings, muscleTarget, isDeloadWeek, myExercises, MODES } from '../model.js';
import { autoPlan, planMinutes, weekProjection, presetItems, dayPresets, PATTERNS, patternDays, patternFromWeek, patternRecord, monthCommitments } from '../planner.js';
import { MUSCLES, TYPES, TYPE } from '../library.js';
import { ymd, addDays, parseYmd, weekStart, MONTHS, DOW_SHORT, fmtDate, relDay, diffDays, fmtMin, fmtNum, uid } from '../util.js';
import { pickExercise, pickBlock, itemLabel, exName, muscleSummary, editBlock, editPreset } from './common.js';

const HORIZON = 92; // days ahead you can commit to
let curMonth = null;
let range = 14;

export function typeName(pd) {
  if (!pd) return '';
  const pres = dayPresets(state, pd);
  if (pres.length) return pres.map(p => p.name).join(' + ');
  return TYPE[pd.type || 'auto']?.name || 'Auto';
}
function shortLabel(pd) {
  const pres = dayPresets(state, pd);
  if (pres.length) return pres[0].name + (pres.length > 1 ? ' +' + (pres.length - 1) : '');
  const cardio = (pd.items || []).filter(i => i.k === 'cardio');
  const strength = (pd.items || []).filter(i => i.k !== 'cardio');
  const t = pd.type || 'auto';
  let base = t === 'auto' ? (strength.length ? 'Gym' : cardio.length ? '' : 'Open') : t.startsWith('preset:') ? typeName(pd) : ({ upper: 'Upper', lower: 'Lower', full: 'Full', arms: 'Arms', cardio: cardio.length ? '' : 'Cardio' }[t] ?? TYPE[t]?.name ?? '');
  const c = cardio.length ? exName(cardio[0].ex).split(' ')[0] : '';
  return [c, base].filter(Boolean).join(' + ');
}

export function applyPlan(res) {
  let n = 0;
  for (const [date, d] of Object.entries(res.days)) {
    const pd = state.plan[date]; if (!pd || pd.deleted) continue;
    pd.items = d.items; pd.notes = d.notes; pd.auto = Date.now(); if (d.preset) pd.presetUsed = d.preset; else delete pd.presetUsed;
    touch(pd); n++;
  }
  if (n) commit('plan');
  return n;
}
let plannerNotes = [];   // what the last run of the planner wants you to know
export function runAutoPlan(from, to) {
  const res = autoPlan(state, analyze(state), { from, to });
  plannerNotes = res.notes || [];
  return applyPlan(res);
}
/** Plan a single day now (creates the commitment if needed). */
export function planDayNow(date) {
  if (!state.plan[date] || state.plan[date].deleted) state.plan[date] = touch({ date, on: true, type: 'auto', items: [] });
  state.plan[date].on = true; state._rev++;
  const res = autoPlan(state, analyze(state), { from: date, to: date });
  applyPlan(res);
  return (state.plan[date].items || []).length > 0;
}

function dayDone(an, date) { return an.days.has(date); }

export function renderPlan(root, ctx) {
  const today = ymd();
  const an = analyze(state);
  const settings = an.settings;
  if (!curMonth) curMonth = today.slice(0, 7) + '-01';
  const limit = addDays(today, HORIZON);
  ctx.setTitle('Plan', 'Tap a day to commit. Tap again to edit it.');

  // ---- calendar
  const m = parseYmd(curMonth);
  const first = weekStart(curMonth);
  const cells = [];
  for (const d of DOW_SHORT) cells.push(h('div', { class: 'dow' }, d));
  for (let i = 0; i < 42; i++) {
    const date = addDays(first, i);
    const inMonth = date.slice(0, 7) === curMonth.slice(0, 7);
    if (i >= 35 && !inMonth && addDays(first, 35).slice(0, 7) !== curMonth.slice(0, 7)) break;
    const pd = state.plan[date] && !state.plan[date].deleted && state.plan[date].on ? state.plan[date] : null;
    const done = dayDone(an, date);
    const past = date < today;
    const cls = ['day', !inMonth && 'out', past && 'past', pd && !past && 'on', done && 'done', pd && past && !done && 'missed', date === today && 'today', date > limit && 'locked'];
    const lab = done ? (an.days.get(date).cardioMin && !an.days.get(date).sets ? 'Cardio' : (an.days.get(date).sets + ' sets')) : pd ? shortLabel(pd) : '';
    const hasRun = pd && !done && (pd.items || []).some(i => i.k === 'cardio');
    cells.push(h('button', { class: cls, 'aria-label': `${fmtDate(date)}${pd ? ', planned: ' + typeName(pd) : ''}${done ? ', trained' : ''}`, onClick: () => {
      if (past) { ctx.openDate(date); return; }
      if (!pd) { put('plan', { date, on: true, type: 'auto', items: [] }, 'plan'); ctx.refresh(); toast(`Committed to ${fmtDate(date)}`, { label: 'Undo', fn: () => { del('plan', date, 'plan'); ctx.refresh(); } }); }
      else openDaySheet(date, ctx);
    } },
      hasRun ? h('i', { class: 'run' }) : null,
      h('span', { class: 'dn' }, parseYmd(date).getDate()),
      lab ? h('span', { class: 'dl' }, lab) : null,
      pd && !done && pd.items?.length ? h('span', { class: 'dm' }, planMinutes(state, pd.items) + "'") : null));
  }
  const minMonth = addDays(today, -366).slice(0, 7), maxMonth = limit.slice(0, 7);
  const shift = n => { const d = parseYmd(curMonth); d.setMonth(d.getMonth() + n); const s = ymd(d).slice(0, 7); if (s < minMonth || s > maxMonth) return; curMonth = s + '-01'; ctx.refresh(true); };
  const calendar = h('div', null,
    h('div', { class: 'cal-head' }, h('h2', null, `${MONTHS[m.getMonth()]} ${m.getFullYear()}`),
      curMonth.slice(0, 7) !== today.slice(0, 7) ? h('button', { class: 'btn small ghost', onClick: () => { curMonth = today.slice(0, 7) + '-01'; ctx.refresh(true); } }, 'This month') : null,
      iconBtn('left', 'Previous month', () => shift(-1)), iconBtn('right', 'Next month', () => shift(1))),
    h('div', { class: 'cal' }, cells),
    h('div', { class: 'legend', style: { marginTop: '10px' } },
      h('span', null, h('i', { style: { background: 'var(--accent-soft)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' } }), 'Committed'),
      h('span', null, h('i', { style: { background: 'var(--good)', borderRadius: '50%' } }), 'Trained'),
      h('span', null, h('i', { style: { background: 'var(--c2)' } }), 'Cardio planned')),
    h('div', { class: 'caltools' },
      h('button', { class: 'btn small', onClick: () => patternSheet(ctx) }, icon('copy', 18), 'Commit a weekly pattern'),
      monthCommitments(state, curMonth.slice(0, 7), today).length ? h('button', { class: 'btn small ghost', style: { color: 'var(--dim)' }, onClick: () => clearMonthSheet(curMonth.slice(0, 7), ctx) }, `Clear ${MONTHS[m.getMonth()]}…`) : null));

  // ---- commitment summary
  const wk = weekStart(today);
  let planned = 0, kept = 0, left = 0;
  for (let d = wk; d < addDays(wk, 7); d = addDays(d, 1)) {
    const on = state.plan[d] && !state.plan[d].deleted && state.plan[d].on;
    if (on) { planned++; if (dayDone(an, d)) kept++; else if (d >= today) left++; }
  }
  let streak = 0;
  for (let w = addDays(wk, -7); streak < 104; w = addDays(w, -7)) {
    let p = 0, k = 0;
    for (let d = w; d < addDays(w, 7); d = addDays(d, 1)) { if (state.plan[d]?.on && !state.plan[d].deleted) { p++; if (dayDone(an, d)) k++; } }
    if (p > 0 && k === p) streak++; else break;
  }
  const upcoming = Object.values(state.plan).filter(p => !p.deleted && p.on && p.date >= today).sort((a, b) => a.date < b.date ? -1 : 1);
  const commitPanel = h('div', { class: 'tiles' },
    h('div', { class: 'tile' }, h('div', { class: 'v' }, kept, h('small', null, '/ ' + planned)), h('div', { class: 'k' }, 'Kept this week')),
    h('div', { class: 'tile' }, h('div', { class: 'v' }, upcoming.length), h('div', { class: 'k' }, 'Days committed ahead')),
    h('div', { class: 'tile' }, h('div', { class: 'v' }, streak, h('small', null, streak === 1 ? 'week' : 'weeks')), h('div', { class: 'k' }, 'Full weeks in a row')));

  // ---- auto planner
  const to = addDays(today, range - 1);
  const inRange = upcoming.filter(p => p.date <= to);
  const presets = Object.values(state.presets).filter(p => !p.deleted);
  const planner = h('div', { class: 'panel' },
    h('h2', null, 'Automatic planner'),
    h('p', { class: 'note', style: { marginBottom: '12px' } }, 'Plans each week as a whole for the most muscle growth: it spreads every muscle\'s sets over your days, puts muscles far from their target first, waits for tired muscles and keeps your legs fresh for runs. Sessions fit your time. Days you filled by hand are respected. ',
      h('a', { href: '#more', onClick: e => { e.preventDefault(); ctx.go('more', 'science'); } }, 'How it decides')),
    h('div', { class: 'stack' },
      seg([{ id: 7, name: 'Next 7 days' }, { id: 14, name: '14 days' }, { id: 28, name: '4 weeks' }, { id: HORIZON, name: 'All' }], range, v => { range = v; ctx.refresh(); }),
      presets.length ? seg([{ id: 'exercises', name: 'Build from my exercises' }, { id: 'presets', name: 'Hand out my presets' }], settings.planMode || 'exercises', v => setSetting('planMode', v)) : null,
      (() => { const pool = myExercises(state).filter(e => e.kind === 'strength'); const on = pool.filter(e => e.plan !== false).length; const bl = Object.values(state.blocks).filter(b => !b.deleted && b.plan !== false).length;
        return h('button', { class: 'row', style: { width: '100%', textAlign: 'left', minHeight: '44px' }, onClick: () => poolSheet(ctx) },
          h('span', { class: 'grow' }, 'What the planner may use', h('div', { class: 'note tiny' }, `${on} of ${pool.length} exercises, ${bl} ${bl === 1 ? 'block' : 'blocks'}`)), h('span', { class: 'tag acc' }, 'Choose'), icon('right', 16)); })(),
      h('button', { class: 'row', style: { width: '100%', textAlign: 'left', minHeight: '44px' }, onClick: () => prioritySheet(ctx) },
        h('span', { class: 'grow' }, 'Goal and priorities', h('div', { class: 'note tiny' }, prioritySummary(settings))), h('span', { class: 'tag acc' }, 'Adjust'), icon('right', 16)),
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Longest session'), h('div', { style: { width: '92px' } }, numInput(settings.maxMinutes, v => { if (v >= 15) setSetting('maxMinutes', v); }, { int: true, 'aria-label': 'Longest session in minutes', style: 'text-align:center' })), h('span', { class: 'dim' }, 'min')),
      h('button', { class: 'btn primary block', disabled: !inRange.length, onClick: e => {
        // planning months ahead takes a moment on a phone: show it, then plan
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Planning…';
        setTimeout(() => {
          const n = runAutoPlan(today, to);
          toast(n ? `Planned ${n} ${n === 1 ? 'day' : 'days'}` : 'No committed days in that range'); ctx.refresh();
        }, 30);
      } }, icon('bolt'), inRange.length ? `Plan ${inRange.length} committed ${inRange.length === 1 ? 'day' : 'days'}` : 'Commit to some days first'),
      plannerNotes.length ? h('div', { class: 'banner info', style: { margin: 0 } }, icon('info'), h('div', null, plannerNotes.map(n => h('div', null, n)))) : null));

  // ---- the next 7 days by muscle (muscles count any 7 days in a row, not calendar weeks)
  const projWeek = today;
  const proj = weekProjection(state, an, projWeek, today);
  const rows = MUSCLES.map(mu => ({ mu, t: muscleTarget(settings, mu.id), ...proj[mu.id] })).filter(r => r.t.hi > 0);
  const projection = h('div', { class: 'panel' },
    h('h2', null, 'Next 7 days by muscle', h('span', { class: 'note', style: { fontWeight: 400 } }, 'hard sets: done, planned, target')),
    isDeloadWeek(settings, wk) ? h('div', { class: 'banner info' }, icon('info'), 'This is a lighter week.') : null,
    h('div', null, rows.map(r => {
      const max = Math.max(r.t.hi * 1.35, r.done + r.planned, 1);
      const total = r.done + r.planned;
      return h('div', { class: 'mrow', style: { gridTemplateColumns: '104px 1fr 92px' } },
        h('span', { class: 'nm' }, r.mu.name),
        h('div', { class: 'tbar' },
          h('div', { class: 'band', style: { left: (r.t.lo / max * 100) + '%', width: ((r.t.hi - r.t.lo) / max * 100) + '%' } }),
          h('div', { class: 'fill', style: { width: (r.done / max * 100) + '%' } }),
          r.planned > 0 ? h('div', { class: 'plan', style: { left: (r.done / max * 100) + '%', width: (r.planned / max * 100) + '%' } }) : null),
        h('span', { class: 'st num', style: { fontSize: '14px', color: total < r.t.lo ? 'var(--warn)' : total > r.t.hi * 1.15 ? 'var(--c3)' : 'var(--dim)' } }, `${fmtNum(total, 1)} / ${r.t.lo}–${r.t.hi}`));
    })),
    h('div', { class: 'legend', style: { marginTop: '10px' } },
      h('span', null, h('i', { style: { background: 'var(--c1)' } }), 'Done'), h('span', null, h('i', { style: { background: 'var(--c1)', opacity: 0.4 } }), 'Planned'),
      h('span', null, h('i', { style: { background: 'color-mix(in srgb, var(--good) 26%, transparent)', boxShadow: 'inset 0 0 0 1.5px var(--good)' } }), 'Target range')),
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Targets count any 7 days in a row. The planner checks every such stretch across your plan, including the days you just trained.'));

  // ---- upcoming list
  const up = h('div', null,
    h('div', { class: 'sec' }, 'Coming up'),
    upcoming.length ? h('div', { class: 'panel', style: { padding: '4px 14px' } }, h('div', { class: 'list' }, upcoming.slice(0, 10).map(pd => h('button', { onClick: () => openDaySheet(pd.date, ctx) },
      h('div', { style: { width: '76px', flex: 'none' } }, h('div', { class: 't' }, relDay(pd.date, today)), h('div', { class: 's' }, typeName(pd))),
      h('div', { class: 'grow' }, pd.items?.length ? h('div', { class: 's', style: { color: 'var(--text)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, pd.items.map(i => itemLabel(i).name).join(', ')) : h('div', { class: 's' }, 'Not filled in yet'),
        pd.notes?.length ? h('div', { class: 's', style: { color: 'var(--warn)' } }, pd.notes[0]) : null),
      pd.items?.length ? h('span', { class: 'num dim' }, planMinutes(state, pd.items) + "'") : null, icon('right', 16)))))
      : h('div', { class: 'empty' }, h('b', null, 'No days committed yet'), 'Tap the days you will train on the calendar. You can decide what to do later, or let the planner decide.'));

  root.appendChild(h('div', { class: 'cols wide-left' },
    h('div', null, calendar, h('div', { style: { height: '14px' } }), commitPanel, up),
    h('div', null, h('div', { style: { height: '14px' } }), planner, projection)));
}

// ---------- day editor
export function openDaySheet(date, ctx) {
  const today = ymd();
  const get = () => state.plan[date];
  if (!get() || get().deleted) put('plan', { date, on: true, type: 'auto', items: [] }, 'plan');
  const save = () => { touch(get()); commit('plan'); };
  const settings = getSettings(state);
  sheet({
    title: fmtDate(date, { year: true }),
    onClose: () => ctx.refresh(),
    body: api => {
      const pd = get();
      const presets = Object.values(state.presets).filter(p => !p.deleted);
      const types = TYPES.filter(t => t.id !== 'rest').map(t => ({ id: t.id, name: t.name }));
      const items = pd.items || [];
      const onDay = dayPresets(state, pd);
      const togglePreset = p => {
        if (onDay.includes(p)) pd.items = items.filter(i => i.pre !== p.id);
        else {
          // a day built from presets is exactly those presets: stop the planner adding more on top
          pd.items = [...items.filter(i => i.src !== 'auto'), ...presetItems(state, p)];
          if ((pd.type || 'auto') === 'auto') pd.type = 'custom';
        }
        delete pd.notes; save(); api.render();
      };
      const add = it => { pd.items = [...items, { id: uid('i'), src: 'user', ...it }]; save(); api.render(); };
      return [
        h('label', { class: 'f' }, 'Type of workout'),
        h('div', { class: 'chips' }, types.map(t => h('button', { class: 'chip' + ((pd.type || 'auto') === t.id ? ' on' : ''), onClick: () => {
          pd.type = t.id; pd.items = items.filter(i => i.src !== 'auto'); save();
          if (t.id !== 'custom') { const res = autoPlan(state, analyze(state), { from: date, to: date }); applyPlan(res); }
          api.render();
        } }, t.name))),
        h('label', { class: 'f', style: { marginTop: '14px' } }, 'Presets (tap one or several)'),
        h('div', { class: 'chips' },
          presets.map(p => h('button', { class: 'chip' + (onDay.includes(p) ? ' on' : ''), 'aria-pressed': String(onDay.includes(p)), onClick: () => togglePreset(p) }, p.name)),
          h('button', { class: 'chip', style: { color: 'var(--accent)' }, onClick: () => editPreset(null, p => { if (p) togglePreset(p); else api.render(); }) }, icon('plus', 16), 'New preset')),
        h('p', { class: 'note tiny', style: { margin: '8px 2px 0' } }, pd.type === 'custom' ? 'Custom: only the presets and items you add. The planner leaves this day alone.' : (pd.type || 'auto') === 'auto' ? 'Auto: the planner picks what is most useful that day.' : 'The planner fills this day with exercises that fit the type.'),
        h('div', { class: 'row', style: { marginTop: '14px' } }, h('span', { class: 'grow' }, 'Time available'),
          h('div', { style: { width: '92px' } }, numInput(pd.minutes ?? '', v => { pd.minutes = v >= 10 ? v : undefined; save(); }, { int: true, placeholder: String(settings.maxMinutes), 'aria-label': 'Minutes available', style: 'text-align:center' })), h('span', { class: 'dim' }, 'min')),
        h('div', { class: 'sec' }, 'Workout', items.length ? h('span', { class: 'note', style: { fontWeight: 400 } }, 'about ' + fmtMin(planMinutes(state, items))) : null),
        pd.notes?.length ? h('div', { class: 'banner', style: { fontSize: '13.5px' } }, icon('info'), h('div', null, pd.notes.map(n => h('div', null, n)))) : null,
        items.length ? h('div', null, items.map((it, i) => { const l = itemLabel(it); return h('div', { class: 'plan-item' },
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 500 } }, l.name, MODES[it.mode] ? h('span', { class: 'tag ' + MODES[it.mode].tag, style: { marginLeft: '8px' } }, MODES[it.mode].tag) : null, it.pre && state.presets[it.pre] ? h('span', { class: 'tag acc', style: { marginLeft: '8px' } }, state.presets[it.pre].name) : it.src === 'import' ? h('span', { class: 'tag acc', style: { marginLeft: '8px' } }, it.source || 'imported') : it.src === 'user' ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'by hand') : null),
            l.sub ? h('div', { class: 'note tiny ell' }, l.sub) : null),
          it.k === 'ex' ? h('div', { style: { width: '58px' } }, numInput(it.sets || 3, v => { it.sets = Math.max(1, v || 1); if (it.src === 'auto') it.src = 'user'; save(); }, { int: true, 'aria-label': 'Sets', style: 'text-align:center;min-height:38px' }))
            : it.k === 'cardio' ? h('div', { style: { width: '58px' } }, numInput(it.min ?? '', v => { it.min = v || undefined; save(); }, { int: true, placeholder: 'min', 'aria-label': 'Minutes', style: 'text-align:center;min-height:38px' })) : h('span', { class: 'q' }, l.q),
          i > 0 ? iconBtn('up', 'Move up', () => { const arr = [...items]; arr.splice(i - 1, 0, arr.splice(i, 1)[0]); pd.items = arr; save(); api.render(); }) : h('span', { style: { width: '40px' } }),
          iconBtn('x', 'Remove', () => { pd.items = items.filter(x => x !== it); save(); api.render(); })); }))
          : h('p', { class: 'note' }, 'Empty. Add things yourself, or let the planner fill the day.'),
        h('div', { class: 'row', style: { marginTop: '10px' } },
          h('button', { class: 'btn small grow', onClick: () => pickExercise({ kind: 'strength', onPick: ex => add({ k: 'ex', ex: ex.id, sets: settings.setsPerExercise }) }) }, icon('plus'), 'Exercise'),
          h('button', { class: 'btn small grow', onClick: () => pickBlock(b => add({ k: 'block', block: b.id, rounds: b.rounds })) }, icon('plus'), 'Block'),
          h('button', { class: 'btn small grow', onClick: () => pickExercise({ kind: 'cardio', title: 'Add cardio', onPick: ex => add({ k: 'cardio', ex: ex.id, min: 30, rpe: 4 }) }) }, icon('plus'), 'Cardio')),
        pd.type !== 'custom' ? h('button', { class: 'btn block', style: { marginTop: '10px' }, onClick: () => { const res = autoPlan(state, analyze(state), { from: date, to: date }); applyPlan(res); api.render(); toast('Day planned'); } }, icon('bolt'), 'Fill this day automatically') : null,
        h('div', { style: { marginTop: '14px' } }, field('Note', h('input', { type: 'text', value: pd.note || '', placeholder: 'e.g. short on time, hotel gym', onInput: e => { pd.note = e.target.value; save(); } }))),
        h('div', { class: 'row', style: { marginTop: '14px' } },
          h('div', { class: 'grow' }, field('Move to another day', h('input', { type: 'date', min: today, max: addDays(today, HORIZON), value: date, onChange: e => {
            const nd = e.target.value; if (!nd || nd === date) return;
            if (state.plan[nd] && !state.plan[nd].deleted && state.plan[nd].on) { toast('That day is already committed.'); e.target.value = date; return; }
            const moved = { ...pd, date: nd }; delete moved.notes; put('plan', moved, 'plan'); del('plan', date, 'plan'); api.close(); toast(`Moved to ${fmtDate(nd)}`);
          } })))),
      ];
    },
    footer: api => [
      h('button', { class: 'btn danger', onClick: () => { del('plan', date, 'plan'); api.close(); toast('Day removed from your plan'); } }, 'Remove day'),
      date <= today ? h('button', { class: 'btn primary', onClick: () => { api.close(); ctx.openDate(date); } }, 'Open in Today') : h('button', { class: 'btn primary', onClick: () => api.close() }, 'Done'),
    ],
  });
}

// ---------- the pool of exercises and blocks the planner draws from
function poolSheet(ctx) {
  const setFlag = (id, v) => { const u = state.ex[id] || { id }; u.plan = v; put('ex', u, 'library'); };
  sheet({
    title: 'What the planner may use',
    onClose: () => ctx.refresh(),
    body: api => {
      const pool = myExercises(state).filter(e => e.kind === 'strength').sort((a, b) => a.name.localeCompare(b.name));
      const blocks = Object.values(state.blocks).filter(b => !b.deleted);
      return [
        h('p', { class: 'note', style: { marginBottom: '6px' } }, 'The planner only picks from what is switched on here. Exercises you leave off can still be logged and added by hand.'),
        h('div', { class: 'row', style: { margin: '8px 0' } },
          h('button', { class: 'btn small grow', onClick: () => { pool.forEach(e => { if (e.plan === false) setFlag(e.id, true); }); api.render(); } }, 'All on'),
          h('button', { class: 'btn small grow', onClick: () => pickExercise({ kind: 'strength', title: 'Add to my exercises', exclude: pool.map(e => e.id), onPick: () => api.render() }) }, icon('plus'), 'Add exercise')),
        h('div', { class: 'sec', style: { marginTop: '12px' } }, 'Exercises'),
        pool.length ? h('div', { class: 'list' }, pool.map(e => h('div', null,
          h('span', { class: 'grow' }, h('div', { class: 't' }, e.name, e.needsSetup ? h('span', { class: 'tag warn', style: { marginLeft: '8px' } }, 'set muscles') : null), h('div', { class: 's ell' }, muscleSummary(e))),
          toggle(e.plan !== false, v => setFlag(e.id, v), `Planner may use ${e.name}`))))
          : h('p', { class: 'note' }, 'Your exercise list is empty. Add the exercises you do first.'),
        h('div', { class: 'sec' }, 'Blocks'),
        blocks.length ? h('div', { class: 'list' }, blocks.map(b => h('div', null,
          h('span', { class: 'grow' }, h('div', { class: 't' }, b.name), h('div', { class: 's ell' }, b.exIds.map(exName).join(', '))),
          toggle(b.plan !== false, v => { b.plan = v; put('blocks', b, 'library'); }, `Planner may use ${b.name}`))))
          : h('p', { class: 'note' }, 'No blocks yet.'),
        h('button', { class: 'btn small block', style: { marginTop: '10px' }, onClick: () => editBlock(null, () => api.render()) }, icon('plus'), 'New block'),
      ];
    },
    footer: api => [h('button', { class: 'btn primary', onClick: () => api.close() }, 'Done')],
  });
}

// ---------- goal and priorities for the automatic planner
const GOALS = [
  { id: 'size', name: 'Muscle size', facts: [['8–15', 'reps'], ['near your limit', 'effort'], ['weekly sets', 'what counts']],
    text: 'Every muscle gets its weekly hard sets, each set ending close to your limit. For growth the number of hard sets matters most; how heavy the weight is matters little.' },
  { id: 'strength', name: 'Strength', facts: [['3 × 3–6', 'main lifts'], ['80–85%', 'of your best'], ['twice a week', 'per lift']],
    text: 'Up to three big lifts go first in the session, heavy, with longer rests, and each comes back twice a week when your days allow. The time left builds muscle as usual.' },
  { id: 'power', name: 'Power', facts: [['4 × 3–5', 'main lifts'], ['about 55%', 'of your best'], ['as fast as you can', 'every rep']],
    text: 'Up to two big lifts go first, moved fast and stopped well before you tire, and only on fresh muscles. The time left builds muscle as usual.' },
];
const SLIDERS = [
  { key: 'focusBody', name: 'Body focus', left: 'Lower body', right: 'Upper body', stops: ['Lower body', 'Leaning lower', 'Balanced', 'Leaning upper', 'Upper body'],
    text: v => v === 0 ? 'Weekly targets as you set them.' : `${v > 0 ? 'Upper' : 'Lower'} body targets up ${Math.abs(v) * 15}%, ${v > 0 ? 'lower' : 'upper'} body down ${Math.abs(v) * 15}%. Core stays the same.` },
  { key: 'focusMix', name: 'Kind of exercises', left: 'Big lifts', right: 'Isolation', stops: ['Big lifts', 'Mostly big lifts', 'Mixed', 'Mostly isolation', 'Isolation'],
    text: v => v === 0 ? 'A mix of big multi-joint lifts and single-muscle work.' : v < 0 ? 'Prefers big multi-joint lifts: fewer exercises, more muscles trained by each.' : 'Prefers single-muscle exercises: easier on joints and on the whole body, but takes more time.' },
  { key: 'focusBlocks', name: 'Blocks and supersets', left: 'Straight sets', right: 'More blocks', stops: ['Straight sets', 'Fewer blocks', 'When they fit', 'More blocks', 'Blocks first'],
    text: v => v === 0 ? 'Uses your blocks when they are the best use of the time.' : v < 0 ? 'Prefers normal sets with full rests. Blocks are used rarely.' : 'Prefers your blocks: more work in less time, with shorter rests.' },
  { key: 'focusRecovery', name: 'Recovery', left: 'Only when fresh', right: 'Train through', stops: ['Only when fresh', 'Cautious', 'Balanced', 'Push a little', 'Train through'],
    text: v => v === 0 ? 'Trains a muscle again once most of its load has faded.' : v < 0 ? 'Waits longer before training a muscle again.' : 'Also trains muscles that are still partly loaded. Useful when running keeps your legs loaded most days. Pain ratings are always respected.' },
];
function prioritySummary(settings) {
  const parts = [GOALS.find(g => g.id === settings.planGoal)?.name || 'Muscle size'];
  for (const sl of SLIDERS) { const v = settings[sl.key] || 0; if (v) parts.push(sl.stops[v + 2].toLowerCase()); }
  return parts.length === 1 ? parts[0] + ', everything else balanced' : parts.join(', ');
}
function prioritySheet(ctx) {
  sheet({
    title: 'Goal and priorities',
    onClose: () => ctx.refresh(),
    body: api => {
      const st = getSettings(state);
      const goal = GOALS.find(g => g.id === st.planGoal) || GOALS[0];
      const changed = st.planGoal !== 'size' || SLIDERS.some(sl => st[sl.key]);
      return [
        h('label', { class: 'f' }, 'What the planner puts first'),
        seg(GOALS.map(g => ({ id: g.id, name: g.name })), goal.id, v => { setSetting('planGoal', v); api.render(); }),
        h('div', { class: 'goalbox' },
          h('div', { class: 'gl' }, goal.facts.map(([v, k]) => h('div', null, v, h('small', null, k)))),
          h('div', { class: 'dim' }, goal.text)),
        h('div', { class: 'sec' }, 'Priorities'),
        SLIDERS.map(sl => {
          const v = st[sl.key] || 0;
          const stop = h('span', null, sl.stops[v + 2]), txt = h('div', { class: 'pt' }, sl.text(v));
          return h('div', { class: 'prio' },
            h('div', { class: 'ph' }, h('b', null, sl.name), stop),
            slider(v, nv => { setSetting(sl.key, nv); stop.textContent = sl.stops[nv + 2]; txt.textContent = sl.text(nv); }, { left: sl.left, right: sl.right, label: sl.name, text: nv => sl.stops[nv + 2] }),
            txt);
        }),
        h('p', { class: 'note tiny', style: { marginTop: '4px' } }, 'These change what the planner builds from your exercises. Days you filled by hand, presets and your time limit are always respected. Plan your days again to see the effect.'),
        changed ? h('button', { class: 'btn small block', style: { marginTop: '12px' }, onClick: () => { setSetting('planGoal', 'size'); for (const sl of SLIDERS) setSetting(sl.key, 0); api.render(); } }, 'Back to muscle size, balanced') : null,
      ];
    },
    footer: api => [h('button', { class: 'btn primary', onClick: () => api.close() }, 'Done')],
  });
}

// ---------- commit many days at once from a weekly pattern
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function patternSheet(ctx) {
  const today = ymd(), limit = addDays(today, HORIZON);
  const saved = getSettings(state).commitPattern;
  let pattern = saved && Object.keys(saved).length ? { ...saved } : { ...PATTERNS[0].days };
  let weeks = 4;
  const thisWeek = patternFromWeek(state, weekStart(today));
  const presets = Object.values(state.presets).filter(p => !p.deleted);
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  sheet({
    title: 'Commit a weekly pattern',
    body: api => {
      const res = patternDays(state, pattern, today, weeks, limit);
      const starts = [...PATTERNS.map(p => ({ name: p.name, days: p.days })), ...(Object.keys(thisWeek).length ? [{ name: 'Same as this week', days: thisWeek }] : [])];
      return [
        h('p', { class: 'note', style: { marginBottom: '12px' } }, 'Choose the weekdays you train and what each one is for. Those days are committed for the weeks ahead in one go. You can still tap any single day on the calendar to change or remove it.'),
        h('label', { class: 'f' }, 'Start from'),
        h('div', { class: 'chips' }, starts.map(p => h('button', { class: 'chip' + (same(p.days, pattern) ? ' on' : ''), onClick: () => { pattern = { ...p.days }; api.render(); } }, p.name))),
        h('div', { class: 'sec' }, 'Your week'),
        WEEKDAYS.map((name, i) => h('div', { class: 'wdrow' + (pattern[i] ? ' on' : '') }, h('span', null, name),
          h('select', { 'aria-label': name, onChange: e => { if (e.target.value) pattern[i] = e.target.value; else delete pattern[i]; api.render(); } },
            h('option', { value: '', selected: !pattern[i] }, 'Not training'),
            TYPES.filter(t => t.id !== 'rest' && t.id !== 'custom').map(t => h('option', { value: t.id, selected: pattern[i] === t.id }, t.id === 'auto' ? 'Planner decides' : t.name)),
            presets.map(p => h('option', { value: 'preset:' + p.id, selected: pattern[i] === 'preset:' + p.id }, 'Preset: ' + p.name))))),
        h('label', { class: 'f', style: { marginTop: '14px' } }, 'For how long'),
        seg([{ id: 2, name: '2 weeks' }, { id: 4, name: '4 weeks' }, { id: 8, name: '8 weeks' }, { id: 13, name: '3 months' }], weeks, v => { weeks = v; api.render(); }),
        h('div', { class: 'banner info', style: { marginTop: '14px', marginBottom: 0 } }, icon('info'),
          h('div', null, res.add.length ? h('b', null, `Commits ${res.add.length} ${res.add.length === 1 ? 'day' : 'days'}, ${fmtDate(res.add[0].date)} to ${fmtDate(res.add[res.add.length - 1].date)}. `) : h('b', null, Object.keys(pattern).length ? 'Nothing new to commit. ' : 'Pick at least one weekday. '),
            res.kept.length ? `${res.kept.length} ${res.kept.length === 1 ? 'day is' : 'days are'} already committed and ${res.kept.length === 1 ? 'stays' : 'stay'} as ${res.kept.length === 1 ? 'it is' : 'they are'}.` : '')),
      ];
    },
    footer: api => {
      const res = patternDays(state, pattern, today, weeks, limit);
      return [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'),
        h('button', { class: 'btn primary', disabled: !res.add.length, onClick: () => {
          const dates = [];
          for (const d of res.add) { state.plan[d.date] = touch(patternRecord(state, d)); dates.push(d.date); }
          state.settings.commitPattern = { ...pattern }; state.settings._u = Date.now();
          commit('plan'); api.close(); curMonth = dates[0].slice(0, 7) + '-01'; ctx.refresh();
          toast(`Committed ${dates.length} ${dates.length === 1 ? 'day' : 'days'}`, { label: 'Undo', fn: () => { for (const d of dates) del('plan', d, 'plan'); ctx.refresh(); } });
        } }, res.add.length ? `Commit ${res.add.length} ${res.add.length === 1 ? 'day' : 'days'}` : 'Commit')];
    },
  });
}

// ---------- clear a whole month of commitments. Deliberately slow: you have to type the month's name.
function clearMonthSheet(month, ctx) {
  const today = ymd();
  const name = MONTHS[parseYmd(month + '-01').getMonth()];
  const days = monthCommitments(state, month, today);
  if (!days.length) return;
  const filled = days.filter(p => p.items?.length).length;
  const imported = days.filter(p => (p.items || []).some(i => i.src === 'import')).length;
  const byHand = days.filter(p => (p.items || []).some(i => i.src === 'user' || i.pre)).length;
  let typed = '';
  const ok = () => typed.trim().toLowerCase() === name.toLowerCase();
  sheet({
    title: `Clear ${name}?`,
    body: api => [
      h('div', { class: 'dangerbox' },
        h('h3', null, icon('warn', 20), `This removes ${days.length} committed ${days.length === 1 ? 'day' : 'days'}`),
        h('div', null, `${fmtDate(days[0].date)}${days.length > 1 ? ' to ' + fmtDate(days[days.length - 1].date) : ''}, with everything planned on ${days.length === 1 ? 'it' : 'them'}.`),
        h('ul', null,
          filled ? h('li', null, `${filled} ${filled === 1 ? 'has a workout' : 'have workouts'} filled in`) : null,
          byHand ? h('li', null, `${byHand} with presets or items you added by hand`) : null,
          imported ? h('li', null, `${imported} with sessions from an imported plan (runs, for example)`) : null,
          h('li', null, 'Workouts you already logged are not touched'),
          month === today.slice(0, 7) ? h('li', null, 'Days before today stay as they are') : null)),
      h('label', { class: 'f', style: { marginTop: '16px' } }, `To confirm, type the month: ${name.toLowerCase()}`),
      h('input', { type: 'text', autocomplete: 'off', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', enterkeyhint: 'done', placeholder: name.toLowerCase(), 'aria-label': `Type ${name} to confirm`,
        onInput: e => { typed = e.target.value; const b = api.el.querySelector('.destroy'); if (b) { b.disabled = !ok(); b.toggleAttribute('disabled', !ok()); } } }),
      h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'To remove a single day instead, tap it on the calendar and choose Remove day.'),
    ],
    footer: api => [h('button', { class: 'btn primary', onClick: () => api.close() }, 'Keep my plan'),
      h('button', { class: 'btn destroy', disabled: true, onClick: () => {
        if (!ok()) return;
        const copies = days.map(p => JSON.parse(JSON.stringify(p)));
        for (const p of days) state.plan[p.date] = { date: p.date, deleted: true, u: Date.now() };
        commit('plan'); api.close(); ctx.refresh();
        toast(`Cleared ${days.length} ${days.length === 1 ? 'day' : 'days'} in ${name}`, { label: 'Undo', fn: () => { for (const c of copies) state.plan[c.date] = touch(c); commit('plan'); ctx.refresh(); } });
      } }, `Clear ${days.length} ${days.length === 1 ? 'day' : 'days'}`)],
  });
}
