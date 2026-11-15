import test from 'node:test';
import assert from 'node:assert/strict';
import { state, _reset, commit } from '../src/store.js';
import { analyze, loadAt, suggest, getEx, loadSeries, hoursToReady, getSettings, hardnessFromRir } from '../src/model.js';
import { autoPlan, planMinutes, weekProjection } from '../src/planner.js';
import { importSetRows, importPlan, parseCardioNote, toDate } from '../src/importers.js';
import { ymd, addDays, weekStart } from '../src/util.js';

function fresh() {
  _reset();
  for (const id of ['incline_db_press', 'seated_row', 'db_lateral_raise', 'db_curl', 'db_fly', 'db_reverse_fly', 'triceps_pushdown', 'pull_up', 'leg_press', 'db_rdl', 'calf_raise', 'crunch', 'run', 'bike'])
    state.ex[id] = { id, mine: true, u: 1 };
  state.blocks.b1 = { id: 'b1', name: 'Dumbbell circuit', exIds: ['db_fly', 'db_lateral_raise', 'db_curl', 'db_reverse_fly'], rounds: 3, rest: 30, restRound: 60, plan: true, u: 1 };
  state.settings = { bodyweight: 75, _u: 1 };
}
function sess(date, items) { const id = 's' + date + Math.random(); state.sessions[id] = { id, date, items, u: 1 }; state._rev++; }
const ex = (id, ...sets) => ({ k: 'ex', ex: id, sets: sets.map(([w, r, f]) => ({ w, r, d: true, f })) });

test('weight-adjusted volume: heavy reps count for more than light reps at equal volume', () => {
  fresh();
  const d0 = '2026-10-01';
  for (let i = 0; i < 5; i++) sess(addDays(d0, i * 3), [ex('leg_press', [60, 10], [60, 10], [60, 10])]);
  sess('2026-10-20', [ex('leg_press', [100, 6])]);   // 600 kg volume, heavy
  sess('2026-10-23', [ex('leg_press', [30, 20])]);   // 600 kg volume, light
  const an = analyze(state);
  const heavy = an.days.get('2026-10-20'), light = an.days.get('2026-10-23');
  assert.equal(heavy.vol, 600); assert.equal(light.vol, 600);
  assert.ok(heavy.wav > 900, 'heavy ' + heavy.wav);
  assert.ok(light.wav < 320, 'light ' + light.wav);
  // at the usual weight, WAV equals plain volume
  const usual = an.days.get(addDays(d0, 12));
  assert.ok(Math.abs(usual.wav - usual.vol) < 1e-6);
});

test('hard sets: warm-ups do not count, sets near failure do', () => {
  fresh();
  sess('2026-11-01', [ex('incline_db_press', [27.5, 11], [27.5, 10])]);
  sess('2026-11-05', [ex('incline_db_press', [15, 26], [22.5, 16], [27.5, 11], [27.5, 10])]);
  const an = analyze(state);
  const sets = an.allSets.filter(s => s.date === '2026-11-05');
  assert.ok(sets[0].hard < 0.2, 'warm-up ' + sets[0].hard);
  assert.ok(sets[2].hard === 1 && sets[3].hard > 0.8);
  const d = an.days.get('2026-11-05');
  assert.ok(d.muscles.chest > 2 && d.muscles.chest < 3.2, 'chest sets ' + d.muscles.chest);
  assert.ok(Math.abs(d.muscles.triceps - d.muscles.chest * 0.5) < 1e-9);
  assert.equal(hardnessFromRir(0), 1); assert.equal(hardnessFromRir(10), 0);
});

test('load builds with work, fades with rest, differs by muscle', () => {
  fresh();
  const today = ymd();
  const d = addDays(today, -1);
  sess(d, [ex('leg_press', [80, 10], [80, 10], [80, 9], [80, 9]), ex('db_curl', [12, 10], [12, 10], [12, 9], [12, 9])]);
  const an = analyze(state);
  const t0 = an.events[0].t;
  const l0 = loadAt(an, t0 + 1), l1 = loadAt(an, t0 + 24 * 3600e3), l3 = loadAt(an, t0 + 72 * 3600e3);
  assert.ok(l0.muscles.quads > 4 && l0.muscles.biceps > 3.5);
  assert.ok(l1.muscles.quads < l0.muscles.quads && l3.muscles.quads < l1.muscles.quads);
  // biceps (18 h half-life) clears faster than quads (32 h)
  assert.ok(l1.muscles.biceps / l0.muscles.biceps < l1.muscles.quads / l0.muscles.quads);
  assert.ok(l0.joints.knee > 0 && l0.joints.elbow > 0);
  assert.ok(hoursToReady(getSettings(state), 'quads', l0.muscles.quads) > hoursToReady(getSettings(state), 'biceps', l0.muscles.biceps));
});

test('running loads calves and the Achilles', () => {
  fresh();
  const d = addDays(ymd(), -1);
  sess(d, [{ k: 'cardio', ex: 'run', min: 60, km: 9, rpe: 4, d: true }]);
  const an = analyze(state);
  const l = loadAt(an, an.events[0].t + 1);
  assert.ok(l.joints.achilles > 5, 'achilles ' + l.joints.achilles);
  assert.ok(l.muscles.calves > l.muscles.quads && l.muscles.biceps === 0);
  assert.equal(an.days.get(d).runKm, 9);
});

test('suggest: reps first, then load', () => {
  fresh();
  sess('2026-11-01', [ex('db_curl', [10, 8], [10, 8])]);
  let s = suggest(state, analyze(state), 'db_curl');
  assert.deepEqual([s.target.w, s.target.r], [10, 9]);
  sess('2026-11-04', [ex('db_curl', [10, 15], [10, 15])]);
  s = suggest(state, analyze(state), 'db_curl');
  assert.deepEqual([s.target.w, s.target.r], [11, 10]);
});

test('planner: fills committed days within the time budget and respects recovery', () => {
  fresh();
  const today = ymd(); const wk = weekStart(addDays(today, 7));
  for (const off of [0, 2, 4]) state.plan[addDays(wk, off)] = { date: addDays(wk, off), on: true, type: 'auto', items: [], u: 1 };
  state._rev++;
  const res = autoPlan(state, analyze(state), { from: wk, to: addDays(wk, 6), today });
  const days = Object.keys(res.days).sort();
  assert.equal(days.length, 3);
  for (const d of days) {
    assert.ok(res.days[d].items.length >= 4, d + ' items ' + res.days[d].items.length);
    assert.ok(res.days[d].minutes <= 78, 'minutes ' + res.days[d].minutes);
  }
  // the dumbbell block gets used at least once in the week
  assert.ok(days.some(d => res.days[d].items.some(i => i.k === 'block')));
  // apply and project weekly volume
  for (const d of days) state.plan[d].items = res.days[d].items;
  state._rev++;
  const proj = weekProjection(state, analyze(state), wk, today);
  assert.ok(proj.biceps.planned >= 6, 'biceps ' + proj.biceps.planned);
  assert.ok(proj.quads.planned <= 12.5);
});

test('planner: typed days only get matching exercises; time limit is honoured', () => {
  fresh();
  const today = ymd(); const d = addDays(today, 2);
  state.plan[d] = { date: d, on: true, type: 'legs', minutes: 30, items: [], u: 1 }; state._rev++;
  const res = autoPlan(state, analyze(state), { from: today, to: addDays(today, 6), today });
  const items = res.days[d].items;
  assert.ok(items.length >= 1);
  for (const it of items) assert.ok(['leg_press', 'db_rdl', 'calf_raise'].includes(it.ex), it.ex);
  assert.ok(res.days[d].minutes <= 32);
});

test('planner: Achilles pain 5/10 keeps calf work out and flags a planned run', () => {
  fresh();
  const today = ymd();
  state.pain.p1 = { id: 'p1', t: Date.now(), region: 'achilles', level: 5, u: 1 };
  state.plan[today] = { date: today, on: true, type: 'legs', items: [{ id: 'x', k: 'cardio', ex: 'run', min: 30, src: 'import' }], u: 1 }; state._rev++;
  const res = autoPlan(state, analyze(state), { from: today, to: today, today });
  assert.ok(!res.days[today].items.some(i => i.ex === 'calf_raise'));
  assert.ok(res.days[today].notes.some(n => /Achilles/.test(n)));
  assert.ok(res.days[today].items.some(i => i.ex === 'run'), 'imported run is kept, only flagged');
});

test('importers: Notion rows, cardio notes, plan file', () => {
  fresh();
  const rows = [['ID', 'Exercise', 'Date', 'Weight', 'Reps', 'Day Type', 'Notes'],
    [1, 'Complete Rows', 46332, 65, 12, 'Medium', ''], [2, 'Complete Rows', 46332, 45, 18, '', ''], [3, 'Biceps', 46332, 12.5, 9, '', 'Dropset'],
    [4, 'Cardio', '2026-02-23', 0, 0, 'Cardio', 'Bici 50 min'], [5, 'Tur', '2025-07-31', 0, 0, 'Tur', 'Snøhetta'], [6, 'Pullups', '2026-11-02', 0, 9, '', ''], [7, 'Zottman thing', '2026-11-02', 8, 10, '', ''], [8, 'Biceps', '2026-11-02', 9, null, '', '']];
  const r = importSetRows(rows);
  assert.equal(toDate(46332), '2026-11-06');
  assert.equal(r.sets, 5); assert.equal(r.cardio, 2); assert.equal(r.skipped, 1);
  assert.deepEqual(r.created, ['Zottman thing']);
  assert.equal(getEx(state, 'seated_row').name, 'Complete Rows');
  assert.equal(getEx(state, 'db_curl').name, 'Biceps');
  importSetRows([['Exercise', 'Date', 'Weight', 'Reps'], ['Leg Extension', '2026-11-03', 40, 12]]);
  assert.equal(getEx(state, 'leg_extension').mine, true);
  const bike = state.sessions['imp-2026-02-23'].items[0];
  assert.equal(bike.ex, 'bike'); assert.equal(bike.min, 50);
  assert.equal(state.sessions['imp-2025-07-31'].items[0].ex, 'hike');
  assert.deepEqual(parseCardioNote('1h bici', 'cardio_other'), { ex: 'bike', min: 60, km: 0 });
  assert.equal(parseCardioNote('Correr treadmill 30 min').ex, 'treadmill_run');
  const an = analyze(state);
  assert.ok(an.days.get('2026-11-02').muscles.lats > 0.9); // pull-ups at bodyweight count
  // re-import must not duplicate
  importSetRows(rows);
  assert.equal(Object.values(state.sessions).filter(s => !s.deleted).length, 5);

  const p = importPlan({ styrke: 'plan', source: 'marathon', sessions: [
    { date: '2027-01-05', kind: 'run', name: 'Easy run', minutes: 35, effort: 3 },
    { date: '2027-01-05', kind: 'strength', type: 'lower', items: [{ exercise: 'Leg Press', sets: 3, reps: '8-12' }] },
    { date: '2027-01-06', kind: 'strength', type: 'pull' }] });
  assert.equal(p.days, 2); assert.equal(p.added, 2);
  assert.equal(state.plan['2027-01-05'].items.length, 2);
  assert.equal(state.plan['2027-01-06'].type, 'pull');
  const p2 = importPlan({ styrke: 'plan', source: 'marathon', replace: { from: '2027-01-01', to: '2027-01-31' }, sessions: [{ date: '2027-01-05', kind: 'run', minutes: 40 }] });
  assert.equal(p2.removed, 2);
  assert.equal(state.plan['2027-01-05'].items.length, 1);
});

test('whole-body load series has acute and chronic averages', () => {
  fresh();
  const today = ymd();
  for (let i = 30; i >= 1; i -= 2) sess(addDays(today, -i), [ex('seated_row', [60, 10], [60, 10], [60, 10])]);
  const s = loadSeries(analyze(state), addDays(today, -28), today);
  assert.equal(s.length, 29);
  assert.ok(s.at(-1).acute > 0 && s.at(-1).chronic > 0 && s.at(-1).ratio > 0.5 && s.at(-1).ratio < 1.6);
});
