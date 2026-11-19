// Automatic planner. Fills the days you committed to with exercises and blocks so that each
// muscle gets its weekly dose, is trained when it has recovered, and the session fits the clock.

import { MUSCLES, MUSCLE, JOINT, TYPE, fitsType, primaryMuscle } from './library.js';
import { getEx, getSettings, muscleTarget, loadAt, currentPain, cardioUnits, isDeloadWeek, myExercises, MODES, halfLife } from './model.js';
import { addDays, weekStart, parseYmd, ymd, uid, diffDays } from './util.js';

const WORK_SEC = 40;      // time under the bar per set
const FAST_SEC = 20;      // a fast (power) set is short
const FAST_CREDIT = 0.35; // a fast set stops far from your limit: it counts this much toward hard sets and load
const SETUP_SEC = 75;     // walk over, adjust, warm-up feel set
const WARMUP_MIN = 5;

export function itemMinutes(state, it) {
  if (it.k === 'cardio') return it.min || (it.km ? it.km * 6.5 : 30);
  if (it.k === 'block') {
    const b = it.block && state.blocks?.[it.block];
    const exIds = it.exIds || b?.exIds || [];
    const n = exIds.length || 1;
    const rounds = it.rounds || b?.rounds || 3;
    const rest = it.rest ?? b?.rest ?? 30, restRound = it.restRound ?? b?.restRound ?? 60;
    return (rounds * (n * WORK_SEC + (n - 1) * rest + restRound) + 90) / 60;
  }
  const ex = getEx(state, it.ex);
  const sets = it.sets || 3;
  return (sets * ((it.mode === 'power' ? FAST_SEC : WORK_SEC) + (it.rest || ex?.rest || 90)) + SETUP_SEC) / 60;
}

export function planMinutes(state, items) {
  let m = 0, strength = false;
  for (const it of items || []) { m += itemMinutes(state, it); if (it.k !== 'cardio') strength = true; }
  return Math.round(m + (strength ? WARMUP_MIN : 0));
}

function dayTime(date, hour = 18) { const d = parseYmd(date); d.setHours(hour, 0, 0, 0); return d.getTime(); }

/** Expected load from planned items (assumes every planned set is a hard set). */
export function itemEvent(state, it, t) {
  const ev = { t, muscles: {}, joints: {}, sets: {} };
  const addEx = (exId, sets) => {
    const ex = getEx(state, exId); if (!ex) return;
    for (const [m, c] of Object.entries(ex.muscles || {})) { ev.muscles[m] = (ev.muscles[m] || 0) + sets * c * (ex.cost || 1); ev.sets[m] = (ev.sets[m] || 0) + sets * c; }
    for (const [j, c] of Object.entries(ex.joints || {})) ev.joints[j] = (ev.joints[j] || 0) + sets * c * 1.25;
  };
  if (it.k === 'ex') addEx(it.ex, (it.sets || 3) * (it.mode === 'power' ? FAST_CREDIT : 1));
  else if (it.k === 'block') {
    const b = it.block && state.blocks?.[it.block];
    for (const id of (it.exIds || b?.exIds || [])) addEx(id, it.rounds || b?.rounds || 3);
  } else if (it.k === 'cardio') {
    const ex = getEx(state, it.ex); if (!ex) return ev;
    const u = cardioUnits(ex, it.min || (it.km ? it.km * 6.5 : 30), it.rpe || 4);
    for (const [m, c] of Object.entries(ex.muscles || {})) ev.muscles[m] = (ev.muscles[m] || 0) + u * c;
    for (const [j, c] of Object.entries(ex.joints || {})) ev.joints[j] = (ev.joints[j] || 0) + u * c;
  }
  return ev;
}

export function planDayEvent(state, pd) {
  const ev = { t: dayTime(pd.date), muscles: {}, joints: {}, sets: {} };
  for (const it of pd.items || []) {
    const e = itemEvent(state, it, ev.t);
    for (const k of ['muscles', 'joints', 'sets']) for (const m in e[k]) ev[k][m] = (ev[k][m] || 0) + e[k][m];
  }
  return ev;
}

/** A preset turned into plan items for a day. Items remember which preset they came from. */
export function presetItems(state, preset, src = 'preset', extra = {}) {
  const out = [];
  for (const it of preset?.items || []) {
    const base = { id: uid('i'), pre: preset.id, src, ...extra };
    if (it.k === 'ex') { if (getEx(state, it.ex)) out.push({ ...base, k: 'ex', ex: it.ex, sets: it.sets || 3 }); }
    else if (it.k === 'block') { const b = state.blocks?.[it.block]; if (b && !b.deleted) out.push({ ...base, k: 'block', block: it.block, rounds: it.rounds || b.rounds || 3 }); }
    else if (it.k === 'cardio') { if (getEx(state, it.ex)) out.push({ ...base, k: 'cardio', ex: it.ex, min: it.min || undefined, km: it.km || undefined, rpe: it.rpe || 4, name: it.name || (preset.items.length === 1 ? preset.name : undefined) }); }
  }
  return out;
}

/** The presets a planned day is built from, in the order they appear. */
export function dayPresets(state, pd) {
  const out = [];
  for (const it of pd?.items || []) { const p = it.pre && state.presets?.[it.pre]; if (p && !p.deleted && !out.includes(p)) out.push(p); }
  if (!out.length && pd?.type?.startsWith('preset:')) { const p = state.presets?.[pd.type.slice(7)]; if (p && !p.deleted) out.push(p); }
  return out;
}

/** Older data stored a single preset as the day's type. Turn it into items so presets can be stacked. */
export function migratePresetDays(state, today = ymd()) {
  let n = 0;
  for (const pd of Object.values(state.plan || {})) {
    if (pd.deleted || !pd.type?.startsWith('preset:') || pd.date < today) continue;
    const p = state.presets?.[pd.type.slice(7)];
    const kept = (pd.items || []).filter(i => i.src !== 'auto');
    pd.items = p && !p.deleted ? [...kept, ...presetItems(state, p)] : kept;
    pd.type = 'custom'; pd.u = Date.now(); n++;
  }
  return n;
}

/** True once the planned workout for that day has been turned into a logged session. */
export function planStarted(state, date) {
  return Object.values(state.sessions || {}).some(s => !s.deleted && s.date === date && s.fromPlan);
}

/** Future planned days (from `from`, inclusive) as load events, for forecasts. */
export function futureEvents(state, from, to) {
  const out = [];
  for (const pd of Object.values(state.plan || {})) {
    if (pd.deleted || !pd.on || pd.date < from || (to && pd.date > to)) continue;
    if (planStarted(state, pd.date)) continue;   // already logged: do not count it twice
    if (pd.items?.length) out.push(planDayEvent(state, pd));
  }
  return out;
}

/** Pain expected on a future day: assume it eases about one point per day after the first day. */
function painOn(pain, region, daysAhead) {
  const p = pain[region]; if (!p) return 0;
  return Math.max(0, p.level - Math.max(0, daysAhead - 1));
}

/** Pain check for an exercise: 'avoid' | 'caution' | null, plus the region responsible. */
export function painCheck(state, ex, date, settings = getSettings(state), pain = currentPain(state), today = ymd()) {
  let worst = null;
  const ahead = Math.max(0, diffDays(date, today));
  for (const [j, c] of Object.entries(ex?.joints || {})) {
    if (c < 0.35) continue;
    const lvl = painOn(pain, j, ahead);
    if (lvl >= settings.painAvoid) return { level: 'avoid', region: j, pain: lvl };
    if (lvl >= settings.painCaution && !worst) worst = { level: 'caution', region: j, pain: lvl };
  }
  return worst;
}

// ---------- the growth model the planner maximises
// Each piece follows the training research where it exists, and is a reasoned estimate where it does not.

/** Sets for one muscle in one session: full value up to 6, then less and less (about 10 is the ceiling). */
export function sessionValue(s) {
  return s <= 6 ? s : 6 + 4 * (1 - Math.exp(-(s - 6) / 4));
}

/** How well a muscle can be trained when it still carries load f (fraction of capacity): 1 when recovered. */
export function readiness(f, readyAt = 0.25, span = 0.6, floor = 0.2) {
  return f <= readyAt ? 1 : Math.max(floor, 1 - (f - readyAt) / span);
}

/**
 * Value of W effective hard sets in a week for a muscle with target band lo..hi.
 * Growth rises with weekly sets with diminishing returns: the first sets of the week count the most,
 * and each extra set adds less (a logarithmic curve, scaled to the muscle's target). Sets that bring a
 * muscle up to the bottom of its band get a little extra weight, and its first 3 sets of the week a lot more:
 * a muscle left at zero for a week starts to lose what it built, while about a third of the usual sets keeps it. Above the band
 * the gain fades quickly and then turns into a small cost: more fatigue for almost no growth.
 */
const OVER = 1.5, OVER_COST = 0.3, BELOW = 0.3, FIRST = 2, FIRST_SETS = 3;
const midOf = (lo, hi) => Math.max(2, (lo + hi) / 2);
export function weekMarginal(W, lo, hi) {
  const T = midOf(lo, hi);
  if (W <= hi) return 2 / (1 + 2 * W / T) + (W < lo ? BELOW : 0) + (W < Math.min(FIRST_SETS, lo) ? FIRST : 0);
  const d = W - hi;
  return (2 / (1 + 2 * hi / T)) * Math.exp(-d / OVER) - OVER_COST * Math.min(1, d / 2);
}
export function weekValue(W, lo, hi) {
  const T = midOf(lo, hi), below = BELOW * Math.min(W, lo) + FIRST * Math.min(W, FIRST_SETS, lo);
  if (W <= hi) return T * Math.log(1 + 2 * W / T) + below;
  const d = W - hi, mh = 2 / (1 + 2 * hi / T);
  return below + T * Math.log(1 + 2 * hi / T) + mh * OVER * (1 - Math.exp(-d / OVER)) - OVER_COST * (d <= 2 ? d * d / 4 : d - 1);
}

const MAX_SETS = 5;         // sets of one exercise in one session
const SET_WORTH = [1, 1, 1, 0.9, 0.75];   // reps drop as sets of the same exercise pile up
const MIN_GAIN = 0.05;      // stop when the best addition, after its fatigue cost, gains less than this per set
const FATIGUE_COST = 0.12;  // cost of one unit of load (a hard set for one muscle): recovery you spend on it
const RUN_COST = 5;         // cost of load still left in a muscle when a planned run (or other cardio) starts; longer runs weigh more
const SESSION_SETS = 18;    // past this many hard sets in one session, each extra set costs more (the session wears you down)
const SESSION_COST = 0.02;
const sessionCost = n => SESSION_COST * Math.max(0, n - SESSION_SETS) ** 2;

/**
 * Build a plan for every committed day between from and to.
 * Works one calendar week at a time and plans all of that week's days together, so it can
 * spread each muscle's sets over the week instead of filling the first day first.
 * Returns { days: {date: {items, minutes, notes}}, notes, weeks } without touching state.
 */
export function autoPlan(state, an, { from, to, today = ymd() } = {}) {
  const settings = getSettings(state);
  const pain = currentPain(state);
  const pool = myExercises(state).filter(e => e.kind === 'strength' && e.plan !== false);
  const blocks = Object.values(state.blocks || {}).filter(b => !b.deleted && b.plan !== false && b.exIds?.length);
  const presets = Object.values(state.presets || {}).filter(p => !p.deleted);
  const usePresets = settings.planMode === 'presets' && presets.some(p => p.plan !== false);
  const result = { days: {}, notes: [], weeks: {} };
  // priorities
  const goal = MODES[settings.planGoal] ? settings.planGoal : 'size';
  const knob = k => Math.max(-2, Math.min(2, Number(settings[k]) || 0));
  const fMix = knob('focusMix'), fBlocks = knob('focusBlocks'), fRec = knob('focusRecovery');
  const mixOf = ex => 1 + (ex.mech === 'compound' ? -0.15 : 0.15) * fMix;
  const blocksBonus = settings.planBlocksBonus * (1 + 0.2 * fBlocks);
  const readyAt = Math.max(0.1, Math.min(0.6, settings.readyAt + 0.08 * fRec));
  const span = Math.max(0.15, 0.6 + 0.22 * fRec);
  const floor = Math.max(0, 0.2 + 0.1 * fRec);   // "only when fresh": a tired muscle is worth nothing
  const jointLimit = 0.75 + 0.05 * fRec;
  const kappa = FATIGUE_COST * (1 - 0.2 * fRec);
  const lambda = RUN_COST * (1 - 0.25 * fRec);

  const planDays = Object.values(state.plan || {}).filter(p => !p.deleted && p.on && p.date >= from && p.date <= to)
    .sort((a, b) => a.date < b.date ? -1 : 1);
  if (!planDays.length) return result;

  // Load already fixed in the future: what you added by hand or imported (runs, for example) on days in
  // the range, and whole plans on days outside it. Cardio sits an hour before the gym on the same day.
  const fixedItems = pd => (pd.items || []).filter(it => it.src !== 'auto');
  const extra = [];
  const pushEvents = (date, items) => {
    const c = items.filter(i => i.k === 'cardio'), o = items.filter(i => i.k !== 'cardio');
    if (c.length) { const ev = planDayEvent(state, { date, items: c }); ev.t -= 3600e3; extra.push({ ...ev, date, cardio: true }); }
    if (o.length) extra.push({ ...planDayEvent(state, { date, items: o }), date });
  };
  for (const pd of Object.values(state.plan || {})) {
    if (pd.deleted || !pd.on || pd.date < today || planStarted(state, pd.date)) continue;
    const inRange = pd.date >= from && pd.date <= to;
    pushEvents(pd.date, inRange ? fixedItems(pd) : (pd.items || []));
  }

  const allowed = (type, ex) => {
    if (type === 'rest' || type === 'custom' || type === 'cardio' || type.startsWith('preset:')) return false;
    return fitsType(ex, type);
  };
  const exInfo = new Map();   // id -> { ex, muscles: [[m, c]], joints, cost }
  const info = id => {
    if (exInfo.has(id)) return exInfo.get(id);
    const ex = getEx(state, id);
    const r = ex ? { ex, muscles: Object.entries(ex.muscles || {}).filter(([m]) => MUSCLE[m]), joints: Object.entries(ex.joints || {}), cost: ex.cost || 1 } : null;
    exInfo.set(id, r); return r;
  };
  // muscles nothing in your pool can train
  const reachable = new Set();
  for (const ex of pool) for (const m in ex.muscles || {}) if (ex.muscles[m] >= 0.4) reachable.add(m);
  const lastMain = {};   // exercise -> last day it was planned heavy or fast
  const usedPreset = {};

  // group by week
  const byWeek = new Map();
  for (const pd of planDays) { const w = weekStart(pd.date); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(pd); }

  for (const [week, wdays] of byWeek) {
    const deload = isDeloadWeek(settings, week);
    const weekEnd = addDays(week, 7);
    // effective sets already in the bag this week: logged work, and fixed work on days the planner does not fill
    const done = {};
    for (const m of MUSCLES) done[m.id] = 0;
    for (let d = week; d < weekEnd && d <= today; d = addDays(d, 1)) { const day = an.days.get(d); if (day) for (const m in day.muscles) done[m] += day.muscles[m]; }

    // ----- the days of this week
    const D = [];
    for (const pd of wdays) {
      const date = pd.date, type = pd.type || 'auto';
      const fixed = fixedItems(pd);
      const out = { items: [], notes: [], minutes: 0 };
      result.days[date] = out;
      for (const it of fixed) {
        const ex = it.k !== 'block' ? getEx(state, it.ex) : null;
        const pc = ex && painCheck(state, ex, date, settings, pain, today);
        if (pc) out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: ${pc.level === 'avoid' ? 'consider moving or swapping' : 'go easy on'} ${it.name || ex.name}.`);
      }
      if (deload) out.notes.push('Lighter week: one set fewer per exercise.');
      out.notes = [...new Set(out.notes)];
      if (type === 'rest' || type === 'custom') {
        out.items = fixed; out.minutes = planMinutes(state, fixed);
        for (const it of fixed) { const e = itemEvent(state, it, 0); for (const m in e.sets) if (m in done) done[m] += e.sets[m]; }
        continue;
      }
      if (type === 'cardio') {
        const items = [...fixed];
        if (!fixed.some(i => i.k === 'cardio')) {
          const cardio = myExercises(state).filter(e => e.kind === 'cardio');
          const pick = cardio.find(e => !painCheck(state, e, date, settings, pain, today)) || cardio[0];
          const budget = (pd.minutes || settings.maxMinutes) * (deload ? 0.85 : 1);
          if (pick) { const it = { id: uid('i'), k: 'cardio', ex: pick.id, min: Math.min(40, Math.round(budget)), rpe: 4, src: 'auto' }; items.push(it); pushEvents(date, [it]); }
        }
        out.items = items; out.minutes = planMinutes(state, items);
        continue;
      }
      const t = dayTime(date);
      const fixedCardioMin = fixed.filter(i => i.k === 'cardio').reduce((a, i) => a + itemMinutes(state, i), 0);
      const fixedOther = fixed.filter(i => i.k !== 'cardio');
      const day = {
        date, type, t, out, fixed, pd,
        budget: (pd.minutes || settings.maxMinutes) * (deload ? 0.85 : 1),
        base: planMinutes(state, fixedOther) + fixedCardioMin * (settings.cardioInBudget ? 1 : 0.5),
        hasStrength: fixedOther.length > 0,
        items: [], locked: false,
        fixedS: {}, ahead: Math.max(0, diffDays(date, today)),
      };
      for (const it of fixedOther) { const e = itemEvent(state, it, t); for (const m in e.sets) day.fixedS[m] = (day.fixedS[m] || 0) + e.sets[m]; }
      D.push(day);
    }
    // fixed work on days after the range in this week is already in the plan: count it
    for (const pd of Object.values(state.plan || {})) {
      if (pd.deleted || !pd.on || pd.date < week || pd.date >= weekEnd || (pd.date >= from && pd.date <= to) || pd.date < today || planStarted(state, pd.date)) continue;
      for (const it of pd.items || []) if (it.k !== 'cardio') { const e = itemEvent(state, it, 0); for (const m in e.sets) if (m in done) done[m] += e.sets[m]; }
    }
    if (!D.length) continue;
    // load each day starts from: logged work, fixed items and earlier weeks' plans (not this week's new plan)
    for (const day of D) {
      const l = loadAt(an, day.t, extra.filter(e => e.t < day.t));
      day.fm = l.fm; day.fj = l.fj; day.capM = l.capM; day.capJ = l.capJ;
    }
    const dayIx = new Map(D.map((d, i) => [d.date, i]));
    const HL = {}; for (const m of MUSCLES) HL[m.id] = halfLife(settings, m.id);
    const HLJ = {}; for (const j of Object.keys(JOINT)) HLJ[j] = halfLife(settings, j);
    // how much of day k's load is left on day i, per muscle and joint (computed once)
    const DM = D.map((a, i) => D.map((b, k) => { const o = {}; if (k < i) for (const m in HL) o[m] = Math.pow(0.5, (a.t - b.t) / 3600e3 / HL[m]) / a.capM[m]; return o; }));
    // cardio planned in the next three days: the legs should not arrive at it tired from the gym
    const runCost = D.map(day => {
      const o = {};
      for (const ev of extra) {
        if (!ev.cardio || ev.t <= day.t || ev.t > day.t + 72 * 3600e3) continue;
        for (const m in ev.muscles) if (HL[m]) o[m] = (o[m] || 0) + lambda * Math.min(3, ev.muscles[m] / 4) * Math.pow(0.5, (ev.t - day.t) / 3600e3 / HL[m]) / day.capM[m];
      }
      return o;
    });
    const DJ = D.map((a, i) => D.map((b, k) => { const o = {}; if (k < i) for (const j in HLJ) o[j] = Math.pow(0.5, (a.t - b.t) / 3600e3 / HLJ[j]) / a.capJ[j]; return o; }));

    // ----- the plan as numbers: per day, effective sets and load per muscle, load per joint
    const S = D.map(() => ({})), L = D.map(() => ({})), J = D.map(() => ({}));
    const itemQ = it => (it.easy ? 0.5 : 1) * (it.jq ?? 1);   // pain and joint caution reduce what a set is worth
    const contrib = (it, sign, Si = null, Li = null, Ji = null, i = 0) => {
      const Sx = Si || S[i], Lx = Li || L[i], Jx = Ji || J[i];
      const add = (id, sets) => {
        const f = info(id); if (!f) return;
        const q = itemQ(it) * (it.mode === 'power' ? FAST_CREDIT : 1);
        // a tired main muscle ends the set early, so the helpers get less out of it too
        const pq = it.pq?.[id] ?? 1;
        for (const [m, c] of f.muscles) { Sx[m] = (Sx[m] || 0) + sign * c * sets * q * (c < 0.9 ? pq : 1); Lx[m] = (Lx[m] || 0) + sign * c * sets * f.cost * (it.mode === 'power' ? FAST_CREDIT : 1); }
        for (const [j, c] of f.joints) Jx[j] = (Jx[j] || 0) + sign * c * sets * 1.25;
      };
      if (it.k === 'ex') { let n = 0; for (let k = 0; k < it.sets; k++) n += SET_WORTH[Math.min(k, 4)]; add(it.ex, n); }
      else if (it.k === 'block') for (const id of state.blocks[it.block].exIds) add(id, it.rounds);
    };
    // the value of one muscle over the week, given per-day effective sets and load
    const muscleValue = (m, override) => {
      const { lo, hi } = muscleTarget(settings, m);
      let W = done[m] || 0;
      for (let i = 0; i < D.length; i++) {
        const s = (D[i].fixedS[m] || 0) + ((override && override.i === i ? override.S : S[i])[m] || 0);
        if (s <= 0.001) continue;
        let f = D[i].fm[m] || 0;
        for (let k = 0; k < i; k++) { const l = (override && override.i === k ? override.L : L[k])[m]; if (l) f += l * DM[i][k][m]; }
        W += sessionValue(s) * readiness(f, readyAt, span, floor);
      }
      return { W, v: weekValue(W, lo, hi) };
    };
    const cur = {};
    const refresh = () => { for (const m of MUSCLES) cur[m.id] = muscleValue(m.id); };
    refresh();
    // value gained by putting item `it` on day i (without committing it)
    const gain = (it, i) => {
      const Si = { ...S[i] }, Li = { ...L[i] }, Ji = { ...J[i] };
      contrib(it, 1, Si, Li, Ji);
      const touched = new Set();
      const ids = it.k === 'ex' ? [it.ex] : state.blocks[it.block].exIds;
      for (const id of ids) for (const [m] of info(id)?.muscles || []) touched.add(m);
      let g = 0;
      for (const m of touched) g += muscleValue(m, { i, S: Si, L: Li }).v - cur[m].v - (kappa + (runCost[i][m] || 0)) * ((Li[m] || 0) - (L[i][m] || 0));
      return g;
    };
    const jointLoad = (i, j) => {
      let f = D[i].fj[j] || 0;
      for (let k = 0; k < i; k++) if (J[k][j]) f += J[k][j] * DJ[i][k][j];
      return f + (J[i][j] || 0) / D[i].capJ[j];
    };
    const jointQ = (i, ids) => {
      let q = 1;
      for (const id of ids) for (const [j, c] of info(id)?.joints || []) if (c >= 0.5 && jointLoad(i, j) > jointLimit) q = Math.min(q, 0.6);
      return q;
    };
    // how ready an exercise's main muscles are on day i
    const primeQ = (i, ids) => {
      const o = {};
      for (const id of ids) {
        let r = 1;
        for (const [m, c] of info(id)?.muscles || []) {
          if (c < 0.9) continue;
          let f = D[i].fm[m] || 0;
          for (let k = 0; k < i; k++) if (L[k][m]) f += L[k][m] * DM[i][k][m];
          r = Math.min(r, readiness(f, readyAt, span, floor));
        }
        o[id] = r;
      }
      return o;
    };
    const minutesOf = (day, extraMin = 0) => {
      const strength = day.hasStrength || day.items.some(x => x.k !== 'cardio');
      return day.base + day.items.reduce((a, x) => a + itemMinutes(state, x), 0) + extraMin + (strength ? WARMUP_MIN : 0);
    };
    const place = (i, it) => { D[i].items.push(it); contrib(it, 1, null, null, null, i); refresh(); };
    const setsOf = it => it.k === 'ex' ? it.sets * (it.mode === 'power' ? FAST_CREDIT : 1) : it.k === 'block' ? it.rounds * state.blocks[it.block].exIds.length : 0;
    const daySetCount = i => D[i].items.reduce((a, x) => a + setsOf(x), 0) + D[i].fixed.reduce((a, x) => a + setsOf(x), 0);
    const sessionDelta = (i, add) => { const n = daySetCount(i); return sessionCost(n + add) - sessionCost(n); };
    const usedInWeek = id => D.reduce((a, d) => a + d.items.filter(x => (x.k === 'ex' && x.ex === id) || (x.k === 'block' && x.block === id)).length, 0);
    const onDay = (i, id) => D[i].fixed.some(x => x.ex === id || (x.k === 'block' && (state.blocks[x.block]?.exIds || []).includes(id)))
      || D[i].items.some(x => x.ex === id || (x.k === 'block' && state.blocks[x.block].exIds.includes(id)));
    const painNoted = D.map(() => new Set());
    const painCache = D.map(() => new Map());
    const painOf = (i, ex) => {
      if (!painCache[i].has(ex.id)) painCache[i].set(ex.id, painCheck(state, ex, D[i].date, settings, pain, today));
      const pc = painCache[i].get(ex.id);
      if (pc?.level === 'avoid' && !painNoted[i].has(pc.region)) { painNoted[i].add(pc.region); D[i].out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: exercises that load it are left out.`); }
      return pc;
    };

    // ----- 1. preset days: the best whole preset for each, in date order
    for (let i = 0; i < D.length; i++) {
      const day = D[i];
      const isPresetDay = day.type.startsWith('preset:') || (usePresets && day.type === 'auto');
      if (!isPresetDay) continue;
      day.locked = true;
      let preset = day.type.startsWith('preset:') ? state.presets?.[day.type.slice(7)] : null;
      if (!preset) {
        let best = null, bs = -Infinity;
        for (const p of presets.filter(p => p.plan !== false)) {
          let g = 0;
          for (const it of p.items || []) if ((it.k === 'ex' && info(it.ex)) || (it.k === 'block' && state.blocks?.[it.block] && !state.blocks[it.block].deleted)) g += gain(it.k === 'ex' ? { k: 'ex', ex: it.ex, sets: it.sets || 3 } : { k: 'block', block: it.block, rounds: it.rounds || state.blocks[it.block].rounds || 3 }, i);
          g *= Math.pow(0.8, usedPreset[p.id] || 0);
          if (g > bs) { bs = g; best = p; }
        }
        preset = best;
        if (preset) { usedPreset[preset.id] = (usedPreset[preset.id] || 0) + 1; day.out.preset = preset.id; day.out.notes.push(`Preset: ${preset.name}`); }
      }
      for (const it of preset?.items || []) {
        const item = { ...it, id: uid('i'), src: 'auto', pre: preset.id };
        if (item.k === 'ex' || item.k === 'cardio') {
          const ex = getEx(state, item.ex); if (!ex) continue;
          const pc = painCheck(state, ex, day.date, settings, pain, today);
          if (pc?.level === 'avoid') { day.out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: left out ${ex.name}.`); continue; }
          if (pc) { day.out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: go easy on ${ex.name}.`); if (item.k === 'ex') item.easy = true; }
          if (deload && item.k === 'ex') item.sets = Math.max(2, (item.sets || 3) - 1);
        }
        if (item.k === 'block' && !state.blocks?.[item.block]) continue;
        if (minutesOf(day, itemMinutes(state, item)) > day.budget + 3) { day.out.notes.push('Preset trimmed to fit your time.'); break; }
        if (item.k === 'cardio') day.items.push(item); else place(i, item);
      }
    }

    // ----- 2. goal: heavy (strength) or fast (power) main lifts go first in each session
    if (goal !== 'size') {
      const M = MODES[goal];
      const sets = Math.max(2, M.sets - (deload ? 1 : 0));
      for (let i = 0; i < D.length; i++) {
        const day = D[i]; if (day.locked) continue;
        for (let n = 0; n < (goal === 'strength' ? 3 : 2); n++) {
          let best = null;
          for (const ex of pool) {
            if (ex.mech !== 'compound' || onDay(i, ex.id) || !allowed(day.type, ex)) continue;
            const used = usedInWeek(ex.id);
            if (used >= 2 || (lastMain[ex.id] && diffDays(day.date, lastMain[ex.id]) < 2)) continue;   // twice a week at most, never two days running
            if (painCheck(state, ex, day.date, settings, pain, today)) continue;   // nothing heavy or explosive on a sore area
            const it = { k: 'ex', ex: ex.id, sets, mode: goal, repLo: M.repLo, repHi: M.repHi, rest: Math.max(ex.rest || 0, M.rest) };
            if (minutesOf(day, itemMinutes(state, it)) > day.budget * 0.7 + 1) continue;   // leave room for the rest of the session
            const prime = info(ex.id).muscles.filter(([, c]) => c >= 0.9);
            let ready = 1;
            for (const [m] of prime) { let f = day.fm[m] || 0; for (let k = 0; k < i; k++) if (L[k][m]) f += L[k][m] * DM[i][k][m]; ready = Math.min(ready, readiness(f, readyAt, span, floor)); }
            if (goal === 'power' && ready < 0.8) continue;   // fast work needs fresh muscles
            it.jq = jointQ(i, [ex.id]); it.pq = primeQ(i, [ex.id]);
            // a heavy lift wants to come back once in the week
            const b = gain(it, i) * (ex.cost > 1.2 ? 1.15 : 1) * (used === 1 ? (goal === 'strength' ? 1.3 : 0.5) : 1);
            if (b / sets > MIN_GAIN && (!best || b > best.b)) best = { it, b, ex };
          }
          if (!best) break;
          place(i, { ...best.it, id: uid('i'), src: 'auto' });
          lastMain[best.ex.id] = day.date;
        }
      }
    }

    // ----- 3. fill the week: the addition that gains the most per minute, on whichever day it fits best
    const candidates = () => {
      const out = [];
      for (let i = 0; i < D.length; i++) {
        const day = D[i]; if (day.locked) continue;
        const room = day.budget + 1 - minutesOf(day);
        if (room <= 0.5) continue;
        // another set of an exercise already planned that day
        for (const it of day.items) {
          if (it.k !== 'ex' || it.mode || it.src !== 'auto' || it.sets >= MAX_SETS || it.pre) continue;
          const f = info(it.ex);
          const min = (WORK_SEC + (it.rest || f.ex.rest || 90)) / 60;
          if (min > room) continue;
          out.push({ i, kind: 'set', it, min, sets: 1, pref: mixOf(f.ex) });
        }
        // another round of a block already planned that day
        for (const it of day.items) {
          if (it.k !== 'block' || it.src !== 'auto' || it.pre) continue;
          const bl = state.blocks[it.block];
          if (it.rounds >= Math.max(4, (bl.rounds || 3) + 1)) continue;
          const min = itemMinutes(state, { ...it, rounds: it.rounds + 1 }) - itemMinutes(state, it);
          if (min > room) continue;
          out.push({ i, kind: 'round', it, min, sets: bl.exIds.length, pref: blocksBonus });
        }
        // a new exercise, 2 or 3 sets to start
        for (const ex of pool) {
          if (!allowed(day.type, ex) || onDay(i, ex.id)) continue;
          const pc = painOf(i, ex);
          if (pc?.level === 'avoid') continue;
          for (const n of [2, 3]) {
            const sets = Math.max(2, n - (deload && n > 2 ? 1 : 0));
            const it = { k: 'ex', ex: ex.id, sets, repLo: ex.repLo, repHi: ex.repHi };
            if (pc) it.easy = true;
            const min = itemMinutes(state, it);
            if (min > room) continue;
            out.push({ i, kind: 'ex', it, min, sets, pref: mixOf(ex) * Math.pow(0.93, usedInWeek(ex.id)), pc });
          }
        }
        // one of your blocks
        for (const bl of blocks) {
          const exs = bl.exIds.map(id => info(id)?.ex);
          if (exs.some(e => !e) || !exs.every(e => allowed(day.type, e)) || bl.exIds.some(id => onDay(i, id))) continue;
          if (exs.some(e => painOf(i, e)?.level === 'avoid')) continue;
          const rounds = Math.max(2, (bl.rounds || 3) - (deload ? 1 : 0));
          const it = { k: 'block', block: bl.id, rounds };
          if (exs.some(e => painOf(i, e))) it.easy = true;
          const min = itemMinutes(state, it);
          if (min > room) continue;
          out.push({ i, kind: 'block', it, min, sets: rounds * exs.length, pref: blocksBonus * Math.pow(0.9, usedInWeek(bl.id)) });
        }
      }
      return out;
    };
    const fill = () => {
      for (let guard = 0; guard < 200; guard++) {
        let best = null;
        for (const c of candidates()) {
          let g;
          if (c.kind === 'set' || c.kind === 'round') {
            const nxt = c.kind === 'set' ? { ...c.it, sets: c.it.sets + 1 } : { ...c.it, rounds: c.it.rounds + 1 };
            const Si = { ...S[c.i] }, Li = { ...L[c.i] }, Ji = { ...J[c.i] };
            contrib(c.it, -1, Si, Li, Ji); contrib(nxt, 1, Si, Li, Ji);
            const touched = new Set((c.kind === 'set' ? [c.it.ex] : state.blocks[c.it.block].exIds).flatMap(id => info(id).muscles.map(([m]) => m)));
            g = 0; for (const m of touched) g += muscleValue(m, { i: c.i, S: Si, L: Li }).v - cur[m].v - (kappa + (runCost[c.i][m] || 0)) * ((Li[m] || 0) - (L[c.i][m] || 0));
          } else {
            const ids = c.kind === 'ex' ? [c.it.ex] : state.blocks[c.it.block].exIds;
            c.it.jq = jointQ(c.i, ids); c.it.pq = primeQ(c.i, ids);
            g = gain(c.it, c.i);
          }
          g -= sessionDelta(c.i, c.sets);
          if (g / c.sets < MIN_GAIN) continue;
          const score = g * c.pref / c.min;
          if (!best || score > best.score) best = { ...c, g, score };
        }
        if (!best) break;
        if (best.kind === 'set' || best.kind === 'round') { contrib(best.it, -1, null, null, null, best.i); best.it[best.kind === 'set' ? 'sets' : 'rounds']++; contrib(best.it, 1, null, null, null, best.i); refresh(); }
        else place(best.i, { ...best.it, id: uid('i'), src: 'auto' });
      }
    };
    fill();

    // ----- 4. write the days out
    const weekOut = {};
    for (const m of MUSCLES) { const t = muscleTarget(settings, m.id); weekOut[m.id] = { eff: cur[m.id].W, lo: t.lo, hi: t.hi }; }
    result.weeks[week] = weekOut;
    for (const day of D) {
      const out = day.out;
      // order: fast work first (it needs you fresh), then heavy lifts, big compounds, blocks, isolation, core last
      const rank = it => {
        if (it.k === 'cardio') return -3;
        if (it.mode === 'power') return -2;
        if (it.mode === 'strength') return -1;
        if (it.k === 'block') return 2;
        const ex = getEx(state, it.ex); const pm = primaryMuscle(ex);
        if (MUSCLE[pm]?.group === 'core') return 4;
        return ex?.mech === 'compound' ? (ex.cost > 1.2 ? 0 : 1) : 3;
      };
      const chosen = day.items.map((it, k) => ({ it, k })).sort((a, b) => (day.locked ? 0 : rank(a.it) - rank(b.it)) || a.k - b.k).map(x => x.it);
      for (const it of chosen) {
        delete it.jq; delete it.pq;
        if (it.easy && it.k === 'ex') { const ex = getEx(state, it.ex), pc = painCheck(state, ex, day.date, settings, pain, today); if (pc) out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: go easy on ${ex.name}.`); }
      }
      const fixedCardio = day.fixed.filter(i => i.k === 'cardio'), fixedOther = day.fixed.filter(i => i.k !== 'cardio');
      out.items = [...fixedCardio, ...fixedOther, ...chosen];
      out.minutes = planMinutes(state, out.items);
      out.notes = [...new Set(out.notes)];
      if (!chosen.length && !day.fixed.length) out.notes.push(pool.length ? 'Nothing useful fits: the muscles this day targets are still loaded or already at their weekly target.' : 'Add exercises to "My exercises" so the planner has something to work with.');
      if (chosen.length) pushEvents(day.date, chosen);
    }
  }
  // what the plan cannot reach
  const missing = MUSCLES.filter(m => muscleTarget(settings, m.id).lo > 0 && !reachable.has(m.id)).map(m => m.name);
  if (missing.length && pool.length) result.notes.push(`Nothing in your exercises trains ${listJoin(missing)}. Add an exercise for ${missing.length > 1 ? 'them' : 'it'} under More, Exercises, or set ${missing.length > 1 ? 'their targets' : 'its target'} to 0.`);
  return result;
}
const listJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

/** Weekly sets per muscle a plan would deliver (logged + planned), for the plan preview. */
export function weekProjection(state, an, week, today = ymd()) {
  const sets = {};
  for (const m of MUSCLES) sets[m.id] = { done: 0, planned: 0 };
  for (let d = week; d < addDays(week, 7); d = addDays(d, 1)) {
    const day = an.days.get(d);
    if (day) for (const m in day.muscles) sets[m].done += day.muscles[m];
    const pd = state.plan?.[d];
    if (pd && pd.on && !pd.deleted && d >= today && !planStarted(state, d)) {
      const ev = planDayEvent(state, pd);
      for (const m in ev.sets) if (sets[m]) sets[m].planned += ev.sets[m];
    }
  }
  return sets;
}

// ---------- committing many days at once, and clearing a month

/** Ready-made weekly patterns. Keys are weekdays, Monday = 0. Values are workout types. */
export const PATTERNS = [
  { id: 'full3', name: '3 days, full body', days: { 0: 'full', 2: 'full', 4: 'full' } },
  { id: 'ul4', name: '4 days, upper and lower', days: { 0: 'upper', 1: 'lower', 3: 'upper', 4: 'lower' } },
  { id: 'ppl3', name: '3 days, push, pull, legs', days: { 0: 'push', 2: 'pull', 4: 'legs' } },
  { id: 'auto4', name: '4 days, planner decides', days: { 0: 'auto', 1: 'auto', 3: 'auto', 5: 'auto' } },
];

const committed = (state, date) => { const p = state.plan?.[date]; return !!(p && !p.deleted && p.on); };
const trainedOn = (state, date) => Object.values(state.sessions || {}).some(s => !s.deleted && s.date === date && s.items?.length);

/**
 * The days a weekly pattern would commit, from `from` to the end of the last of `weeks` weeks.
 * pattern: { weekday (Mon = 0): type id or 'preset:<id>' }. Days already committed are counted, not touched.
 */
export function patternDays(state, pattern, from, weeks, limit) {
  const end = addDays(weekStart(from), weeks * 7 - 1);
  const add = [], kept = [];
  for (let d = from; d <= end && (!limit || d <= limit); d = addDays(d, 1)) {
    const wd = (parseYmd(d).getDay() + 6) % 7;
    const what = pattern?.[wd];
    if (!what) continue;
    if (committed(state, d)) kept.push(d); else add.push({ date: d, what });
  }
  return { add, kept, end: limit && end > limit ? limit : end };
}

/** The pattern this week's commitments make, so it can be repeated. */
export function patternFromWeek(state, week) {
  const out = {};
  for (let i = 0; i < 7; i++) {
    const pd = state.plan?.[addDays(week, i)];
    if (!pd || pd.deleted || !pd.on) continue;
    const pres = dayPresets(state, pd);
    out[i] = pres.length ? 'preset:' + pres[0].id : (TYPE[pd.type] && pd.type !== 'rest' ? pd.type : 'auto');
  }
  return out;
}

/** A plan-day record for one pattern day. */
export function patternRecord(state, { date, what }) {
  if (what.startsWith('preset:')) {
    const p = state.presets?.[what.slice(7)];
    if (p && !p.deleted) return { date, on: true, type: 'custom', items: presetItems(state, p) };
    return { date, on: true, type: 'auto', items: [] };
  }
  return { date, on: true, type: TYPE[what] ? what : 'auto', items: [] };
}

/** Commitments in a month (YYYY-MM) that can still be cleared: today or later, and not trained yet. */
export function monthCommitments(state, month, today = ymd()) {
  return Object.values(state.plan || {})
    .filter(p => !p.deleted && p.on && p.date.slice(0, 7) === month && p.date >= today && !trainedOn(state, p.date))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}
