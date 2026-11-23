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
const OVER = 1.5, OVER_COST = 0.3, BELOW = 0.3, FIRST = 2, FIRST_SETS = 3, OVER_WINDOW = 1.0;
const midOf = (lo, hi) => Math.max(2, (lo + hi) / 2);
export function weekMarginal(W, lo, hi) {
  const T = midOf(lo, hi);
  if (W <= hi) return 2 / (1 + 2 * W / T) + (W < lo ? BELOW : 0) + (W < Math.min(FIRST_SETS, lo) ? FIRST : 0);
  const d = W - hi;
  return (2 / (1 + 2 * hi / T)) * Math.exp(-d / OVER) - OVER_COST * Math.min(1, d / 2);
}
export function weekValue(W, lo, hi) {
  return weekGrowth(W, lo, hi) - overCost(W, hi);
}
/** The growth part of weekValue: rises with diminishing returns, flattens past the band. */
export function weekGrowth(W, lo, hi) {
  const T = midOf(lo, hi), below = BELOW * Math.min(W, lo) + FIRST * Math.min(W, FIRST_SETS, lo);
  if (W <= hi) return T * Math.log(1 + 2 * W / T) + below;
  const d = W - hi, mh = 2 / (1 + 2 * hi / T);
  return below + T * Math.log(1 + 2 * hi / T) + mh * OVER * (1 - Math.exp(-d / OVER));
}
/** The cost of going past the top of the band: fatigue for almost no growth. */
export function overCost(W, hi) {
  const d = W - hi;
  return d <= 0 ? 0 : OVER_COST * (d <= 2 ? d * d / 4 : d - 1);
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
 * Build a plan for every committed day between from and to, all of them together.
 * Muscles do not know about calendar weeks: targets count any 7 days in a row, and recovery runs on
 * the hours between sessions. The planner keeps adding whatever gives the most growth per minute,
 * on whichever committed day it fits best, until nothing worth the effort fits.
 * Returns { days: {date: {items, minutes, notes}}, notes, muscles, weeks } without touching state.
 */
export function autoPlan(state, an, { from, to, today = ymd() } = {}) {
  const settings = getSettings(state);
  const pain = currentPain(state);
  const pool = myExercises(state).filter(e => e.kind === 'strength' && e.plan !== false);
  const blocks = Object.values(state.blocks || {}).filter(b => !b.deleted && b.plan !== false && b.exIds?.length);
  const presets = Object.values(state.presets || {}).filter(p => !p.deleted);
  const usePresets = settings.planMode === 'presets' && presets.some(p => p.plan !== false);
  const result = { days: {}, notes: [], muscles: {}, weeks: {} };
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
  const MIDS = MUSCLES.map(m => m.id);
  const TG = {}; for (const m of MIDS) TG[m] = muscleTarget(settings, m);

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

  // ----- the calendar the plan lives on: 6 days before the range (what you did counts) to 6 days after
  const t0 = addDays(from, -6);
  const ix = date => diffDays(date, t0);
  const toIx = ix(to), N = toIx + 7;
  const base = {}; for (const m of MIDS) base[m] = new Float64Array(N);   // effective sets that are already settled
  for (let t = 0; t <= toIx; t++) {
    const date = addDays(t0, t);
    if (date <= today) { const day = an.days.get(date); if (day) for (const m in day.muscles) if (base[m]) base[m][t] += day.muscles[m]; }
    else if (date < from) {   // committed days between today and the range: their plan counts as it is
      const pd = state.plan?.[date];
      if (pd && !pd.deleted && pd.on && !planStarted(state, date)) for (const it of pd.items || []) if (it.k !== 'cardio') { const e = itemEvent(state, it, 0); for (const m in e.sets) if (base[m]) base[m][t] += e.sets[m]; }
    }
  }

  // days already planned just after the range are known too (when you plan a single day, say)
  let knownIx = toIx;
  for (const pd of Object.values(state.plan || {})) {
    if (pd.deleted || !pd.on || pd.date <= to || pd.date > addDays(to, 6) || pd.date < today || planStarted(state, pd.date) || !(pd.items || []).length) continue;
    const t = ix(pd.date); knownIx = Math.max(knownIx, t);
    for (const it of pd.items) if (it.k !== 'cardio') { const e = itemEvent(state, it, 0); for (const m in e.sets) if (base[m]) base[m][t] += e.sets[m]; }
  }

  // ----- the committed days
  const D = [];
  for (const pd of planDays) {
    const date = pd.date, type = pd.type || 'auto';
    const deload = isDeloadWeek(settings, weekStart(date));
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
    // a day you filled yourself (presets, for example) is kept as it is; if it has strength work it still
    // takes part, so the days before it leave the muscles it trains fresh enough
    const fixedLifting = fixed.some(i => i.k !== 'cardio');
    if (type === 'rest' || (type === 'custom' && !fixedLifting)) {
      out.items = fixed; out.minutes = planMinutes(state, fixed);
      for (const it of fixed) if (it.k !== 'cardio') { const e = itemEvent(state, it, 0); for (const m in e.sets) if (base[m]) base[m][ix(date)] += e.sets[m]; }
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
    const fixedCardioMin = fixed.filter(i => i.k === 'cardio').reduce((a, i) => a + itemMinutes(state, i), 0);
    const fixedOther = fixed.filter(i => i.k !== 'cardio');
    const day = {
      date, type, t: dayTime(date), ti: ix(date), out, fixed, pd, deload,
      budget: (pd.minutes || settings.maxMinutes) * (deload ? 0.85 : 1),
      base: planMinutes(state, fixedOther) + fixedCardioMin * (settings.cardioInBudget ? 1 : 0.5),
      hasStrength: fixedOther.length > 0, items: [], locked: type === 'custom', fixedS: {},
    };
    for (const it of fixedOther) { const e = itemEvent(state, it, day.t); for (const m in e.sets) day.fixedS[m] = (day.fixedS[m] || 0) + e.sets[m]; }
    D.push(day);
  }

  const HL = {}; for (const m of MIDS) HL[m] = halfLife(settings, m);
  const HLJ = {}; for (const j of Object.keys(JOINT)) HLJ[j] = halfLife(settings, j);
  if (D.length) {
    // load each day starts from: logged work and fixed items (not the new plan)
    for (const day of D) {
      const l = loadAt(an, day.t, extra.filter(e => e.t < day.t));
      day.fm = l.fm; day.fj = l.fj; day.capM = l.capM; day.capJ = l.capJ;
    }
    // neighbours: earlier days whose load is still felt (6 days back), with how much is left of it
    const NEAR = 6;
    for (let i = 0; i < D.length; i++) {
      const a = D[i]; a.prev = []; a.next = [];
      for (let k = i - 1; k >= 0 && a.ti - D[k].ti <= NEAR; k--) {
        const h = (a.t - D[k].t) / 3600e3, dm = {}, dj = {};
        for (const m of MIDS) dm[m] = Math.pow(0.5, h / HL[m]) / a.capM[m];
        for (const j in HLJ) dj[j] = Math.pow(0.5, h / HLJ[j]) / a.capJ[j];
        a.prev.push({ k, dm, dj });
      }
      for (let k = i; k < D.length && D[k].ti - a.ti <= NEAR; k++) a.next.push(k);
    }
    // cardio planned in the next three days: the legs should not arrive at it tired from the gym
    for (const day of D) {
      const o = {};
      for (const ev of extra) {
        if (!ev.cardio || ev.t <= day.t || ev.t > day.t + 72 * 3600e3) continue;
        // the share of the gym's load still in the muscle when the run starts, weighed by how much the run uses it.
        // Not scaled down by capacity: lots of running makes the legs fitter, not keener on arriving tired.
        for (const m in ev.muscles) if (HL[m]) o[m] = (o[m] || 0) + lambda * Math.min(3, ev.muscles[m] / 4) * Math.pow(0.5, (ev.t - day.t) / 3600e3 / HL[m]);
      }
      day.runCost = o;
    }
  }

  // ----- the plan as numbers
  const S = D.map(() => ({})), L = D.map(() => ({})), J = D.map(() => ({})), R = D.map(() => ({}));   // R: plain hard sets, as you would count them
  const G = D.map(() => ({}));                       // what each day adds to each muscle, after readiness and the session ceiling
  const Wn = {}, Rn = {}; for (const m of MIDS) { Wn[m] = new Float64Array(N); Rn[m] = new Float64Array(N); }   // effective and plain sets in the 7 days ending on each day
  const itemQ = it => (it.easy ? 0.5 : 1) * (it.jq ?? 1);   // pain and joint caution reduce what a set is worth
  const contrib = (it, sign, Sx, Lx, Jx, Rx) => {
    const add = (id, sets, plain) => {
      const f = info(id); if (!f) return;
      const q = itemQ(it) * (it.mode === 'power' ? FAST_CREDIT : 1);
      // a tired main muscle ends the set early, so the helpers get less out of it too
      const pq = it.pq?.[id] ?? 1;
      for (const [m, c] of f.muscles) {
        Sx[m] = (Sx[m] || 0) + sign * c * sets * q * (c < 0.9 ? pq : 1);
        Lx[m] = (Lx[m] || 0) + sign * c * sets * f.cost * (it.mode === 'power' ? FAST_CREDIT : 1);
        Rx[m] = (Rx[m] || 0) + sign * c * plain * (it.mode === 'power' ? FAST_CREDIT : 1);
      }
      for (const [j, c] of f.joints) Jx[j] = (Jx[j] || 0) + sign * c * sets * 1.25;
    };
    if (it.k === 'ex') { let n = 0; for (let k = 0; k < it.sets; k++) n += SET_WORTH[Math.min(k, 4)]; add(it.ex, n, it.sets); }
    else if (it.k === 'block') for (const id of state.blocks[it.block].exIds) add(id, it.rounds, it.rounds);
  };
  const touchedBy = it => new Set((it.k === 'ex' ? [it.ex] : state.blocks[it.block].exIds).flatMap(id => (info(id)?.muscles || []).map(([m]) => m)));
  const loadOn = (j, m, Lover) => { let f = D[j].fm[m] || 0; for (const p of D[j].prev) { const l = (Lover && Lover.k === p.k ? Lover.L : L[p.k])[m]; if (l) f += l * p.dm[m]; } return f; };
  const dayG = (j, m, Sj, f) => { const s = (D[j].fixedS[m] || 0) + (Sj[m] || 0); return s > 0.001 ? sessionValue(s) * readiness(f, readyAt, span, floor) : 0; };
  // a 7-day window ending on day e. For windows reaching past the range, the days after it are assumed
  // to go on at the pace of the plan and your last days (you keep training as you are), so the last
  // committed days are judged fairly, and a muscle the plan leaves at zero stays at zero there too.
  const known = e => Math.min(7, knownIx - (e - 6) + 1);
  const SumW = {}, SumR = {};   // all effective and plain sets on the calendar up to the end of the range
  const pace = sum => 7 * sum / (knownIx + 1);
  // Every set sits in seven windows, so each window weighs a seventh: one set still counts once.
  // Going past the top of a target costs in full in every window where it happens, so no 7 days in a row
  // run far over the band (even right after a break, when the windows reaching back are still empty).
  // Growth follows the effective sets; the cost of going over follows the plain sets you would count yourself.
  const winValue = (m, W, Rw, e, sw, sr) => { const f = (7 - known(e)) / 7; return weekGrowth(W + f * pace(sw), TG[m].lo, TG[m].hi) / 7 - OVER_WINDOW * overCost(Rw + f * pace(sr), TG[m].hi); };
  for (const m of MIDS) {
    for (let e = 6; e < N; e++) { let w = 0; for (let t = e - 6; t <= Math.min(e, knownIx); t++) w += base[m][t]; Wn[m][e] = w; Rn[m][e] = w; }
    let sum = 0; for (let t = 0; t <= knownIx; t++) sum += base[m][t]; SumW[m] = sum; SumR[m] = sum;
  }

  // value gained by changing day i's sets to Si / load to Li (only muscles in `touched`)
  const delta = (i, Si, Li, touched, Ri) => {
    let g = 0;
    for (const m of touched) {
      const dr = (Ri[m] || 0) - (R[i][m] || 0), ti = D[i].ti;
      const ch = [];
      for (const j of D[i].next) {
        const f = loadOn(j, m, j === i ? null : { k: i, L: Li });
        const ng = dayG(j, m, j === i ? Si : S[j], f), og = G[j][m] || 0;
        if (Math.abs(ng - og) > 1e-9) ch.push([D[j].ti, ng - og]);
      }
      let dsum = 0; for (const [, v] of ch) dsum += v;
      const sw = SumW[m], sr = SumR[m], sw2 = sw + dsum, sr2 = sr + dr;
      const lo = Math.max(6, ti), hi = Math.min(N - 1, Math.max(ti, ch.length ? ch[ch.length - 1][0] : ti) + 6);
      const tail = dsum || dr ? knownIx + 1 : N;   // windows past what is known move with the pace
      for (let e = lo; e < N; e++) {
        if (e > hi && e < tail) { e = tail - 1; continue; }
        let d = 0; for (const [t, v] of ch) if (t <= e && t > e - 7) d += v;
        const r = e - 6 <= ti && ti <= e ? dr : 0;
        if (d || r || e >= tail) g += winValue(m, Wn[m][e] + d, Rn[m][e] + r, e, sw2, sr2) - winValue(m, Wn[m][e], Rn[m][e], e, sw, sr);
      }
      g -= (kappa + (D[i].runCost[m] || 0)) * ((Li[m] || 0) - (L[i][m] || 0));
    }
    return g;
  };
  const commitDay = (i, touched, Rold) => {
    for (const m of touched) { const dr = (R[i][m] || 0) - (Rold[m] || 0); SumR[m] += dr; if (dr) for (let e = Math.max(6, D[i].ti); e <= Math.min(N - 1, D[i].ti + 6); e++) Rn[m][e] += dr; }
    for (const m of touched) for (const j of D[i].next) {
      const ng = dayG(j, m, S[j], loadOn(j, m)), og = G[j][m] || 0;
      if (Math.abs(ng - og) <= 1e-12) continue;
      G[j][m] = ng; SumW[m] += ng - og;
      for (let e = Math.max(6, D[j].ti); e <= Math.min(N - 1, D[j].ti + 6); e++) Wn[m][e] += ng - og;
    }
  };
  for (let i = 0; i < D.length; i++) for (const m of MIDS) if (D[i].fixedS[m]) {
    const g = dayG(i, m, S[i], loadOn(i, m)); G[i][m] = g; SumW[m] += g; SumR[m] += D[i].fixedS[m];
    for (let e = Math.max(6, D[i].ti); e <= Math.min(N - 1, D[i].ti + 6); e++) { Wn[m][e] += g; Rn[m][e] += D[i].fixedS[m]; }
  }

  const gain = (it, i) => {
    const Si = { ...S[i] }, Li = { ...L[i] }, Ji = { ...J[i] }, Ri = { ...R[i] };
    contrib(it, 1, Si, Li, Ji, Ri);
    return delta(i, Si, Li, touchedBy(it), Ri);
  };
  const place = (i, it) => { const old = { ...R[i] }; D[i].items.push(it); contrib(it, 1, S[i], L[i], J[i], R[i]); commitDay(i, touchedBy(it), old); };
  const bump = (i, it, key) => { const old = { ...R[i] }; contrib(it, -1, S[i], L[i], J[i], R[i]); it[key]++; contrib(it, 1, S[i], L[i], J[i], R[i]); commitDay(i, touchedBy(it), old); };
  const jointLoad = (i, j) => { let f = D[i].fj[j] || 0; for (const p of D[i].prev) if (J[p.k][j]) f += J[p.k][j] * p.dj[j]; return f + (J[i][j] || 0) / D[i].capJ[j]; };
  const jointQ = (i, ids) => { let q = 1; for (const id of ids) for (const [j, c] of info(id)?.joints || []) if (c >= 0.5 && jointLoad(i, j) > jointLimit) q = Math.min(q, 0.6); return q; };
  const primeQ = (i, ids) => {
    const o = {};
    for (const id of ids) { let r = 1; for (const [m, c] of info(id)?.muscles || []) if (c >= 0.9) r = Math.min(r, readiness(loadOn(i, m), readyAt, span, floor)); o[id] = r; }
    return o;
  };
  const minutesOf = (day, extraMin = 0) => {
    const strength = day.hasStrength || day.items.some(x => x.k !== 'cardio');
    return day.base + day.items.reduce((a, x) => a + itemMinutes(state, x), 0) + extraMin + (strength ? WARMUP_MIN : 0);
  };
  const setsOf = it => it.k === 'ex' ? it.sets * (it.mode === 'power' ? FAST_CREDIT : 1) : it.k === 'block' ? it.rounds * state.blocks[it.block].exIds.length : 0;
  const daySetCount = i => D[i].items.reduce((a, x) => a + setsOf(x), 0) + D[i].fixed.reduce((a, x) => a + setsOf(x), 0);
  const sessionDelta = (i, add) => { const n = daySetCount(i); return sessionCost(n + add) - sessionCost(n); };
  const has = (x, id) => x.ex === id || x.block === id || (x.k === 'block' && (state.blocks[x.block]?.exIds || []).includes(id));
  const onDay = (i, id) => D[i].fixed.some(x => has(x, id)) || D[i].items.some(x => has(x, id));
  // how often an exercise (or block) is planned within 3 days either side: a little variety
  const usedNear = (i, id) => { let n = 0; for (let k = 0; k < D.length; k++) if (k !== i && Math.abs(D[k].ti - D[i].ti) <= 3 && D[k].items.some(x => (x.k === 'ex' && x.ex === id) || x.block === id)) n++; return n; };
  const painNoted = D.map(() => new Set());
  const painCache = D.map(() => new Map());
  const painOf = (i, ex) => {
    if (!painCache[i].has(ex.id)) painCache[i].set(ex.id, painCheck(state, ex, D[i].date, settings, pain, today));
    const pc = painCache[i].get(ex.id);
    if (pc?.level === 'avoid' && !painNoted[i].has(pc.region)) { painNoted[i].add(pc.region); D[i].out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: exercises that load it are left out.`); }
    return pc;
  };

  // ----- 1. preset days: the best whole preset for each, in date order
  const presetUsed = [];   // [ti, preset id]
  for (let i = 0; i < D.length; i++) {
    const day = D[i];
    const isPresetDay = day.type.startsWith('preset:') || (usePresets && day.type === 'auto');
    if (!isPresetDay) continue;
    day.locked = true;
    let preset = day.type.startsWith('preset:') ? state.presets?.[day.type.slice(7)] : null;
    if (!preset) {
      let best = null, bs = -Infinity;
      for (const p of presets.filter(p => p.plan !== false)) {
        const its = [];
        for (const it of p.items || []) {
          if (it.k === 'ex' && info(it.ex)) its.push({ k: 'ex', ex: it.ex, sets: it.sets || 3 });
          else if (it.k === 'block' && state.blocks?.[it.block] && !state.blocks[it.block].deleted) its.push({ k: 'block', block: it.block, rounds: it.rounds || state.blocks[it.block].rounds || 3 });
        }
        const Si = { ...S[i] }, Li = { ...L[i] }, Ji = { ...J[i] }, Ri = { ...R[i] }, touched = new Set();
        for (const it of its) { contrib(it, 1, Si, Li, Ji, Ri); for (const m of touchedBy(it)) touched.add(m); }
        let g = delta(i, Si, Li, touched, Ri);
        g *= Math.pow(0.8, presetUsed.filter(([t, id]) => id === p.id && day.ti - t < 7).length);
        if (g > bs) { bs = g; best = p; }
      }
      preset = best;
      if (preset) { presetUsed.push([day.ti, preset.id]); day.out.preset = preset.id; day.out.notes.push(`Preset: ${preset.name}`); }
    }
    for (const it of preset?.items || []) {
      const item = { ...it, id: uid('i'), src: 'auto', pre: preset.id };
      if (item.k === 'ex' || item.k === 'cardio') {
        const ex = getEx(state, item.ex); if (!ex) continue;
        const pc = painCheck(state, ex, day.date, settings, pain, today);
        if (pc?.level === 'avoid') { day.out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: left out ${ex.name}.`); continue; }
        if (pc) { day.out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: go easy on ${ex.name}.`); if (item.k === 'ex') item.easy = true; }
        if (day.deload && item.k === 'ex') item.sets = Math.max(2, (item.sets || 3) - 1);
      }
      if (item.k === 'block' && !state.blocks?.[item.block]) continue;
      if (minutesOf(day, itemMinutes(state, item)) > day.budget + 3) { day.out.notes.push('Preset trimmed to fit your time.'); break; }
      if (item.k === 'cardio') day.items.push(item); else place(i, item);
    }
  }

  // ----- 2. goal: heavy (strength) or fast (power) main lifts go first in each session
  if (goal !== 'size') {
    const M = MODES[goal];
    const mainOn = []; // [ti, exercise id]
    for (let i = 0; i < D.length; i++) {
      const day = D[i]; if (day.locked) continue;
      const sets = Math.max(2, M.sets - (day.deload ? 1 : 0));
      for (let n = 0; n < (goal === 'strength' ? 3 : 2); n++) {
        let best = null;
        for (const ex of pool) {
          if (ex.mech !== 'compound' || onDay(i, ex.id) || !allowed(day.type, ex)) continue;
          const recent = mainOn.filter(([t, id]) => id === ex.id && day.ti - t < 7);
          // at most twice in any 7 days, never two days running
          if (recent.length >= 2 || recent.some(([t]) => day.ti - t < 2)) continue;
          if (painCheck(state, ex, day.date, settings, pain, today)) continue;   // nothing heavy or explosive on a sore area
          const it = { k: 'ex', ex: ex.id, sets, mode: goal, repLo: M.repLo, repHi: M.repHi, rest: Math.max(ex.rest || 0, M.rest) };
          if (minutesOf(day, itemMinutes(state, it)) > day.budget * 0.7 + 1) continue;   // leave room for the rest of the session
          let ready = 1;
          for (const [m, c] of info(ex.id).muscles) if (c >= 0.9) ready = Math.min(ready, readiness(loadOn(i, m), readyAt, span, floor));
          if (goal === 'power' && ready < 0.8) continue;   // fast work needs fresh muscles
          it.jq = jointQ(i, [ex.id]); it.pq = primeQ(i, [ex.id]);
          // a heavy lift wants to come back once within the week
          const b = gain(it, i) * (ex.cost > 1.2 ? 1.15 : 1) * (recent.length === 1 ? (goal === 'strength' ? 1.3 : 0.5) : 1);
          if (b / sets > MIN_GAIN && (!best || b > best.b)) best = { it, b, ex };
        }
        if (!best) break;
        place(i, { ...best.it, id: uid('i'), src: 'auto' });
        mainOn.push([day.ti, best.ex.id]);
      }
    }
  }

  // ----- 3. fill: the addition that gains the most per minute, on whichever day it fits best
  const candidatesFor = i => {
    const out = [], day = D[i];
    if (day.locked) return out;
    const room = day.budget + 1 - minutesOf(day);
    if (room <= 0.5) return out;
    for (const it of day.items) {   // another set of an exercise already planned that day
      if (it.k !== 'ex' || it.mode || it.src !== 'auto' || it.sets >= MAX_SETS || it.pre) continue;
      const f = info(it.ex), min = (WORK_SEC + (it.rest || f.ex.rest || 90)) / 60;
      if (min <= room) out.push({ i, kind: 'set', it, min, sets: 1, pref: mixOf(f.ex) });
    }
    for (const it of day.items) {   // another round of a block already planned that day
      if (it.k !== 'block' || it.src !== 'auto' || it.pre) continue;
      const bl = state.blocks[it.block];
      if (it.rounds >= Math.max(4, (bl.rounds || 3) + 1)) continue;
      const min = itemMinutes(state, { ...it, rounds: it.rounds + 1 }) - itemMinutes(state, it);
      if (min <= room) out.push({ i, kind: 'round', it, min, sets: bl.exIds.length, pref: blocksBonus });
    }
    for (const ex of pool) {   // a new exercise, 2 or 3 sets to start
      if (!allowed(day.type, ex) || onDay(i, ex.id)) continue;
      const pc = painOf(i, ex);
      if (pc?.level === 'avoid') continue;
      const pref = mixOf(ex) * Math.pow(0.93, usedNear(i, ex.id));
      for (const n of [2, 3]) {
        const sets = Math.max(2, n - (day.deload && n > 2 ? 1 : 0));
        const it = { k: 'ex', ex: ex.id, sets, repLo: ex.repLo, repHi: ex.repHi };
        if (pc) it.easy = true;
        const min = itemMinutes(state, it);
        if (min <= room) out.push({ i, kind: 'ex', it, min, sets, pref, pc });
      }
    }
    for (const bl of blocks) {   // one of your blocks
      const exs = bl.exIds.map(id => info(id)?.ex);
      if (exs.some(e => !e) || !exs.every(e => allowed(day.type, e)) || bl.exIds.some(id => onDay(i, id))) continue;
      if (exs.some(e => painOf(i, e)?.level === 'avoid')) continue;
      const rounds = Math.max(2, (bl.rounds || 3) - (day.deload ? 1 : 0));
      const it = { k: 'block', block: bl.id, rounds };
      if (exs.some(e => painOf(i, e))) it.easy = true;
      const min = itemMinutes(state, it);
      if (min <= room) out.push({ i, kind: 'block', it, min, sets: rounds * exs.length, pref: blocksBonus * Math.pow(0.9, usedNear(i, bl.id)) });
    }
    return out;
  };
  const scoreOf = c => {
    let g;
    if (c.kind === 'set' || c.kind === 'round') {
      const nxt = c.kind === 'set' ? { ...c.it, sets: c.it.sets + 1 } : { ...c.it, rounds: c.it.rounds + 1 };
      const Si = { ...S[c.i] }, Li = { ...L[c.i] }, Ji = { ...J[c.i] }, Ri = { ...R[c.i] };
      contrib(c.it, -1, Si, Li, Ji, Ri); contrib(nxt, 1, Si, Li, Ji, Ri);
      g = delta(c.i, Si, Li, touchedBy(c.it), Ri);
    } else {
      const ids = c.kind === 'ex' ? [c.it.ex] : state.blocks[c.it.block].exIds;
      c.it.jq = jointQ(c.i, ids); c.it.pq = primeQ(c.i, ids);
      g = gain(c.it, c.i);
    }
    g -= sessionDelta(c.i, c.sets);
    return g / c.sets < MIN_GAIN ? null : { ...c, g, score: g * c.pref / c.min };
  };
  // Lazy search: adding training only ever makes other additions worth less (more load, fuller windows),
  // so a score worked out earlier is an upper bound. Take the best-looking option, score it again, and
  // keep it if it still beats every other option's earlier score. The day that changed is scored afresh.
  const fresh = i => candidatesFor(i).map(scoreOf).filter(Boolean).sort((x, y) => y.score - x.score);
  const lists = D.map((_, i) => fresh(i));   // each day's options, best first
  const fill = only => {
    let placed = 0;
    for (let guard = 0; guard < 400000 && placed < 60 * D.length + 100; guard++) {
      let ti = -1, second = -Infinity;
      for (let i = 0; i < lists.length; i++) {
        if (only != null && i !== only) continue;
        const c = lists[i][0]; if (!c) continue;
        if (ti < 0 || c.score > lists[ti][0].score) { if (ti >= 0) second = Math.max(second, lists[ti][0].score); ti = i; }
        else if (c.score > second) second = c.score;
      }
      if (ti < 0) break;
      if (lists[ti][1]) second = Math.max(second, lists[ti][1].score);
      const now = scoreOf(lists[ti][0]);
      if (!now || now.score < second - 1e-12) {
        // worth less than it was: put it back in its place in the day's list (or drop it)
        lists[ti].shift();
        if (now) { let k = 0; while (k < lists[ti].length && lists[ti][k].score > now.score) k++; lists[ti].splice(k, 0, now); }
        continue;
      }
      if (now.kind === 'set') bump(now.i, now.it, 'sets');
      else if (now.kind === 'round') bump(now.i, now.it, 'rounds');
      else place(now.i, { ...now.it, id: uid('i'), src: 'auto' });
      placed++;
      lists[now.i] = fresh(now.i);
    }
  };
  fill(null);

  // ----- 3b. second look, day by day: early in the search every later day is still empty, so a day can get
  // work that later days end up doing anyway (legs today and legs tomorrow, say). Plan each near day again
  // with all the others as they now are, and keep the new version only if the whole plan gets better.
  const objective = () => {
    let v = 0;
    for (const m of MIDS) for (let e = 6; e < N; e++) v += winValue(m, Wn[m][e], Rn[m][e], e, SumW[m], SumR[m]);
    for (let i = 0; i < D.length; i++) {
      for (const m in L[i]) v -= (kappa + (D[i].runCost[m] || 0)) * L[i][m];
      v -= sessionCost(daySetCount(i));
    }
    return v;
  };
  const unplace = (i, it) => { const old = { ...R[i] }; contrib(it, -1, S[i], L[i], J[i], R[i]); D[i].items = D[i].items.filter(x => x !== it); commitDay(i, touchedBy(it), old); };
  const mine = i => D[i].items.filter(x => x.src === 'auto' && !x.mode && !x.pre);
  const replanDay = i => {
    if (D[i].locked) return false;
    const before = objective();
    const old = mine(i).map(x => ({ x, sets: x.sets, rounds: x.rounds }));
    for (const { x } of old) unplace(i, x);
    lists[i] = fresh(i); fill(i);
    if (objective() > before + 1e-6) return true;
    for (const x of mine(i)) unplace(i, x);   // not better: put the day back as it was
    for (const { x, sets, rounds } of old) { if (sets != null) x.sets = sets; if (rounds != null) x.rounds = rounds; place(i, x); }
    return false;
  };
  const nearEnd = ix(from) + 21;   // the next three weeks; later days get the same look as they come closer
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (let i = 0; i < D.length && D[i].ti < nearEnd; i++) if (replanDay(i)) changed = true;
    if (!changed) break;
  }

  // ----- 4. write the days out
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
    if (!chosen.length && !day.fixed.length) out.notes.push(pool.length ? 'Nothing useful fits: the muscles this day targets are still loaded or already at their target.' : 'Add exercises to "My exercises" so the planner has something to work with.');
  }
  // per 7 days over the range: the average of every full 7-day window, and per calendar week for summaries
  const fullEnds = []; for (let e = Math.max(6, ix(from) + 6); e <= toIx; e++) fullEnds.push(e);
  const total = m => { const a = new Float64Array(N); for (let t = 0; t <= toIx; t++) a[t] = base[m][t]; for (let i = 0; i < D.length; i++) a[D[i].ti] += G[i][m] || 0; return a; };
  for (const m of MIDS) {
    const a = total(m);
    const wins = fullEnds.length ? fullEnds : [toIx];
    let sum = 0; for (const e of wins) { let w = 0; for (let t = e - 6; t <= e; t++) w += a[Math.max(0, t)]; sum += w; }
    result.muscles[m] = { per7: sum / wins.length, lo: TG[m].lo, hi: TG[m].hi };
    for (let t = 0; t <= toIx; t++) {
      const date = addDays(t0, t), w = weekStart(date);
      if (date < weekStart(from)) continue;
      result.weeks[w] = result.weeks[w] || {};
      const r = result.weeks[w][m] = result.weeks[w][m] || { eff: 0, lo: TG[m].lo, hi: TG[m].hi };
      r.eff += a[t];
    }
  }
  // what the plan cannot reach
  const missing = MUSCLES.filter(m => TG[m.id].lo > 0 && !reachable.has(m.id)).map(m => m.name);
  if (missing.length && pool.length) result.notes.push(`Nothing in your exercises trains ${listJoin(missing)}. Add an exercise for ${missing.length > 1 ? 'them' : 'it'} under More, Exercises, or set ${missing.length > 1 ? 'their targets' : 'its target'} to 0.`);
  return result;
}
const listJoin = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

/** Sets per muscle over the 7 days from `week` (any start day): logged + planned, for the plan preview. */
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
