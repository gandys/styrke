// Insights: trends in volume, weight-adjusted volume, stimulus mix, load, and per-exercise progress.

import { h, icon, sheet, seg } from '../ui.js';
import { state } from '../store.js';
import { analyze, loadSeries, getEx, suggest, sessionSummary, shownLoad, loadHistory, muscleTarget, statusOf } from '../model.js';
import { MUSCLE, MUSCLES, JOINTS, JOINT } from '../library.js';
import { lineChart, barChart, legend, cssVar } from '../charts.js';
import { loadColor } from '../bodymap.js';
import { ymd, addDays, weekStart, fmtDate, fmtNum, fmtW, parseYmd, MONTHS_SHORT, relDay, fmtMin } from '../util.js';
import { exName } from './common.js';

let range = 12;       // weeks
let selEx = null;
let view = 'overview';
let selMuscle = null;
let pick = null;        // selected cell in the load-over-time grid

const wkLabel = w => { const d = parseYmd(w); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };

function weekList(an, n) {
  const today = ymd(); const cur = weekStart(today);
  let first = addDays(cur, -(n - 1) * 7);
  if (n >= 999) first = an.sessions.length ? weekStart(an.sessions[0].date) : cur;
  const out = [];
  for (let w = first; w <= cur; w = addDays(w, 7)) out.push(an.weeks.get(w) || { week: w, vol: 0, wav: 0, sets: 0, hard: 0, load: 0, zones: { strength: 0, hyper: 0, endur: 0 }, muscles: {}, mvol: {}, mwav: {}, cardioMin: 0, km: 0, runKm: 0, days: 0 });
  return out;
}

export function renderInsights(root, ctx) {
  const an = analyze(state);
  const today = ymd();
  ctx.setTitle('Insights', 'How your training is trending');
  if (!an.sessions.length) {
    root.appendChild(h('div', { class: 'empty' }, h('b', null, 'No training logged yet'), 'Charts appear after your first workout. You can also bring in your history from Notion or a spreadsheet under More, Backup and import.'));
    return;
  }
  const c1 = cssVar('--c1'), c2 = cssVar('--c2'), c3 = cssVar('--c3');
  const weeks = weekList(an, range);
  const labels = weeks.map(w => wkLabel(w.week));
  const cur = weeks[weeks.length - 1], prev = weeks[weeks.length - 2];
  const delta = (a, b) => { if (!b || !b) return ''; const p = (a - b) / b * 100; return (p >= 0 ? '+' : '') + Math.round(p) + '% vs last week'; };

  root.appendChild(h('div', { style: { marginBottom: '8px' } }, seg([{ id: 'overview', name: 'Overview' }, { id: 'muscles', name: 'Muscles' }, { id: 'strength', name: 'Strength' }], view, v => { view = v; ctx.refresh(true); })));
  root.appendChild(h('div', { style: { marginBottom: '12px' } }, seg([{ id: 8, name: '8 weeks' }, { id: 12, name: '12 weeks' }, { id: 26, name: '6 months' }, { id: 52, name: '1 year' }, { id: 999, name: 'All' }], range, v => { range = v; ctx.refresh(); })));

  const tiles = h('div', { class: 'tiles four' },
    h('div', { class: 'tile' }, h('div', { class: 'v' }, cur.days), h('div', { class: 'k' }, 'Training days this week'), h('div', { class: 'delta' }, prev ? `${prev.days} last week` : '')),
    h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtNum(cur.hard, 1)), h('div', { class: 'k' }, 'Hard sets'), h('div', { class: 'delta' }, prev?.hard ? delta(cur.hard, prev.hard) : '')),
    h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtNum(cur.vol), h('small', null, 'kg')), h('div', { class: 'k' }, 'Volume'), h('div', { class: 'delta' }, prev?.vol ? delta(cur.vol, prev.vol) : '')),
    h('div', { class: 'tile' }, h('div', { class: 'v' }, fmtNum(cur.wav), h('small', null, 'kg')), h('div', { class: 'k' }, 'Weight-adjusted volume'), h('div', { class: 'delta' }, prev?.wav ? delta(cur.wav, prev.wav) : '')));

  const volPanel = h('div', { class: 'panel' },
    h('h2', null, 'Volume and weight-adjusted volume'),
    legend([{ name: 'Volume (kg × reps)', color: c1 }, { name: 'Weight-adjusted', color: c2 }]),
    lineChart({ labels, unit: 'kg', series: [{ name: 'Volume', color: c1, values: weeks.map(w => w.vol) }, { name: 'Weight-adjusted', color: c2, values: weeks.map(w => w.wav) }] }),
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'When the amber line is above the blue one you lifted heavier than your recent usual. Below it, lighter. Same kilos moved, different stimulus.'));

  const zonePanel = h('div', { class: 'panel' },
    h('h2', null, 'What kind of work'),
    legend([{ name: 'Heavy (85%+ of best)', color: c3 }, { name: 'Moderate (60–85%)', color: c1 }, { name: 'Light (under 60%)', color: c2 }]),
    barChart({ unit: 'kg', bars: weeks.map((w, i) => ({ label: labels[i], tip: 'Week of ' + labels[i], segs: [{ name: 'Light', color: c2, v: w.zones.endur }, { name: 'Moderate', color: c1, v: w.zones.hyper }, { name: 'Heavy', color: c3, v: w.zones.strength }] })) }),
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Volume split by how heavy each set was against your estimated best for that exercise. Heavy builds maximal strength, moderate is the main muscle-building zone, light is endurance and warm-up.'));

  // whole-body load
  const days = Math.min(range >= 999 ? 180 : range * 7, 180);
  const ls = loadSeries(an, addDays(today, -days + 1), today);
  const lastL = ls[ls.length - 1];
  const step = Math.max(1, Math.floor(ls.length / 60));
  const lsS = ls.filter((_, i) => i % step === 0 || i === ls.length - 1);
  const ratio = lastL.ratio;
  const loadPanel = h('div', { class: 'panel' },
    h('h2', null, 'Whole-body training load'),
    legend([{ name: 'Last 7 days (fatigue)', color: c1 }, { name: 'Last 28 days (what you are used to)', color: c2, dash: true }]),
    lineChart({ labels: lsS.map(d => wkLabel(d.date)), series: [{ name: '7 days', color: c1, values: lsS.map(d => d.acute) }, { name: '28 days', color: c2, dash: true, values: lsS.map(d => d.chronic) }], fmt: v => fmtNum(v) }),
    ratio != null ? h('div', { class: 'banner ' + (ratio > 1.5 ? '' : 'info'), style: { marginTop: '10px', marginBottom: 0 } }, icon(ratio > 1.5 ? 'warn' : 'info'),
      h('div', null, h('b', null, `This week is ${fmtNum(ratio * 100)}% of your usual load. `), ratio > 1.5 ? 'That is a sharp jump. Spikes like this are when tendons complain, so consider an easier day.' : ratio > 1.15 ? 'You are building: more than you are used to, within a sensible step.' : ratio >= 0.8 ? 'Steady.' : 'Lighter than usual: a recovery or deload stretch.')) : null,
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Gym sets and cardio in one number. Treat the comparison as a guard against sudden spikes, not as an injury predictor.'));

  // exercise progress
  const used = [...an.exHist.entries()].filter(([id, hs]) => hs.length >= 1 && getEx(state, id)?.kind !== 'cardio').sort((a, b) => b[1].length - a[1].length);
  if (!selEx || !an.exHist.has(selEx)) selEx = used[0]?.[0] || null;
  let exPanel = null;
  if (selEx) {
    const hs = an.exHist.get(selEx).slice(range >= 999 ? 0 : -Math.max(8, range * 3));
    const sx = getEx(state, selEx);
    exPanel = h('div', { class: 'panel' },
      h('h2', null, 'Exercise progress', h('button', { class: 'more', onClick: () => showExerciseHistory(selEx) }, 'Details')),
      h('select', { 'aria-label': 'Exercise', onChange: e => { selEx = e.target.value; ctx.refresh(); } }, used.map(([id, list]) => h('option', { value: id, selected: id === selEx }, `${exName(id)} (${list.length})`))),
      h('div', { style: { height: '10px' } }),
      legend([{ name: 'Estimated one-rep best', color: c1 }, { name: 'Heaviest set', color: c2 }]),
      lineChart({ labels: hs.map(x => wkLabel(x.date)), unit: 'kg', min0: false, fmt: v => fmtNum(v, 1), series: [{ name: 'Est. best', color: c1, values: hs.map(x => x.best ? shownLoad(sx, x.best) : null) }, { name: 'Heaviest', color: c2, values: hs.map(x => x.top ? shownLoad(sx, x.top.load) : null) }] }),
      sx?.perSide || sx?.bw ? h('p', { class: 'note tiny', style: { marginTop: '6px' } }, sx.bw ? 'Includes the share of your bodyweight you lift.' : 'Per hand, as you log it.') : null);
  }

  const runWeeks = weeks.some(w => w.km > 0 || w.cardioMin > 0);
  const cardioPanel = runWeeks ? h('div', { class: 'panel' },
    h('h2', null, 'Cardio per week'),
    barChart({ unit: 'min', height: 140, bars: weeks.map((w, i) => ({ label: labels[i], tip: `Week of ${labels[i]}${w.km ? ', ' + fmtNum(w.km, 1) + ' km' : ''}`, segs: [{ name: 'Minutes', color: c2, v: w.cardioMin }] })) })) : null;

  // consistency heatmap (26 weeks)
  const hmStart = addDays(weekStart(today), -25 * 7);
  const maxLoad = Math.max(1, ...[...an.days.values()].filter(d => d.date >= hmStart).map(d => d.load));
  const heatCells = [];
  for (let d = hmStart; d <= addDays(weekStart(today), 6); d = addDays(d, 1)) {
    const day = an.days.get(d);
    heatCells.push(h('i', { title: `${fmtDate(d)}${day ? ': load ' + fmtNum(day.load) : ''}`, style: day ? { background: c1, opacity: 0.3 + 0.7 * Math.min(1, day.load / maxLoad) } : (d > today ? { opacity: 0.35 } : null) }));
  }
  const active = [...an.days.keys()].filter(d => d >= hmStart).length;
  const heatPanel = h('div', { class: 'panel' },
    h('h2', null, 'Consistency', h('span', { class: 'note', style: { fontWeight: 400 } }, `${active} training days in 26 weeks`)),
    h('div', { class: 'heat' }, heatCells));

  const prs = an.prs.slice(-8).reverse();
  const prPanel = prs.length ? h('div', { class: 'panel' },
    h('h2', null, 'Recent bests'),
    h('table', { class: 't' }, h('tbody', null, prs.map(p => h('tr', null, h('td', { class: 'dim', style: { whiteSpace: 'nowrap' } }, fmtDate(p.date)), h('td', null, exName(p.ex)), h('td', { class: 'n' }, `${fmtW(p.top.w)} × ${p.top.r}`)))))) : null;

  const recent = an.sessions.slice(-12).reverse();
  const histPanel = h('div', { class: 'panel', style: { padding: '4px 14px' } },
    h('div', { class: 'list' }, recent.map(s => { const sm = sessionSummary(state, an, s); const top = Object.entries(sm.muscles).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m]) => MUSCLE[m]?.name).filter(Boolean);
      return h('button', { onClick: () => ctx.openDate(s.date) },
        h('div', { class: 't', style: { width: '92px', flex: 'none' } }, relDay(s.date, today)),
        h('div', { class: 'grow' }, h('div', { class: 's', style: { color: 'var(--text)' } }, sm.sets ? `${sm.sets} sets, ${fmtNum(sm.vol)} kg` : '', sm.sets && sm.cardioMin ? ' + ' : '', sm.cardioMin ? `${fmtMin(sm.cardioMin)} cardio` : ''), h('div', { class: 's ell' }, top.join(', '))),
        icon('right', 16)); })));

  if (view === 'overview') {
    // running pace, when runs have both time and distance
    const runs = [];
    for (const ss of an.sessions) { if (ss.date < weeks[0].week) continue; for (const it of ss.items || []) if (it.k === 'cardio' && it.d !== false && it.km > 0 && it.min > 0 && /run/.test(it.ex)) runs.push({ date: ss.date, pace: it.min / it.km, km: it.km }); }
    const paceFmt = v => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`;
    const pacePanel = runs.length >= 2 ? h('div', { class: 'panel' },
      h('h2', null, 'Running pace', h('span', { class: 'note', style: { fontWeight: 400 } }, 'minutes per km, lower is faster')),
      lineChart({ labels: runs.map(r => wkLabel(r.date)), min0: false, height: 150, unit: 'min/km', fmt: paceFmt, series: [{ name: 'Pace', color: c2, values: runs.map(r => r.pace) }] })) : null;
    root.appendChild(tiles);
    root.appendChild(h('div', { style: { height: '12px' } }));
    root.appendChild(h('div', { class: 'cols' }, h('div', null, volPanel, zonePanel, cardioPanel, pacePanel), h('div', null, loadPanel, heatPanel, h('div', { class: 'sec', style: { marginTop: 0 } }, 'Recent sessions'), histPanel)));
    return;
  }

  if (view === 'muscles') {
    // ---- load on each muscle and joint, day by day
    // a phone screen fits about six weeks of readable columns; wider screens get twelve
    const cap = window.innerWidth < 700 ? 42 : 84;
    const nDays = Math.min(range >= 999 ? cap : range * 7, cap);
    const from = addDays(today, -nDays + 1);
    const hist = loadHistory(an, from, today);
    const grid = h('div', { class: 'lheat' });
    const pickEl = h('div', { class: 'lpick' });
    const showPick = () => {
      if (!pick || pick.i >= hist.length) pick = { kind: 'm', id: 'quads', i: hist.length - 1 };
      const day = hist[pick.i]; const f = (pick.kind === 'm' ? day.fm : day.fj)[pick.id] || 0;
      pickEl.replaceChildren(h('i', { style: { background: loadColor(f) } }), h('span', null, h('b', null, (pick.kind === 'm' ? MUSCLE : JOINT)[pick.id].name), `, ${relDay(day.date, today)}: `, h('b', { class: 'num' }, Math.round(Math.min(f, 2) * 100) + '%'), ` (${statusOf(f).label.toLowerCase()})`));
      grid.querySelectorAll('i.sel').forEach(e => e.classList.remove('sel'));
      grid.querySelector(`[data-k="${pick.kind}:${pick.id}"] i:nth-child(${pick.i + 1})`)?.classList.add('sel');
    };
    const rowFor = (kind, id, name) => h('div', { class: 'lr' }, h('span', null, name),
      h('div', { class: 'lc', 'data-k': kind + ':' + id, style: { gridTemplateColumns: `repeat(${hist.length}, 1fr)` } }, hist.map(day => h('i', { style: { background: loadColor((kind === 'm' ? day.fm : day.fj)[id] || 0) } }))));
    grid.append(h('div', { class: 'lgroup', style: { marginTop: 0 } }, 'Muscles'), ...MUSCLES.map(m => rowFor('m', m.id, m.name)), h('div', { class: 'lgroup' }, 'Joints and tendons'), ...JOINTS.map(j => rowFor('j', j.id, j.name)));
    const ticks = hist.map((d, i) => ({ d, i })).filter(x => parseYmd(x.d.date).getDay() === 1).filter((_, k, arr) => arr.length <= 6 || k % Math.ceil(arr.length / 6) === 0);
    grid.append(h('div', { class: 'lax' }, h('span'), h('div', null, ticks.map(x => h('b', { style: { left: ((x.i + 0.5) / hist.length * 100) + '%' } }, wkLabel(x.d.date))))));
    const onPoint = e => {
      const lc = e.target.closest('.lc'); if (!lc) return;
      const r = lc.getBoundingClientRect(); const i = Math.max(0, Math.min(hist.length - 1, Math.floor((e.clientX - r.left) / r.width * hist.length)));
      const [kind, id] = lc.dataset.k.split(':'); pick = { kind, id, i }; showPick();
    };
    grid.addEventListener('pointerdown', onPoint); grid.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' || e.pressure > 0) onPoint(e); });
    const loadTime = h('div', { class: 'panel' },
      h('h2', null, 'Load over time', h('span', { class: 'note', style: { fontWeight: 400 } }, `each column is a day, last ${hist.length} days`)),
      grid, pickEl,
      h('div', { class: 'ramp', style: { justifyContent: 'flex-start' } }, 'Fresh', h('i'), 'Heavily loaded'),
      h('p', { class: 'note tiny', style: { marginTop: '6px' } }, 'Load at the end of each day. A column of colour is a training day; the fade to the right is recovery. Rows that never go grey are getting little rest; rows that stay grey are getting little work. Tap a cell for the number.'));
    requestAnimationFrame(showPick);

    // ---- average weekly sets against target, and how often
    const full = weekList(an, 5).slice(0, 4).filter(w => w.week >= (an.sessions[0] ? weekStart(an.sessions[0].date) : w.week));
    const nW = Math.max(1, full.length);
    const since = full[0]?.week || weekStart(today), until = addDays(weekStart(today), -1);
    const rows = MUSCLES.map(mu => {
      const avg = full.reduce((a, w) => a + (w.muscles[mu.id] || 0), 0) / nW;
      let daysHit = 0; for (const d of an.days.values()) if (d.date >= since && d.date <= until && (d.muscles[mu.id] || 0) >= 1) daysHit++;
      return { mu, avg, freq: daysHit / nW, t: muscleTarget(an.settings, mu.id) };
    }).filter(r => r.t.hi > 0);
    const setsPanel = h('div', { class: 'panel' },
      h('h2', null, 'Weekly sets against target', h('span', { class: 'note', style: { fontWeight: 400 } }, `average of the last ${nW} full ${nW === 1 ? 'week' : 'weeks'}`)),
      rows.map(r => { const max = Math.max(r.t.hi * 1.35, r.avg, 1);
        return h('div', { class: 'mrow', style: { gridTemplateColumns: '96px 1fr 104px' } }, h('span', { class: 'nm' }, r.mu.name),
          h('div', { class: 'tbar' }, h('div', { class: 'band', style: { left: (r.t.lo / max * 100) + '%', width: ((r.t.hi - r.t.lo) / max * 100) + '%' } }), h('div', { class: 'fill', style: { width: (r.avg / max * 100) + '%' } })),
          h('span', { class: 'st num', style: { fontSize: '14px', minWidth: 0, color: r.avg < r.t.lo ? 'var(--warn)' : r.avg > r.t.hi * 1.15 ? 'var(--c3)' : 'var(--dim)' } }, `${fmtNum(r.avg, 1)} sets, ${fmtNum(r.freq, 1)}×/wk`)); }),
      h('div', { class: 'legend', style: { marginTop: '10px' } }, h('span', null, h('i', { style: { background: 'var(--c1)' } }), 'Hard sets per week'), h('span', null, h('i', { style: { background: 'color-mix(in srgb, var(--good) 26%, transparent)', boxShadow: 'inset 0 0 0 1.5px var(--good)' } }), 'Target range')),
      h('p', { class: 'note tiny', style: { marginTop: '6px' } }, 'Amber numbers are under target, pink are well over. "×/wk" is how many days a week the muscle got at least one hard set.'));

    // ---- balance
    const sumOf = ids => full.reduce((a, w) => a + ids.reduce((b, id) => b + (w.muscles[id] || 0), 0), 0) / nW;
    const pairs = [
      ['Push', ['chest', 'front_delt', 'side_delt', 'triceps'], 'Pull', ['lats', 'upper_back', 'rear_delt', 'biceps']],
      ['Upper body', MUSCLES.filter(m => m.group === 'upper').map(m => m.id), 'Lower body', MUSCLES.filter(m => m.group === 'lower').map(m => m.id)],
      ['Chest and front delts', ['front_delt', 'chest'], 'Upper back and rear delts', ['rear_delt', 'upper_back']],
      ['Quads', ['quads'], 'Hamstrings and glutes', ['hamstrings', 'glutes']],
    ];
    const balPanel = h('div', { class: 'panel' },
      h('h2', null, 'Balance', h('span', { class: 'note', style: { fontWeight: 400 } }, 'hard sets per week, same weeks')),
      pairs.map(([an1, a, bn, b]) => { const x = sumOf(a), y = sumOf(b), tot = x + y || 1;
        return h('div', { class: 'bal' }, h('div', { class: 'bl' }, h('span', null, an1, h('b', null, fmtNum(x, 1))), h('span', null, h('b', null, fmtNum(y, 1)), bn)),
          h('div', { class: 'bb' }, h('i', { style: { width: (x / tot * 100) + '%', background: c1 } }), h('i', { style: { width: (y / tot * 100) + '%', background: c2 } }))); }),
      h('p', { class: 'note tiny' }, 'There is no single right ratio. Lopsided bars are worth a look when they are not on purpose: a lot more pushing than pulling, or chest and front delts far ahead of the upper back, is a common route to cranky shoulders. Running adds leg load that is not counted here.'));

    // ---- volume and weight-adjusted volume per muscle
    const withVol = MUSCLES.filter(m => weeks.some(w => (w.mvol[m.id] || 0) > 0));
    if (!selMuscle || !withVol.some(m => m.id === selMuscle)) selMuscle = withVol.slice().sort((a, b) => weeks.reduce((t, w) => t + (w.mvol[b.id] || 0), 0) - weeks.reduce((t, w) => t + (w.mvol[a.id] || 0), 0))[0]?.id || null;
    const mvPanel = selMuscle ? h('div', { class: 'panel' },
      h('h2', null, 'Volume per muscle'),
      h('select', { 'aria-label': 'Muscle', onChange: e => { selMuscle = e.target.value; ctx.refresh(); } }, withVol.map(m => h('option', { value: m.id, selected: m.id === selMuscle }, m.name))),
      h('div', { style: { height: '10px' } }),
      legend([{ name: 'Volume (kg × reps)', color: c1 }, { name: 'Weight-adjusted', color: c2 }]),
      lineChart({ labels, unit: 'kg', series: [{ name: 'Volume', color: c1, values: weeks.map(w => w.mvol[selMuscle] || 0) }, { name: 'Weight-adjusted', color: c2, values: weeks.map(w => w.mwav[selMuscle] || 0) }] }),
      h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Each set\'s volume is shared out by how much the exercise works the muscle: in full for the main muscle, about half for helpers. Amber above blue means that muscle worked heavier than its recent usual.')) : null;

    root.appendChild(h('div', { class: 'cols' }, h('div', null, loadTime, balPanel), h('div', null, setsPanel, mvPanel)));
    return;
  }

  // ---------------- strength
  const inRange = st => st.date >= weeks[0].week;
  // progress board: first two sessions in the period against the last two
  const board = [];
  for (const [id, hs] of an.exHist) {
    const ex = getEx(state, id); if (!ex || ex.kind === 'cardio') continue;
    const list = hs.filter(x => x.best > 0 && x.date >= weeks[0].week); if (list.length < 3) continue;
    const mean = arr => arr.reduce((a, x) => a + x.best, 0) / arr.length;
    const first = mean(list.slice(0, 2)), last = mean(list.slice(-2));
    const all = hs.filter(x => x.best > 0); const bestIdx = all.reduce((bi, x, i) => x.best >= all[bi].best ? i : bi, 0);
    board.push({ id, ex, now: last, change: (last - first) / first * 100, since: all.length - 1 - bestIdx, n: list.length });
  }
  board.sort((a, b) => b.change - a.change);
  const boardPanel = board.length ? h('div', { class: 'panel' },
    h('h2', null, 'Progress board', h('span', { class: 'note', style: { fontWeight: 400 } }, 'estimated best, start of period against now')),
    h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Exercise'), h('th', { class: 'n' }, 'Now'), h('th', { class: 'n' }, 'Change'))),
      h('tbody', null, board.map(b => h('tr', { style: { cursor: 'pointer' }, onClick: () => showExerciseHistory(b.id) },
        h('td', null, b.ex.name, b.since >= 6 ? h('span', { class: 'tag warn', style: { marginLeft: '8px' } }, `no best in ${b.since} sessions`) : b.since === 0 ? h('span', { class: 'tag good', style: { marginLeft: '8px' } }, 'best last time') : null),
        h('td', { class: 'n' }, fmtNum(shownLoad(b.ex, b.now), 1)), h('td', { class: 'n' }, (b.change >= 0 ? '▲ ' : '▼ ') + fmtNum(Math.abs(b.change), 1) + '%'))))),
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Average of the first two sessions in the period against the last two, so one odd day does not swing it. Tap a row for the full history. An exercise that has gone many sessions without a best may need a change: more rest, a different rep range, or a swap.')) : null;

  // rep ranges
  const buckets = [['1–5', 1, 5], ['6–8', 6, 8], ['9–12', 9, 12], ['13–15', 13, 15], ['16–20', 16, 20], ['21+', 21, 999]];
  const sets = an.allSets.filter(inRange);
  const repPanel = sets.length ? h('div', { class: 'panel' },
    h('h2', null, 'Rep ranges'),
    legend([{ name: 'Counted as hard', color: c1 }, { name: 'Easier sets and warm-ups', color: c2 }]),
    barChart({ height: 150, unit: 'sets', fmt: v => fmtNum(v, 1), bars: buckets.map(([label, lo, hi]) => { const inB = sets.filter(x => x.r >= lo && x.r <= hi); const hd = inB.reduce((a, x) => a + x.hard, 0);
      return { label, tip: `${label} reps`, segs: [{ name: 'Hard', color: c1, v: hd }, { name: 'Easier', color: c2, v: inB.length - hd }] }; }) }),
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Where your sets land. Anything from about 5 to 30 reps builds muscle if the set ends near your limit; low reps with heavy weight build maximal strength best.')) : null;

  // how much of the work counts
  const qualPanel = h('div', { class: 'panel' },
    h('h2', null, 'How much of your work counts'),
    lineChart({ labels, unit: '%', height: 150, fmt: v => fmtNum(v), series: [{ name: 'Sets that count as hard', color: c1, values: weeks.map(w => w.sets ? w.hard / w.sets * 100 : null) }] }),
    h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Share of logged sets that end close enough to your limit to count. Warm-ups pull it down, which is fine. A falling line with the same routine can mean you are coasting.'));

  root.appendChild(h('div', { class: 'cols' }, h('div', null, exPanel, boardPanel), h('div', null, repPanel, qualPanel, prPanel)));
}

export function showExerciseHistory(exId) {
  const an = analyze(state);
  const ex = getEx(state, exId);
  const hs = an.exHist.get(exId) || [];
  const sg = suggest(state, an, exId);
  const c1 = cssVar('--c1'), c2 = cssVar('--c2');
  const best = hs.length ? hs.reduce((a, b) => b.best > a.best ? b : a) : null;
  sheet({
    title: ex?.name || 'Exercise', wide: true,
    body: !hs.length ? h('div', { class: 'empty' }, h('b', null, 'No history yet'), 'Log this exercise once and its progress shows up here.') : [
      h('div', { class: 'tiles' },
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, fmtNum(shownLoad(ex, hs[hs.length - 1].best), 1), h('small', null, 'kg')), h('div', { class: 'k' }, 'Estimated one-rep best' + (ex?.perSide && !ex.bw ? ', per hand' : ex?.bw ? ', with bodyweight' : ''))),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, `${fmtW(best.top.w)}×${best.top.r}`), h('div', { class: 'k' }, 'Best set, ' + fmtDate(best.date))),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, hs.length), h('div', { class: 'k' }, 'Sessions logged'))),
      sg ? h('div', { class: 'banner info', style: { marginTop: '12px' } }, icon('bolt'), h('div', null, h('b', null, `Next time: ${fmtW(sg.target.w)} kg × ${sg.target.r}. `), sg.target.why)) : null,
      hs.length > 1 ? [legend([{ name: 'Estimated one-rep best', color: c1 }, { name: 'Heaviest set', color: c2 }]),
        lineChart({ labels: hs.slice(-40).map(x => wkLabel(x.date)), min0: false, unit: 'kg', fmt: v => fmtNum(v, 1), series: [{ name: 'Est. best', color: c1, values: hs.slice(-40).map(x => x.best ? shownLoad(ex, x.best) : null) }, { name: 'Heaviest set', color: c2, values: hs.slice(-40).map(x => x.top ? shownLoad(ex, x.top.load) : null) }] })] : null,
      h('div', { class: 'sec' }, 'Sessions'),
      h('table', { class: 't' }, h('thead', null, h('tr', null, h('th', null, 'Date'), h('th', null, 'Sets (kg × reps)'), h('th', { class: 'n' }, 'Volume'), h('th', { class: 'n' }, 'Adjusted'))),
        h('tbody', null, hs.slice(-12).reverse().map(x => h('tr', null, h('td', { class: 'dim', style: { whiteSpace: 'nowrap' } }, fmtDate(x.date), x.pr ? h('span', { class: 'tag good', style: { marginLeft: '6px' } }, 'best') : null),
          h('td', { class: 'num', style: { fontSize: '15px' } }, x.sets.map(s => h('span', { style: { marginRight: '10px', opacity: s.hard < 0.5 ? 0.5 : 1, whiteSpace: 'nowrap' } }, `${fmtW(s.w)}×${s.r}`))),
          h('td', { class: 'n' }, fmtNum(x.vol)), h('td', { class: 'n' }, fmtNum(x.wav)))))),
      h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'Faded sets were far from failure (warm-ups) and do not count as hard sets.'),
    ],
  });
}
