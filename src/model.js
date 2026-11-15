// The training model: weight-adjusted volume, hard sets, per-muscle and per-joint load
// that builds with work and fades with rest, and whole-body training load.
// Pure functions over the app state - no DOM, testable in Node.

import { MUSCLES, MUSCLE, JOINTS, JOINT, LIB } from './library.js';
import { clamp, ymd, parseYmd, addDays, weekStart, diffDays } from './util.js';

export const DEFAULTS = {
  bodyweight: 75,
  maxMinutes: 75,
  wavPower: 1,        // 0 = classic volume, 1 = weight counts twice (w^2 * reps / reference)
  wavSessions: 5,     // reference = average weight over this many previous sessions
  capacity: 10,       // load units at which a muscle counts as fully loaded
  readyAt: 0.25,      // fraction of capacity below which a muscle is ready for hard work again
  painCaution: 3,     // pain level from which the planner goes easy
  painAvoid: 5,       // pain level from which the planner avoids loading the area
  deloadEvery: 4,     // every Nth week is lighter (0 = off)
  setsPerExercise: 3,
  theme: 'dark',
  restTimer: true,
  planBlocksBonus: 1.15,
  targets: {},        // per-muscle overrides {id: {lo, hi}}
  halfLife: {},       // per-muscle / joint overrides in hours
  deloadAnchor: null, // Monday of a known deload week
};

export function getSettings(state) {
  return { ...DEFAULTS, ...(state.settings || {}) };
}

export function muscleTarget(settings, id) {
  const o = settings.targets && settings.targets[id];
  return { lo: o?.lo ?? MUSCLE[id].lo, hi: o?.hi ?? MUSCLE[id].hi };
}

export function halfLife(settings, id) {
  return settings.halfLife?.[id] ?? (MUSCLE[id] || JOINT[id]).half;
}

/** Resolve an exercise: built-in definition merged with the user's edits, or a custom one. */
export function getEx(state, id) {
  const u = state.ex && state.ex[id];
  const base = LIB[id];
  if (!base && (!u || u.deleted)) return null;
  if (!u) return base;
  if (!base) return u;
  return { ...base, ...u, muscles: u.muscles || base.muscles, joints: u.joints || base.joints };
}

export function allExercises(state) {
  const out = [];
  const seen = new Set();
  for (const e of Object.values(LIB)) { out.push(getEx(state, e.id)); seen.add(e.id); }
  for (const u of Object.values(state.ex || {})) if (!seen.has(u.id) && !u.deleted && u.custom) out.push(u);
  return out.filter(Boolean);
}

export function myExercises(state) {
  return allExercises(state).filter(e => e.mine);
}

export function bodyweightAt(state, date) {
  let best = null;
  for (const b of Object.values(state.body || {})) {
    if (b.deleted || b.kg == null) continue;
    if (b.date <= date && (!best || b.date > best.date)) best = b;
  }
  return best ? best.kg : getSettings(state).bodyweight;
}

export function effLoad(ex, w, bwKg) {
  return (Number(w) || 0) * (ex.perSide ? 2 : 1) + (ex.bw || 0) * bwKg;
}

/** Load as the user logs it: per hand for dumbbell pairs, total (with bodyweight) for bodyweight moves. */
export function shownLoad(ex, load) { return ex?.bw ? load : load / (ex?.perSide ? 2 : 1); }

export function epley(load, reps) {
  return load * (1 + Math.min(reps, 30) / 30);
}

/** How "hard" a set was, 0..1, from reps in reserve (RIR). <=4 RIR counts as a full hard set. */
export function hardnessFromRir(rir) {
  return clamp(1 - (rir - 4) / 6, 0, 1);
}

/** Session timestamp (ms). Uses the recorded start time if present, otherwise 18:00 on the day. */
export function sessionTime(s) {
  if (s.start) return s.start;
  const d = parseYmd(s.date); d.setHours(18, 0, 0, 0);
  return d.getTime();
}

/** All performed work in a session as flat records. */
export function flatten(session) {
  const sets = [], cardio = [];
  let order = 0;
  for (const it of session.items || []) {
    if (it.k === 'ex') {
      for (const s of it.sets || []) if (s.d && s.r > 0) sets.push({ ex: it.ex, w: s.w || 0, r: s.r, rir: s.rir, f: s.f, order: order++ });
    } else if (it.k === 'block') {
      for (const round of it.rounds || []) {
        round.forEach((s, i) => { if (s && s.d && s.r > 0) sets.push({ ex: it.exIds[i], w: s.w || 0, r: s.r, rir: s.rir, f: s.f, order: order++, block: it.name || true }); });
      }
    } else if (it.k === 'cardio') {
      if (it.d !== false && (it.min > 0 || it.km > 0)) cardio.push({ ex: it.ex, min: it.min || (it.km ? it.km * 6.5 : 0), km: it.km || 0, rpe: it.rpe || 4, note: it.note, name: it.name });
    }
  }
  return { sets, cardio };
}

export function cardioUnits(ex, min, rpe) {
  return (min / 10) * (ex.rate || 0.7) * (0.5 + (rpe || 4) / 8);
}

let cache = { rev: -1, out: null };

/** Full analysis of the log. Memoised on state._rev. */
export function analyze(state) {
  if (cache.rev === state._rev && cache.out && cache.state === state) return cache.out;
  const settings = getSettings(state);
  const sessions = Object.values(state.sessions || {}).filter(s => !s.deleted)
    .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : sessionTime(a) - sessionTime(b));

  const exHist = new Map();   // exId -> [{date, sid, best, meanLoad, reps, sets:[...]}]
  const days = new Map();     // date -> aggregate
  const events = [];          // {t, date, muscles, joints, sys}
  const allSets = [];
  const prs = [];

  const day = date => {
    let d = days.get(date);
    if (!d) { d = { date, vol: 0, wav: 0, sets: 0, hard: 0, load: 0, zones: { strength: 0, hyper: 0, endur: 0 }, muscles: {}, cardioMin: 0, km: 0, runKm: 0, n: 0 }; days.set(date, d); }
    return d;
  };

  for (const s of sessions) {
    const { sets, cardio } = flatten(s);
    if (!sets.length && !cardio.length) continue;
    const d = day(s.date); d.n++;
    const ev = { t: sessionTime(s), date: s.date, muscles: {}, joints: {}, sys: 0 };
    const bwKg = bodyweightAt(state, s.date);

    const byEx = new Map();
    for (const st of sets) { if (!byEx.has(st.ex)) byEx.set(st.ex, []); byEx.get(st.ex).push(st); }

    for (const [exId, list] of byEx) {
      const ex = getEx(state, exId) || { id: exId, name: exId, kind: 'strength', muscles: {}, joints: {}, cost: 1 };
      const hist = exHist.get(exId) || [];
      // -- references from previous sessions
      const recent = hist.slice(-6);
      const priorE = recent.length ? Math.max(...recent.map(h => h.best)) : 0;
      const priorReps = recent.length ? Math.max(...recent.map(h => h.maxReps)) : 0;
      const wavPrev = hist.slice(-settings.wavSessions);
      let refW = 0;
      if (wavPrev.length) {
        let a = 0, b = 0;
        for (const h of wavPrev) { a += h.loadReps; b += h.reps; }
        refW = b ? a / b : 0;
      }
      // -- this session
      let best = 0, maxReps = 0, loadReps = 0, reps = 0;
      for (const st of list) {
        st.load = effLoad(ex, st.w, bwKg);
        st.e1 = st.load > 0 ? epley(st.load, st.r) : 0;
        if (st.f !== 'w') { best = Math.max(best, st.e1); maxReps = Math.max(maxReps, st.r); loadReps += st.load * st.r; reps += st.r; }
      }
      if (!reps) for (const st of list) { best = Math.max(best, st.e1); maxReps = Math.max(maxReps, st.r); loadReps += st.load * st.r; reps += st.r; }
      const refE = Math.max(best, 0.92 * priorE);
      const refReps = Math.max(maxReps, 0.92 * priorReps);
      if (!refW) refW = reps ? loadReps / reps : 0;

      let sVol = 0, sWav = 0, sHard = 0, top = null;
      for (const st of list) {
        // effort
        let hard;
        if (st.f === 'w') hard = 0;
        else if (st.rir != null) hard = hardnessFromRir(st.rir);
        else if (st.load > 0 && refE > 0) {
          const maxR = 30 * (refE / st.load - 1);
          hard = hardnessFromRir(Math.max(0, maxR - st.r));
        } else hard = refReps ? clamp((st.r / refReps - 0.4) / 0.4, 0, 1) : 1;
        if (st.f === 'd') hard = Math.max(hard, 0.5);
        if (st.f === 'h') hard = 1;
        st.hard = hard;
        st.pct = st.load > 0 && refE > 0 ? Math.min(1.05, st.load / refE) : 0.6;
        st.zone = st.load > 0 && refE > 0 ? (st.pct >= 0.85 ? 'strength' : st.pct >= 0.6 ? 'hyper' : 'endur') : (st.r <= 5 ? 'strength' : st.r <= 20 ? 'hyper' : 'endur');
        st.vol = st.load * st.r;
        st.wav = refW > 0 ? st.vol * Math.pow(st.load / refW, settings.wavPower) : st.vol;
        st.date = s.date; st.sid = s.id;
        sVol += st.vol; sWav += st.wav; sHard += hard;
        if (!top || st.load > top.load || (st.load === top.load && st.r > top.r)) top = st;
        d.vol += st.vol; d.wav += st.wav; d.sets++; d.hard += hard; d.zones[st.zone] += st.vol;
        // muscles: fractional hard sets + fatigue units
        const eff = st.f === 'w' ? 0.1 : 0.15 + 0.85 * hard;
        for (const [m, c] of Object.entries(ex.muscles || {})) {
          if (!MUSCLE[m]) continue;
          d.muscles[m] = (d.muscles[m] || 0) + hard * c;
          ev.muscles[m] = (ev.muscles[m] || 0) + eff * c * (ex.cost || 1);
        }
        for (const [j, c] of Object.entries(ex.joints || {})) {
          if (!JOINT[j]) continue;
          ev.joints[j] = (ev.joints[j] || 0) + (0.3 + 0.7 * hard) * c * (0.5 + Math.min(1, st.pct));
        }
        const sys = 10 * (ex.cost || 1) * (0.3 + 0.7 * hard);
        ev.sys += sys; d.load += sys;
        allSets.push(st);
      }
      const rec = { date: s.date, sid: s.id, best, maxReps, loadReps, reps, vol: sVol, wav: sWav, hard: sHard, top: top && { w: top.w, r: top.r, load: top.load }, sets: list.map(x => ({ w: x.w, r: x.r, hard: x.hard, f: x.f })) };
      // PR detection (estimated 1RM), ignoring the very first session of an exercise
      if (hist.length >= 2 && best > 0) {
        const prevBest = Math.max(...hist.map(h => h.best));
        if (best > prevBest * 1.001) { rec.pr = true; prs.push({ date: s.date, ex: exId, e1: best, prev: prevBest, top: rec.top }); }
      }
      hist.push(rec);
      exHist.set(exId, hist);
    }

    for (const c of cardio) {
      const ex = getEx(state, c.ex) || LIB.cardio_other;
      const units = cardioUnits(ex, c.min, c.rpe);
      for (const [m, k] of Object.entries(ex.muscles || {})) ev.muscles[m] = (ev.muscles[m] || 0) + units * k;
      for (const [j, k] of Object.entries(ex.joints || {})) ev.joints[j] = (ev.joints[j] || 0) + units * k;
      const sys = c.min * c.rpe * 0.5;
      ev.sys += sys; d.load += sys; d.cardioMin += c.min; d.km += c.km || 0;
      if (ex.id === 'run' || ex.id === 'treadmill_run') d.runKm += c.km || 0;
    }
    events.push(ev);
  }

  // ---- weekly aggregates
  const weeks = new Map();
  for (const d of days.values()) {
    const wk = weekStart(d.date);
    let w = weeks.get(wk);
    if (!w) { w = { week: wk, vol: 0, wav: 0, sets: 0, hard: 0, load: 0, zones: { strength: 0, hyper: 0, endur: 0 }, muscles: {}, cardioMin: 0, km: 0, runKm: 0, days: 0 }; weeks.set(wk, w); }
    w.vol += d.vol; w.wav += d.wav; w.sets += d.sets; w.hard += d.hard; w.load += d.load; w.cardioMin += d.cardioMin; w.km += d.km; w.runKm += d.runKm; w.days++;
    for (const z in d.zones) w.zones[z] += d.zones[z];
    for (const m in d.muscles) w.muscles[m] = (w.muscles[m] || 0) + d.muscles[m];
  }

  const out = { settings, sessions, days, weeks, events, exHist, allSets, prs };
  cache = { rev: state._rev, state, out };
  return out;
}

/** Load on every muscle and joint at time t (ms), from past events plus optional extra (planned) events. */
export function loadAt(an, t, extra = []) {
  const s = an.settings;
  const muscles = {}, joints = {}, sumM = {}, sumJ = {};
  for (const m of MUSCLES) { muscles[m.id] = 0; sumM[m.id] = 0; }
  for (const j of JOINTS) { joints[j.id] = 0; sumJ[j.id] = 0; }
  const horizon = t - 28 * 86400000;
  const add = (ev, logged) => {
    if (ev.t > t || ev.t < horizon) return;
    const h = (t - ev.t) / 3600000;
    for (const m in ev.muscles) if (m in muscles) { muscles[m] += ev.muscles[m] * Math.pow(0.5, h / halfLife(s, m)); if (logged) sumM[m] += ev.muscles[m]; }
    for (const j in ev.joints) if (j in joints) { joints[j] += ev.joints[j] * Math.pow(0.5, h / halfLife(s, j)); if (logged) sumJ[j] += ev.joints[j]; }
  };
  for (let i = an.events.length - 1; i >= 0; i--) { const ev = an.events[i]; if (ev.t < horizon) break; add(ev, true); }
  for (const ev of extra) add(ev, false);
  // Capacity adapts to what the tissue is used to: at least the base, or ADAPT days of the
  // 4-week average daily load. Someone who runs five times a week has an Achilles that copes with more.
  const capM = {}, capJ = {}, fm = {}, fj = {};
  for (const m in muscles) { capM[m] = Math.max(s.capacity, ADAPT * sumM[m] / 28); fm[m] = muscles[m] / capM[m]; }
  for (const j in joints) { capJ[j] = Math.max(s.capacity, ADAPT * sumJ[j] / 28); fj[j] = joints[j] / capJ[j]; }
  return { muscles, joints, capM, capJ, fm, fj };
}
const ADAPT = 3.5;

export const STATUS = [
  { max: 0.2, id: 'fresh', label: 'Fresh' },
  { max: 0.45, id: 'light', label: 'Recovering' },
  { max: 0.75, id: 'loaded', label: 'Loaded' },
  { max: Infinity, id: 'heavy', label: 'Heavily loaded' },
];
export function statusOf(frac) { return STATUS.find(s => frac < s.max); }

/** Hours until the load on a muscle/joint falls to the "ready" level. */
export function hoursToReady(settings, id, load, cap = settings.capacity) {
  const target = settings.readyAt * cap;
  if (load <= target) return 0;
  return halfLife(settings, id) * Math.log2(load / target);
}

/** Whole-body training load: daily series with 7-day (acute) and 28-day (chronic) moving averages. */
export function loadSeries(an, from, to) {
  const out = [];
  let acute = 0, chronic = 0;
  const la = 2 / (7 + 1), lc = 2 / (28 + 1);
  const first = an.sessions.length ? an.sessions[0].date : from;
  let d = first < addDays(from, -60) ? addDays(from, -60) : (first < from ? first : from);
  // warm-up the averages over the 60 days before `from`
  while (d <= to) {
    const v = an.days.get(d)?.load || 0;
    acute += la * (v - acute); chronic += lc * (v - chronic);
    if (d >= from) out.push({ date: d, load: v, acute, chronic, ratio: chronic > 1 ? acute / chronic : null });
    d = addDays(d, 1);
  }
  return out;
}

/** Latest pain rating per region (entries older than 14 days are treated as resolved). */
export function currentPain(state, now = Date.now()) {
  const out = {};
  for (const p of Object.values(state.pain || {})) {
    if (p.deleted) continue;
    if (now - p.t > 14 * 86400000) continue;
    if (!out[p.region] || p.t > out[p.region].t) out[p.region] = p;
  }
  for (const k of Object.keys(out)) if (!(out[k].level > 0)) delete out[k];
  return out;
}

/** What to aim for next time on an exercise: reps first, then load. */
export function suggest(state, an, exId, beforeDate) {
  const ex = getEx(state, exId);
  let hist = an.exHist.get(exId) || [];
  if (beforeDate) hist = hist.filter(h => h.date < beforeDate);
  if (!hist.length || !ex) return null;
  const last = hist[hist.length - 1];
  const work = last.sets.filter(s => s.hard >= 0.5);
  const basis = work.length ? work : last.sets;
  const topW = Math.max(...basis.map(s => s.w));
  const atTop = basis.filter(s => s.w === topW);
  const minReps = Math.min(...atTop.map(s => s.r));
  const lo = ex.repLo || 8, hi = ex.repHi || 12;
  let target;
  if (minReps >= hi) {
    const step = topW >= 40 ? 5 : topW >= 20 ? 2.5 : topW >= 10 ? 1 : topW > 0 ? 0.5 : 0;
    target = step ? { w: topW + step, r: lo, why: `All sets reached ${hi} reps. Add weight.` } : { w: topW, r: minReps + 1, why: 'Add a rep.' };
  } else {
    target = { w: topW, r: Math.min(hi, Math.max(...atTop.map(s => s.r)) + 1), why: `Same weight, one more rep (up to ${hi}).` };
  }
  return { last, target, ex };
}

/** Summary of one session for display. */
export function sessionSummary(state, an, session) {
  const sets = an.allSets.filter(s => s.sid === session.id);
  const { cardio } = flatten(session);
  const muscles = {};
  let vol = 0, wav = 0, hard = 0;
  for (const s of sets) {
    vol += s.vol; wav += s.wav; hard += s.hard;
    const ex = getEx(state, s.ex);
    for (const [m, c] of Object.entries(ex?.muscles || {})) muscles[m] = (muscles[m] || 0) + s.hard * c;
  }
  const prs = an.prs.filter(p => p.date === session.date && sets.some(s => s.ex === p.ex));
  return { sets: sets.length, vol, wav, hard, muscles, prs, cardioMin: cardio.reduce((a, c) => a + c.min, 0), km: cardio.reduce((a, c) => a + (c.km || 0), 0) };
}

/** Is `week` (a Monday) a lighter week? */
export function isDeloadWeek(settings, week) {
  if (!settings.deloadEvery || !settings.deloadAnchor) return false;
  const n = Math.round(diffDays(week, settings.deloadAnchor) / 7);
  return ((n % settings.deloadEvery) + settings.deloadEvery) % settings.deloadEvery === 0;
}

export { ymd };
