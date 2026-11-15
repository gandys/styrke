// Plan: commit to training days on a calendar (up to three months ahead), give days a type or
// leave them open, and let the planner fill them.

import { h, icon, iconBtn, sheet, toast, confirmSheet, seg, field, numInput, toggle } from '../ui.js';
import { state, put, del, commit, touch, setSetting, sessionsOn } from '../store.js';
import { analyze, getSettings, muscleTarget, isDeloadWeek } from '../model.js';
import { autoPlan, planMinutes, weekProjection } from '../planner.js';
import { MUSCLES, TYPES, TYPE } from '../library.js';
import { ymd, addDays, parseYmd, weekStart, MONTHS, DOW_SHORT, fmtDate, relDay, diffDays, fmtMin, fmtNum, uid } from '../util.js';
import { pickExercise, pickBlock, itemLabel, exName } from './common.js';

const HORIZON = 92; // days ahead you can commit to
let curMonth = null;
let range = 14;

function typeName(pd) {
  if (!pd) return '';
  if (pd.type?.startsWith('preset:')) return state.presets[pd.type.slice(7)]?.name || 'Preset';
  return TYPE[pd.type || 'auto']?.name || 'Auto';
}
function shortLabel(pd) {
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
export function runAutoPlan(from, to) {
  const res = autoPlan(state, analyze(state), { from, to });
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
      h('span', null, h('i', { style: { background: 'var(--c2)' } }), 'Cardio planned')));

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
  const to = range === 7 ? addDays(wk, 6) : addDays(today, range - 1);
  const inRange = upcoming.filter(p => p.date <= to);
  const presets = Object.values(state.presets).filter(p => !p.deleted);
  const planner = h('div', { class: 'panel' },
    h('h2', null, 'Automatic planner'),
    h('p', { class: 'note', style: { marginBottom: '12px' } }, 'Fills your committed days so each muscle gets its weekly sets, is trained once it has recovered, and the session fits your time. Days you typed or filled by hand are respected.'),
    h('div', { class: 'stack' },
      seg([{ id: 7, name: 'This week' }, { id: 14, name: 'Next 14 days' }, { id: 28, name: '4 weeks' }, { id: HORIZON, name: 'All' }], range, v => { range = v; ctx.refresh(); }),
      presets.length ? seg([{ id: 'exercises', name: 'Build from my exercises' }, { id: 'presets', name: 'Hand out my presets' }], settings.planMode || 'exercises', v => setSetting('planMode', v)) : null,
      h('div', { class: 'row' }, h('span', { class: 'grow' }, 'Longest session'), h('div', { style: { width: '92px' } }, numInput(settings.maxMinutes, v => { if (v >= 15) setSetting('maxMinutes', v); }, { int: true, 'aria-label': 'Longest session in minutes', style: 'text-align:center' })), h('span', { class: 'dim' }, 'min')),
      h('button', { class: 'btn primary block', disabled: !inRange.length, onClick: () => {
        const n = runAutoPlan(today, to);
        toast(n ? `Planned ${n} ${n === 1 ? 'day' : 'days'}` : 'No committed days in that range'); ctx.refresh();
      } }, icon('bolt'), inRange.length ? `Plan ${inRange.length} committed ${inRange.length === 1 ? 'day' : 'days'}` : 'Commit to some days first')));

  // ---- week projection
  const projWeek = wk;
  const proj = weekProjection(state, an, projWeek, today);
  const rows = MUSCLES.map(mu => ({ mu, t: muscleTarget(settings, mu.id), ...proj[mu.id] })).filter(r => r.t.hi > 0);
  const projection = h('div', { class: 'panel' },
    h('h2', null, 'This week by muscle', h('span', { class: 'note', style: { fontWeight: 400 } }, 'hard sets: done, planned, target')),
    isDeloadWeek(settings, projWeek) ? h('div', { class: 'banner info' }, icon('info'), 'This is a lighter week.') : null,
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
      h('span', null, h('i', { style: { background: 'color-mix(in srgb, var(--good) 26%, transparent)', boxShadow: 'inset 0 0 0 1.5px var(--good)' } }), 'Target range')));

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
      const types = [...TYPES.filter(t => t.id !== 'rest').map(t => ({ id: t.id, name: t.name })), ...presets.map(p => ({ id: 'preset:' + p.id, name: p.name }))];
      const items = pd.items || [];
      const add = it => { pd.items = [...items, { id: uid('i'), src: 'user', ...it }]; save(); api.render(); };
      return [
        h('label', { class: 'f' }, 'Type of workout'),
        h('div', { class: 'chips' }, types.map(t => h('button', { class: 'chip' + ((pd.type || 'auto') === t.id ? ' on' : ''), onClick: () => {
          pd.type = t.id; pd.items = items.filter(i => i.src !== 'auto'); save();
          if (t.id !== 'custom') { const res = autoPlan(state, analyze(state), { from: date, to: date }); applyPlan(res); }
          api.render();
        } }, t.name))),
        h('p', { class: 'note tiny', style: { margin: '8px 2px 0' } }, pd.type === 'custom' ? 'Custom: only what you add by hand. The planner leaves this day alone.' : (pd.type || 'auto') === 'auto' ? 'Auto: the planner picks what is most useful that day.' : 'The planner fills this day with exercises that fit the type.'),
        h('div', { class: 'row', style: { marginTop: '14px' } }, h('span', { class: 'grow' }, 'Time available'),
          h('div', { style: { width: '92px' } }, numInput(pd.minutes ?? '', v => { pd.minutes = v >= 10 ? v : undefined; save(); }, { int: true, placeholder: String(settings.maxMinutes), 'aria-label': 'Minutes available', style: 'text-align:center' })), h('span', { class: 'dim' }, 'min')),
        h('div', { class: 'sec' }, 'Workout', items.length ? h('span', { class: 'note', style: { fontWeight: 400 } }, 'about ' + fmtMin(planMinutes(state, items))) : null),
        pd.notes?.length ? h('div', { class: 'banner', style: { fontSize: '13.5px' } }, icon('info'), h('div', null, pd.notes.map(n => h('div', null, n)))) : null,
        items.length ? h('div', null, items.map((it, i) => { const l = itemLabel(it); return h('div', { class: 'plan-item' },
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 500 } }, l.name, it.src === 'import' ? h('span', { class: 'tag acc', style: { marginLeft: '8px' } }, it.source || 'imported') : it.src === 'user' ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'by hand') : null),
            l.sub ? h('div', { class: 'note tiny ell' }, l.sub) : null),
          it.k === 'ex' ? h('div', { style: { width: '58px' } }, numInput(it.sets || 3, v => { it.sets = Math.max(1, v || 1); if (it.src === 'auto') it.src = 'user'; save(); }, { int: true, 'aria-label': 'Sets', style: 'text-align:center;min-height:38px' }))
            : it.k === 'cardio' ? h('div', { style: { width: '58px' } }, numInput(it.min ?? '', v => { it.min = v || undefined; save(); }, { int: true, placeholder: 'min', 'aria-label': 'Minutes', style: 'text-align:center;min-height:38px' })) : h('span', { class: 'q' }, l.q),
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
