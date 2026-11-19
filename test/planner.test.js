import test from 'node:test';
import assert from 'node:assert/strict';
import { state, _reset } from '../src/store.js';
import { analyze, getEx, getSettings, muscleTarget } from '../src/model.js';
import { autoPlan, planDayEvent, weekValue, weekMarginal, sessionValue } from '../src/planner.js';
import { MUSCLE } from '../src/library.js';
import { addDays } from '../src/util.js';

const MINE = ['incline_db_press', 'db_fly', 'db_lateral_raise', 'cable_lateral_raise', 'db_reverse_fly', 'pull_up', 'seated_row', 'db_shrug', 'db_curl', 'triceps_pushdown', 'overhead_triceps_ext', 'leg_press', 'db_rdl', 'calf_raise', 'crunch', 'run'];
const MON = '2026-11-09';   // in the past: logged work is never placed in the future
function fresh(settings = {}) {
  _reset();
  for (const id of MINE) state.ex[id] = { id, mine: true, u: 1 };
  state.blocks.b1 = { id: 'b1', name: 'Dumbbell circuit', exIds: ['db_fly', 'db_lateral_raise', 'db_curl', 'db_reverse_fly'], rounds: 3, rest: 30, restRound: 60, plan: true, u: 1 };
  state.settings = { bodyweight: 75, _u: 1, ...settings };
  // a few weeks of history so the model knows the exercises
  for (let w = 1; w <= 3; w++) {
    const d = addDays(MON, -7 * w);
    const ex = (id, wgt, r) => ({ k: 'ex', ex: id, sets: [1, 2, 3].map(() => ({ w: wgt, r, d: true })) });
    state.sessions['s' + w] = { id: 's' + w, date: d, items: [ex('incline_db_press', 24, 10), ex('seated_row', 55, 10), ex('leg_press', 70, 10), ex('db_curl', 10, 10)], u: 1 };
  }
}
const commit = (days) => { for (const [off, type, items] of days) state.plan[addDays(MON, off)] = { date: addDays(MON, off), on: true, type, items: items || [], u: 1 }; state._rev++; };
const plan = () => autoPlan(state, analyze(state), { from: MON, to: addDays(MON, 6), today: MON });
const daySets = (res, date) => planDayEvent(state, { date, items: res.days[date].items }).sets;
const run = (min) => ({ id: 'r' + min, k: 'cardio', ex: 'run', min, rpe: 4, src: 'import' });

test('growth model: diminishing returns per week and per session', () => {
  // every extra set is worth less than the one before, and past the band it turns into a cost
  let prev = Infinity;
  for (let w = 0; w <= 16; w += 0.5) { const m = weekMarginal(w, 10, 16); assert.ok(m <= prev + 1e-9); prev = m; }
  assert.ok(weekMarginal(0, 10, 16) > 2 * weekMarginal(10, 10, 16), 'first sets count far more');
  assert.ok(weekMarginal(21, 10, 16) < 0, 'well past the band, more sets cost');
  assert.ok(Math.abs((weekValue(8.001, 10, 16) - weekValue(8, 10, 16)) / 0.001 - weekMarginal(8, 10, 16)) < 1e-3, 'value and marginal agree');
  assert.equal(sessionValue(6), 6); assert.ok(sessionValue(10) < 9 && sessionValue(20) < 10.1);
});

test('spreads each muscle over the week instead of piling it on one day', () => {
  fresh(); commit([[0, 'auto'], [2, 'auto'], [4, 'auto']]);
  const res = plan();
  const days = Object.keys(res.days).sort();
  for (const m of ['chest', 'lats', 'quads', 'biceps', 'triceps']) {
    const per = days.map(d => daySets(res, d)[m] || 0);
    assert.ok(per.filter(x => x > 0.9).length >= 2, `${m} on two days or more: ${per}`);
    assert.ok(Math.max(...per) <= 9, `${m} not piled on one day: ${per}`);
  }
  for (const d of days) assert.ok(res.days[d].minutes <= getSettings(state).maxMinutes + 2);
});

test('a short week gives every muscle something before topping any up', () => {
  fresh({ maxMinutes: 45 }); commit([[1, 'auto'], [4, 'auto']]);
  const res = plan();
  const wk = res.weeks[MON];
  for (const m of ['chest', 'side_delt', 'lats', 'upper_back', 'biceps', 'triceps', 'quads', 'hamstrings', 'calves', 'abs']) {
    assert.ok(wk[m].eff >= 1.5, `${m} is not left near zero: ${wk[m].eff.toFixed(1)}`);
  }
  for (const m in wk) assert.ok(wk[m].eff <= wk[m].hi + 0.5, `${m} not over its band in a short week`);
});

test('split days use their time; once-a-week muscles get a full session', () => {
  fresh(); commit([[0, 'push'], [2, 'pull'], [4, 'legs']]);
  const res = plan();
  const S = getSettings(state);
  assert.ok(res.days[MON].minutes >= 0.85 * S.maxMinutes, 'push day uses its time: ' + res.days[MON].minutes);
  assert.ok(res.days[addDays(MON, 2)].minutes >= 0.75 * S.maxMinutes, 'pull day uses its time: ' + res.days[addDays(MON, 2)].minutes);
  const push = daySets(res, MON);
  assert.ok(push.chest >= 6 && push.triceps >= 6, 'enough for a once-a-week muscle');
});

test('keeps the legs fresh for a long run', () => {
  fresh(); commit([[0, 'auto'], [2, 'auto'], [4, 'auto'], [5, 'custom', [run(90)]]]);
  const res = plan();
  const legs = d => ['quads', 'hamstrings', 'calves'].reduce((a, m) => a + (daySets(res, d)[m] || 0), 0);
  assert.ok(legs(addDays(MON, 4)) < legs(MON), `less leg work the day before the long run: Fri ${legs(addDays(MON, 4))}, Mon ${legs(MON)}`);
  // without the run, Friday's legs are not held back as much
  fresh(); commit([[0, 'auto'], [2, 'auto'], [4, 'auto']]);
  const free = plan();
  const legsFree = ['quads', 'hamstrings', 'calves'].reduce((a, m) => a + (planDayEvent(state, { date: addDays(MON, 4), items: free.days[addDays(MON, 4)].items }).sets[m] || 0), 0);
  assert.ok(legsFree > legs(addDays(MON, 4)), `the run is what moves it: ${legsFree} vs ${legs(addDays(MON, 4))}`);
});

test('stops when more sets no longer pay, even with time left', () => {
  fresh({ maxMinutes: 150 }); commit([[0, 'auto'], [1, 'auto'], [2, 'auto'], [3, 'auto'], [4, 'auto']]);
  const res = plan();
  for (const [m, x] of Object.entries(res.weeks[MON])) assert.ok(x.eff <= x.hi + 4, `${m} ${x.eff.toFixed(1)} stays near its band (${x.hi})`);
  const used = Object.values(res.days).reduce((a, d) => a + d.minutes, 0);
  assert.ok(used < 5 * 150 * 0.9, 'leaves time unused rather than adding junk: ' + used);
});

test('a tired main muscle holds its whole exercise back', () => {
  fresh({ focusRecovery: -2 });
  state.sessions.y = { id: 'y', date: addDays(MON, -1), items: [{ k: 'ex', ex: 'db_rdl', sets: [1, 2, 3, 4, 5].map(() => ({ w: 30, r: 10, d: true, f: 'h' })) }], u: 1 };
  commit([[0, 'lower']]);
  const res = plan();
  assert.ok(!res.days[MON].items.some(i => i.ex === 'db_rdl'), 'no stiff-leg deadlifts the day after a hard set of them when only fresh muscles count');
});

test('tells you when nothing in your exercises trains a muscle', () => {
  fresh(); delete state.ex.crunch; commit([[0, 'auto']]);
  const res = plan();
  assert.ok(res.notes.some(n => n.includes('Abs')), res.notes.join(' '));
});

test('three months of four days a week plans quickly', () => {
  fresh();
  for (let w = 0; w < 13; w++) for (const o of [0, 1, 3, 4]) { const d = addDays(MON, w * 7 + o); state.plan[d] = { date: d, on: true, type: 'auto', items: [], u: 1 }; }
  state._rev++;
  const t0 = performance.now();
  const res = autoPlan(state, analyze(state), { from: MON, to: addDays(MON, 92), today: MON });
  const ms = performance.now() - t0;
  assert.equal(Object.keys(res.days).length, 52);
  assert.ok(ms < 2500, 'took ' + Math.round(ms) + ' ms');
  for (const d of Object.values(res.days)) assert.ok(d.items.length > 0);
});
