import test from 'node:test';
import assert from 'node:assert/strict';
import { state, _reset } from '../src/store.js';
import { analyze, suggest, getEx, getSettings, muscleTarget, baseTarget, strengthCredit, MODES } from '../src/model.js';
import { autoPlan, planMinutes, weekProjection, patternDays, patternRecord, patternFromWeek, monthCommitments, PATTERNS } from '../src/planner.js';
import { MUSCLE } from '../src/library.js';
import { addDays, weekStart, ymd } from '../src/util.js';

const MINE = ['bench_press', 'incline_db_press', 'seated_row', 'pull_up', 'db_lateral_raise', 'db_curl', 'db_fly', 'db_reverse_fly', 'triceps_pushdown', 'leg_press', 'db_rdl', 'calf_raise', 'crunch', 'run'];
function fresh(settings = {}) {
  _reset();
  for (const id of MINE) state.ex[id] = { id, mine: true, u: 1 };
  state.blocks.b1 = { id: 'b1', name: 'Dumbbell circuit', exIds: ['db_fly', 'db_lateral_raise', 'db_curl', 'db_reverse_fly'], rounds: 3, rest: 30, restRound: 60, plan: true, u: 1 };
  state.settings = { bodyweight: 75, _u: 1, ...settings };
}
function sess(date, items) { const id = 's' + date + Math.random(); state.sessions[id] = { id, date, items, u: 1 }; state._rev++; }
const ex = (id, ...sets) => ({ k: 'ex', ex: id, sets: sets.map(([w, r, f]) => ({ w, r, d: true, f })) });
const commitDays = (from, n, type = 'auto') => { for (let i = 0; i < n; i++) { const d = addDays(from, i); state.plan[d] = { date: d, on: true, type, items: [], u: 1 }; } state._rev++; };
const plan = (from, to, today) => autoPlan(state, analyze(state), { from, to, today });
const setsBy = (res, group) => { let n = 0; for (const d of Object.values(res.days)) for (const it of d.items) { if (it.k !== 'ex') continue; const e = getEx(state, it.ex); for (const [m, c] of Object.entries(e.muscles)) if (MUSCLE[m]?.group === group) n += c * it.sets; } return n; };

test('stimulus: heavy sets count for strength, hard sets for size, fast sets for power', () => {
  fresh();
  sess('2026-10-01', [ex('bench_press', [60, 10], [60, 10], [60, 9])]);          // 75% of best: hard, but not heavy
  sess('2026-10-05', [ex('bench_press', [70, 5], [70, 5], [70, 4])]);            // heavy
  sess('2026-10-09', [ex('bench_press', [40, 4, 'p'], [40, 4, 'p'], [40, 4, 'p'], [30, 8, 'w'])]);   // fast + a warm-up
  const an = analyze(state);
  const d1 = an.days.get('2026-10-01'), d2 = an.days.get('2026-10-05'), d3 = an.days.get('2026-10-09');
  assert.ok(d1.hard > 2.9 && d1.str < 0.1, `moderate day: hard ${d1.hard} str ${d1.str}`);
  assert.ok(d2.str > 2.9, 'heavy day strength ' + d2.str);
  assert.ok(Math.abs(d2.mstr.chest - d2.str) < 1e-9 && d2.mstr.triceps < d2.str, 'per-muscle strength follows the muscle shares');
  assert.equal(d3.pow, 3); assert.equal(d3.str, 0); assert.ok(d3.hard < 0.5, 'fast sets are not hard sets: ' + d3.hard);
  // a fast-only session does not drag the estimated best down
  const hist = an.exHist.get('bench_press');
  assert.equal(hist[2].best, 0); assert.ok(hist[2].noRef);
  assert.equal(an.prs.length, 0);
  const wk = an.weeks.get(weekStart('2026-10-05'));
  assert.ok(wk.str >= d2.str && wk.pow === 3);
  assert.equal(strengthCredit(0.75), 0); assert.equal(strengthCredit(0.8), 1); assert.ok(Math.abs(strengthCredit(0.775) - 0.5) < 1e-9);
});

test('suggest: heavy and fast targets come from the estimated best; heavy work then progresses on its own', () => {
  fresh();
  sess('2026-10-01', [ex('bench_press', [60, 10], [60, 10], [60, 10])]);   // best = 80
  let an = analyze(state);
  const heavy = suggest(state, an, 'bench_press', null, 'strength');
  assert.equal(heavy.target.w, 67.5); assert.equal(heavy.target.r, 4);       // 83% of 80 = 66.4 -> 67.5
  const fast = suggest(state, an, 'bench_press', null, 'power');
  assert.equal(fast.target.w, 45); assert.equal(fast.target.r, 4);           // 55% of 80 = 44
  // per-hand and bodyweight exercises give the number you type
  sess('2026-10-01', [ex('incline_db_press', [20, 10]), ex('pull_up', [0, 8])]);
  an = analyze(state);
  assert.equal(suggest(state, an, 'incline_db_press', null, 'strength').target.w, 22.5);   // 83% of 53.3 total = 44.3 -> 22.1 per hand -> 22.5
  sess('2026-10-01', [ex('db_curl', [10, 10])]);
  an = analyze(state);
  assert.equal(suggest(state, an, 'db_curl', null, 'power').target.w, 7);   // 55% of 26.7 total -> 7.3 per hand -> whole kilos
  const pu = suggest(state, an, 'pull_up', null, 'strength');
  assert.ok(pu.target.w >= 0 && pu.target.w < 15, 'added weight ' + pu.target.w);
  // in heavy territory: one more rep, then more weight
  sess('2026-10-05', [{ ...ex('bench_press', [67.5, 4], [67.5, 4], [67.5, 4]), mode: 'strength' }]);
  an = analyze(state);
  let s = suggest(state, an, 'bench_press', null, 'strength');
  assert.deepEqual([s.target.w, s.target.r], [67.5, 5]);
  sess('2026-10-09', [{ ...ex('bench_press', [67.5, 6], [67.5, 6], [67.5, 6]), mode: 'strength' }]);
  an = analyze(state);
  s = suggest(state, an, 'bench_press', null, 'strength');
  assert.deepEqual([s.target.w, s.target.r], [70, 4]);
  // back to building muscle after heavy work: the usual rep range, from the estimated best
  sess('2026-10-01', [ex('seated_row', [50, 10], [50, 10])]);
  sess('2026-10-09', [{ ...ex('seated_row', [57.5, 4], [57.5, 4], [57.5, 4]), mode: 'strength' }]);
  an = analyze(state);
  const back = suggest(state, an, 'seated_row');
  assert.equal(back.target.r, getEx(state, 'seated_row').repLo); assert.ok(back.target.w < 57.5 && back.target.w >= 45, 'lighter for more reps: ' + back.target.w);
});

test('planner goal: strength puts heavy main lifts first and brings them back; power needs fresh muscles', () => {
  const today = '2026-11-16';   // a Monday
  fresh({ planGoal: 'strength', deloadEvery: 0 });
  for (const d of [0, 2, 4]) state.plan[addDays(today, d)] = { date: addDays(today, d), on: true, type: 'auto', items: [], u: 1 };
  let res = plan(today, addDays(today, 6), today);
  const days = Object.values(res.days);
  for (const d of days) {
    const heavy = d.items.filter(i => i.mode === 'strength');
    assert.ok(heavy.length >= 1 && heavy.length <= 3, 'heavy lifts per day: ' + heavy.length);
    assert.ok(d.items.findIndex(i => !i.mode) === -1 || d.items.findIndex(i => !i.mode) >= heavy.length, 'heavy lifts come first');
    for (const it of heavy) { assert.equal(getEx(state, it.ex).mech, 'compound'); assert.ok(it.sets <= 3 && it.repLo === 3 && it.repHi === 6 && it.rest >= 150); }
    assert.ok(d.minutes <= 75 + 5, 'fits the clock: ' + d.minutes);
  }
  const count = {};
  for (const d of days) for (const it of d.items) if (it.mode) count[it.ex] = (count[it.ex] || 0) + 1;
  assert.ok(Object.values(count).some(n => n === 2), 'at least one lift is trained heavy twice: ' + JSON.stringify(count));
  assert.ok(Object.values(count).every(n => n <= 2));
  // never the same heavy lift two days running, even on a five-day week that trains through fatigue
  state.settings.focusRecovery = 2; for (const d of [0, 1, 2, 3, 4]) state.plan[addDays(today, d)] = { date: addDays(today, d), on: true, type: 'auto', items: [], u: 1 }; state._rev++;
  res = plan(today, addDays(today, 6), today);
  const seen = {};
  for (const date of Object.keys(res.days).sort()) for (const it of res.days[date].items) if (it.mode) { (seen[it.ex] = seen[it.ex] || []).push(date); }
  for (const dates of Object.values(seen)) { assert.ok(dates.length <= 2, 'at most twice a week'); if (dates.length === 2) assert.ok(dates[1] >= addDays(dates[0], 2), 'a day between: ' + dates); }
  state.settings.focusRecovery = 0; state.plan = {}; for (const d of [0, 2, 4]) state.plan[addDays(today, d)] = { date: addDays(today, d), on: true, type: 'auto', items: [], u: 1 };
  // muscle size: no modes at all
  state.settings.planGoal = 'size'; state._rev++;
  res = plan(today, addDays(today, 6), today);
  assert.ok(Object.values(res.days).every(d => d.items.every(i => !i.mode)));
  // power: fast lifts first, 4 sets of 3-5, and they hardly count toward weekly hard sets
  state.settings.planGoal = 'power'; state._rev++;
  res = plan(today, today, today);
  const d0 = res.days[today];
  const fast = d0.items.filter(i => i.mode === 'power');
  assert.ok(fast.length >= 1 && fast.length <= 2 && d0.items[0].mode === 'power');
  assert.ok(fast.every(i => i.sets === 4 && i.repHi === 5));
  assert.ok(d0.items.some(i => !i.mode), 'the rest of the session still builds muscle');
  // tired prime movers: no fast work on them
  sess(addDays(today, -1), [ex('bench_press', [60, 10], [60, 10], [60, 10], [60, 10]), ex('incline_db_press', [20, 10], [20, 10], [20, 10], [20, 10])]);
  res = autoPlan(state, analyze(state), { from: today, to: today, today });
  for (const it of res.days[today].items.filter(i => i.mode === 'power')) assert.ok(!('chest' in getEx(state, it.ex).muscles) || getEx(state, it.ex).muscles.chest < 0.9, 'no fast chest work the day after chest');
});

test('priorities: body focus moves targets and planned sets; mix, blocks and recovery sliders change the plan', () => {
  const today = '2026-11-16';
  const week = () => { for (const d of [0, 1, 3, 4]) state.plan[addDays(today, d)] = { date: addDays(today, d), on: true, type: 'auto', items: [], u: 1 }; };
  fresh({ deloadEvery: 0 }); week();
  const bal = plan(today, addDays(today, 6), today);
  // body focus
  const s0 = getSettings(state);
  assert.deepEqual(muscleTarget(s0, 'chest'), baseTarget(s0, 'chest'));
  state.settings.focusBody = 2; state._rev++;
  const up = getSettings(state);
  assert.ok(muscleTarget(up, 'chest').hi > baseTarget(up, 'chest').hi && muscleTarget(up, 'quads').hi < baseTarget(up, 'quads').hi);
  assert.deepEqual(muscleTarget(up, 'abs'), baseTarget(up, 'abs'));
  const upper = plan(today, addDays(today, 6), today);
  state.settings.focusBody = -2; state._rev++;
  const lower = plan(today, addDays(today, 6), today);
  assert.ok(setsBy(upper, 'upper') > setsBy(bal, 'upper') && setsBy(lower, 'lower') > setsBy(bal, 'lower'), `upper ${setsBy(upper, 'upper')} vs ${setsBy(bal, 'upper')}; lower ${setsBy(lower, 'lower')} vs ${setsBy(bal, 'lower')}`);
  assert.ok(setsBy(upper, 'lower') < setsBy(lower, 'lower'));
  // kind of exercises
  const share = res => { let c = 0, n = 0; for (const d of Object.values(res.days)) for (const it of d.items) if (it.k === 'ex') { n += it.sets; if (getEx(state, it.ex).mech === 'compound') c += it.sets; } return c / n; };
  state.settings.focusBody = 0; state.settings.focusMix = -2; state._rev++;
  const big = share(plan(today, addDays(today, 6), today));
  state.settings.focusMix = 2; state._rev++;
  const iso = share(plan(today, addDays(today, 6), today));
  assert.ok(big > iso, `compound share ${big} vs ${iso}`);
  // blocks
  const nBlocks = res => Object.values(res.days).reduce((a, d) => a + d.items.filter(i => i.k === 'block').length, 0);
  state.settings.focusMix = 0; state.settings.focusBlocks = -2; state._rev++;
  const few = nBlocks(plan(today, addDays(today, 6), today));
  state.settings.focusBlocks = 2; state._rev++;
  const many = nBlocks(plan(today, addDays(today, 6), today));
  assert.ok(many >= few && many >= 1, `blocks ${few} -> ${many}`);
  // recovery: legs trained yesterday; "train through" still plans leg work today, "only when fresh" does not
  state.settings.focusBlocks = 0;
  sess(addDays(today, -1), [ex('leg_press', [100, 10], [100, 10], [100, 10], [100, 10]), ex('db_rdl', [20, 10], [20, 10], [20, 10], [20, 10])]);
  state.plan = {}; state.plan[today] = { date: today, on: true, type: 'lower', items: [], u: 1 };
  const legSets = res => res.days[today].items.reduce((a, it) => a + (it.k === 'ex' && ['leg_press', 'db_rdl'].includes(it.ex) ? it.sets : 0), 0);
  state.settings.focusRecovery = -2; state._rev++;
  const cautious = legSets(autoPlan(state, analyze(state), { from: today, to: today, today }));
  state.settings.focusRecovery = 2; state._rev++;
  const pushy = legSets(autoPlan(state, analyze(state), { from: today, to: today, today }));
  assert.ok(pushy > cautious, `leg sets the day after legs: cautious ${cautious}, train through ${pushy}`);
});

test('weekly pattern: commits the chosen weekdays ahead, leaves committed days alone; a month can be listed for clearing', () => {
  fresh();
  const today = '2026-11-17';   // a Tuesday
  state.presets.p1 = { id: 'p1', name: 'Hip 3', items: [{ k: 'ex', ex: 'db_rdl', sets: 3 }, { k: 'cardio', ex: 'run', min: 30 }], u: 1 };
  state.plan['2026-11-20'] = { date: '2026-11-20', on: true, type: 'custom', items: [{ id: 'x', k: 'cardio', ex: 'run', min: 60, src: 'import' }], u: 1 };
  const pattern = { 0: 'upper', 2: 'lower', 4: 'preset:p1' };   // Mon, Wed, Fri
  const limit = addDays(today, 92);
  const res = patternDays(state, pattern, today, 2, limit);
  // this week from today: Wed 18, (Fri 20 already committed); next week: Mon 23, Wed 25, Fri 27
  assert.deepEqual(res.add.map(d => d.date), ['2026-11-18', '2026-11-23', '2026-11-25', '2026-11-27']);
  assert.deepEqual(res.kept, ['2026-11-20']);
  for (const d of res.add) state.plan[d.date] = patternRecord(state, d);
  assert.equal(state.plan['2026-11-18'].type, 'lower');
  assert.equal(state.plan['2026-11-27'].type, 'custom'); assert.equal(state.plan['2026-11-27'].items.length, 2);
  assert.equal(state.plan['2026-11-20'].items[0].src, 'import');
  // three months never goes past the horizon
  const far = patternDays(state, PATTERNS[0].days, today, 13, limit);
  assert.ok(far.add.every(d => d.date <= limit) && far.add.length > 30);
  // repeating this week
  assert.deepEqual(patternFromWeek(state, weekStart(today)), { 2: 'lower', 4: 'custom' });
  // clearing: only today or later, in that month, and not trained
  state.plan['2026-11-10'] = { date: '2026-11-10', on: true, type: 'auto', items: [], u: 1 };   // past
  state.plan['2026-12-01'] = { date: '2026-12-01', on: true, type: 'auto', items: [], u: 1 };   // other month
  state.plan[today] = { date: today, on: true, type: 'auto', items: [], u: 1 };
  sess(today, [ex('bench_press', [60, 10])]);                                                   // trained today
  const nov = monthCommitments(state, '2026-11', today).map(p => p.date);
  assert.deepEqual(nov, ['2026-11-18', '2026-11-20', '2026-11-23', '2026-11-25', '2026-11-27']);
  assert.deepEqual(monthCommitments(state, '2026-12', today).map(p => p.date), ['2026-12-01']);
  assert.deepEqual(monthCommitments(state, '2026-10', today), []);
});
