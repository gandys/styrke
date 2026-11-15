// Automatic planner. Fills the days you committed to with exercises and blocks so that each
// muscle gets its weekly dose, is trained when it has recovered, and the session fits the clock.

import { MUSCLES, MUSCLE, JOINT, TYPE, fitsType, primaryMuscle } from './library.js';
import { getEx, getSettings, muscleTarget, loadAt, currentPain, cardioUnits, isDeloadWeek, myExercises } from './model.js';
import { addDays, weekStart, parseYmd, ymd, uid, diffDays } from './util.js';

const WORK_SEC = 40;      // time under the bar per set
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
  return (sets * (WORK_SEC + (ex?.rest || 90)) + SETUP_SEC) / 60;
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
  if (it.k === 'ex') addEx(it.ex, it.sets || 3);
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

/** Future planned days (from `from`, inclusive) as load events, for forecasts. */
export function futureEvents(state, from, to) {
  const out = [];
  for (const pd of Object.values(state.plan || {})) {
    if (pd.deleted || !pd.on || pd.date < from || (to && pd.date > to)) continue;
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

function marginal(v, lo, hi) {
  const base = 1 / Math.sqrt(1 + v);
  if (v < lo) return 1.6 * base;
  if (v < hi) return base;
  return 0.12 * base;
}

/**
 * Build a plan for every committed day between from and to.
 * Returns { days: {date: {items, minutes, notes}}, weeks: {...} } without touching state.
 */
export function autoPlan(state, an, { from, to, today = ymd() } = {}) {
  const settings = getSettings(state);
  const pain = currentPain(state);
  const pool = myExercises(state).filter(e => e.kind === 'strength' && e.plan !== false);
  const blocks = Object.values(state.blocks || {}).filter(b => !b.deleted && b.plan !== false && b.exIds?.length);
  const presets = Object.values(state.presets || {}).filter(p => !p.deleted);
  const usePresets = settings.planMode === 'presets' && presets.some(p => p.plan !== false);
  const result = { days: {}, notes: [] };

  const planDays = Object.values(state.plan || {}).filter(p => !p.deleted && p.on && p.date >= from && p.date <= to)
    .sort((a, b) => a.date < b.date ? -1 : 1);
  if (!planDays.length) return result;

  // events already fixed in the future: user-added and imported items on any day (also outside the range)
  const fixedItems = pd => (pd.items || []).filter(it => it.src !== 'auto');
  const extra = [];
  for (const pd of Object.values(state.plan || {})) {
    if (pd.deleted || !pd.on || pd.date < today) continue;
    const fi = fixedItems(pd);
    const inRange = pd.date >= from && pd.date <= to;
    const items = inRange ? fi : (pd.items || []);
    if (items.length) extra.push({ ...planDayEvent(state, { date: pd.date, items }), date: pd.date });
  }

  // group by week
  const byWeek = new Map();
  for (const pd of planDays) { const w = weekStart(pd.date); if (!byWeek.has(w)) byWeek.set(w, []); byWeek.get(w).push(pd); }

  const allowed = (pd, ex) => {
    const t = pd.type || 'auto';
    if (t === 'rest' || t === 'custom' || t === 'cardio') return false;
    if (t.startsWith('preset:')) return false;
    return fitsType(ex, t);
  };

  for (const [week, days] of byWeek) {
    const deload = isDeloadWeek(settings, week);
    // sets already done or fixed this week
    const done = {};
    for (const m of MUSCLES) done[m.id] = 0;
    for (let d = week; d < addDays(week, 7); d = addDays(d, 1)) {
      if (d < today) { const day = an.days.get(d); if (day) for (const m in day.muscles) done[m] += day.muscles[m]; }
      else if (d === today) { const day = an.days.get(d); if (day) for (const m in day.muscles) done[m] += day.muscles[m]; }
    }
    for (const ev of extra) if (ev.date >= week && ev.date < addDays(week, 7)) for (const m in ev.sets) done[m] = (done[m] || 0) + ev.sets[m];

    // how many of this week's days can train each muscle -> per-session cap
    const eligible = {};
    for (const m of MUSCLES) eligible[m.id] = 0;
    for (const pd of days) {
      const t = pd.type || 'auto';
      if (t === 'rest' || t === 'custom' || t === 'cardio') continue;
      const ms = t.startsWith('preset:') || !TYPE[t]?.m ? MUSCLES.map(m => m.id) : TYPE[t].m;
      for (const m of ms) eligible[m]++;
    }
    const usedCount = {};

    for (const pd of days) {
      const date = pd.date;
      const type = pd.type || 'auto';
      const out = { items: [], notes: [], minutes: 0 };
      result.days[date] = out;
      const fixed = fixedItems(pd);
      const budgetAll = (pd.minutes || settings.maxMinutes) * (deload ? 0.85 : 1);
      // cardio you already fixed for the day counts half against the gym clock (unless set to count fully)
      const fixedCardioMin = fixed.filter(i => i.k === 'cardio').reduce((a, i) => a + itemMinutes(state, i), 0);
      let used = planMinutes(state, fixed.filter(i => i.k !== 'cardio')) + fixedCardioMin * (settings.cardioInBudget ? 1 : 0.5);
      const t = dayTime(date);
      const ahead = Math.max(0, diffDays(date, today));
      if (deload) out.notes.push('Lighter week: one set fewer per exercise.');

      if (type === 'rest' || type === 'custom') { out.items = fixed; out.minutes = used; continue; }

      // pain notes on fixed items
      for (const it of fixed) {
        const ex = it.k !== 'block' ? getEx(state, it.ex) : null;
        const pc = ex && painCheck(state, ex, date, settings, pain, today);
        if (pc) out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: ${pc.level === 'avoid' ? 'consider moving or swapping' : 'go easy on'} ${it.name || ex.name}.`);
      }

      if (type === 'cardio') {
        const items = [...fixed];
        if (!fixed.some(i => i.k === 'cardio')) {
          const cardio = myExercises(state).filter(e => e.kind === 'cardio');
          let pick = cardio.find(e => !painCheck(state, e, date, settings, pain, today)) || cardio[0];
          if (pick) items.push({ id: uid('i'), k: 'cardio', ex: pick.id, min: Math.min(40, Math.round(budgetAll)), rpe: 4, src: 'auto' });
        }
        out.items = items; out.minutes = planMinutes(state, items);
        extra.push({ ...planDayEvent(state, { date, items: items.filter(i => i.src === 'auto') }), date });
        continue;
      }

      const state0 = loadAt(an, t, extra.filter(e => e.t <= t));
      const cap = settings.capacity;
      const fresh = m => {
        const f = state0.fm[m];
        if (f <= settings.readyAt) return 1;
        return Math.max(0.05, 1 - (f - settings.readyAt) / 0.3);   // still loaded: rapidly less worth training
      };
      const sessionSets = {};
      for (const it of fixed) { const e = itemEvent(state, it, t); for (const m in e.sets) sessionSets[m] = (sessionSets[m] || 0) + e.sets[m]; }
      const sessCap = m => Math.max(4, Math.min(9, Math.ceil(muscleTarget(settings, m).hi / Math.max(1, eligible[m]) * 1.25)));

      const benefitOf = (exId, sets, simSets = sessionSets) => {
        const ex = getEx(state, exId); if (!ex) return 0;
        let b = 0;
        for (const [m, c] of Object.entries(ex.muscles || {})) {
          if (!MUSCLE[m]) continue;
          const { lo, hi } = muscleTarget(settings, m);
          const v = done[m] + c * sets / 2;
          let f = marginal(v, lo, hi) * fresh(m);
          if ((simSets[m] || 0) + c * sets > sessCap(m) + 0.01) f *= 0.3;
          b += c * sets * f;
        }
        // joints: back off when the joint is already carrying a lot
        for (const [j, c] of Object.entries(ex.joints || {})) if (c >= 0.5 && state0.fj[j] > 0.75) b *= 0.6;
        return b;
      };

      let chosen = [];
      const chosenEx = new Set();
      for (const it of fixed) { if (it.k === 'ex') chosenEx.add(it.ex); if (it.k === 'block') for (const id of (it.exIds || state.blocks?.[it.block]?.exIds || [])) chosenEx.add(id); }
      const commit = (it) => {
        chosen.push(it);
        const e = itemEvent(state, it, t);
        for (const m in e.sets) { sessionSets[m] = (sessionSets[m] || 0) + e.sets[m]; done[m] = (done[m] || 0) + e.sets[m]; }
        used += itemMinutes(state, it) + (chosen.length === 1 && !fixed.some(f => f.k !== 'cardio') ? WARMUP_MIN : 0);
      };

      if (type.startsWith('preset:') || (usePresets && type === 'auto')) {
        // whole presets as the unit
        let preset = type.startsWith('preset:') ? state.presets?.[type.slice(7)] : null;
        if (!preset) {
          let best = null, bs = -1;
          for (const p of presets.filter(p => p.plan !== false)) {
            let s = 0;
            for (const it of p.items || []) {
              if (it.k === 'ex') s += benefitOf(it.ex, it.sets || 3);
              else if (it.k === 'block') for (const id of (state.blocks?.[it.block]?.exIds || [])) s += benefitOf(id, it.rounds || state.blocks[it.block].rounds || 3);
            }
            s *= Math.pow(0.8, usedCount['p:' + p.id] || 0);
            if (s > bs) { bs = s; best = p; }
          }
          preset = best;
          if (preset) { usedCount['p:' + preset.id] = (usedCount['p:' + preset.id] || 0) + 1; out.preset = preset.id; out.notes.push(`Preset: ${preset.name}`); }
        }
        for (const it of preset?.items || []) {
          const item = { ...it, id: uid('i'), src: 'auto' };
          if (item.k === 'ex') {
            const ex = getEx(state, item.ex); if (!ex) continue;
            const pc = painCheck(state, ex, date, settings, pain, today);
            if (pc?.level === 'avoid') { out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: left out ${ex.name}.`); continue; }
            if (pc) out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: go easy on ${ex.name}.`);
            if (deload) item.sets = Math.max(2, (item.sets || 3) - 1);
          }
          if (used + itemMinutes(state, item) > budgetAll + 3) { out.notes.push('Preset trimmed to fit your time.'); break; }
          commit(item);
        }
      } else {
        // greedy fill by benefit per minute
        const baseSets = Math.max(2, settings.setsPerExercise - (deload ? 1 : 0));
        const painNoted = new Set();
        for (let guard = 0; guard < 30; guard++) {
          let best = null;
          for (const ex of pool) {
            if (chosenEx.has(ex.id) || !allowed(pd, ex)) continue;
            const pc = painCheck(state, ex, date, settings, pain, today);
            if (pc?.level === 'avoid') { if (!painNoted.has(pc.region)) { painNoted.add(pc.region); out.notes.push(`${JOINT[pc.region].name} ${pc.pain}/10: exercises that load it are left out.`); } continue; }
            const it = { k: 'ex', ex: ex.id, sets: baseSets, repLo: ex.repLo, repHi: ex.repHi };
            const min = itemMinutes(state, it);
            if (used + min > budgetAll + 1) continue;
            let b = benefitOf(ex.id, baseSets) * Math.pow(0.88, usedCount[ex.id] || 0);
            if (pc) b *= 0.5;
            const score = b / min;
            if (b / baseSets > 0.16 && (!best || score > best.score)) best = { it, score, pc, ex };
          }
          for (const bl of blocks) {
            if (bl.exIds.some(id => chosenEx.has(id))) continue;
            const exs = bl.exIds.map(id => getEx(state, id)).filter(Boolean);
            if (exs.length !== bl.exIds.length || !exs.every(e => allowed(pd, e))) continue;
            if (exs.some(e => painCheck(state, e, date, settings, pain, today)?.level === 'avoid')) continue;
            const rounds = Math.max(2, (bl.rounds || 3) - (deload ? 1 : 0));
            const it = { k: 'block', block: bl.id, rounds };
            const min = itemMinutes(state, it);
            if (used + min > budgetAll + 1) continue;
            let b = 0; const sim = { ...sessionSets };
            for (const e of exs) { b += benefitOf(e.id, rounds, sim); for (const [m, c] of Object.entries(e.muscles)) sim[m] = (sim[m] || 0) + c * rounds; }
            b *= settings.planBlocksBonus * Math.pow(0.9, usedCount['b:' + bl.id] || 0);
            const score = b / min;
            if (b / (rounds * exs.length) > 0.16 && (!best || score > best.score)) best = { it, score, block: bl };
          }
          if (!best) break;
          const item = { ...best.it, id: uid('i'), src: 'auto' };
          if (best.pc) { item.easy = true; out.notes.push(`${JOINT[best.pc.region].name} ${best.pc.pain}/10: go easy on ${best.ex.name}.`); }
          commit(item);
          if (best.block) { usedCount['b:' + best.block.id] = (usedCount['b:' + best.block.id] || 0) + 1; for (const id of best.block.exIds) chosenEx.add(id); }
          else { usedCount[best.ex.id] = (usedCount[best.ex.id] || 0) + 1; chosenEx.add(best.ex.id); }
        }
        // spare time left: add a set where it still pays off
        for (let guard = 0; guard < 12; guard++) {
          let best = null;
          for (const it of chosen) {
            if (it.k !== "ex" || it.sets >= 4) continue;
            const ex = getEx(state, it.ex);
            const min = (WORK_SEC + (ex.rest || 90)) / 60;
            if (used + min > budgetAll + 1) continue;
            const b = benefitOf(it.ex, 1) * (it.easy ? 0.5 : 1);
            if (b > 0.3 && (!best || b / min > best.score)) best = { it, score: b / min, min };
          }
          if (!best) break;
          best.it.sets++;
          const ex = getEx(state, best.it.ex);
          for (const [m, c] of Object.entries(ex.muscles || {})) { sessionSets[m] = (sessionSets[m] || 0) + c; done[m] = (done[m] || 0) + c; }
          used += best.min;
        }
        if (!chosen.length && !fixed.length) out.notes.push(pool.length ? 'Nothing useful fits: the muscles this day targets are still loaded or already at their weekly target.' : 'Add exercises to "My exercises" so the planner has something to work with.');
      }

      // order: big compounds first, then blocks, then isolation, core last
      const rank = it => {
        if (it.k === 'cardio') return -1;
        if (it.k === 'block') return 2;
        const ex = getEx(state, it.ex); const pm = primaryMuscle(ex);
        if (MUSCLE[pm]?.group === 'core') return 4;
        return ex?.mech === 'compound' ? (ex.cost > 1.2 ? 0 : 1) : 3;
      };
      chosen = chosen.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it) - rank(b.it) || a.i - b.i).map(x => x.it);
      const fixedCardio = fixed.filter(i => i.k === 'cardio'), fixedOther = fixed.filter(i => i.k !== 'cardio');
      out.items = [...fixedCardio, ...fixedOther, ...chosen];
      out.minutes = planMinutes(state, out.items);
      if (chosen.length) extra.push({ ...planDayEvent(state, { date, items: chosen }), date });
    }
  }
  return result;
}

/** Weekly sets per muscle a plan would deliver (logged + planned), for the plan preview. */
export function weekProjection(state, an, week, today = ymd()) {
  const sets = {};
  for (const m of MUSCLES) sets[m.id] = { done: 0, planned: 0 };
  for (let d = week; d < addDays(week, 7); d = addDays(d, 1)) {
    const day = an.days.get(d);
    if (day) for (const m in day.muscles) sets[m].done += day.muscles[m];
    const pd = state.plan?.[d];
    if (pd && pd.on && !pd.deleted && d >= today && !(d === today && day)) {
      const ev = planDayEvent(state, pd);
      for (const m in ev.sets) if (sets[m]) sets[m].planned += ev.sets[m];
    }
  }
  return sets;
}
