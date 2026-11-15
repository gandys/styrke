// Insights: trends in volume, weight-adjusted volume, stimulus mix, load, and per-exercise progress.

import { h, icon, sheet, seg } from '../ui.js';
import { state } from '../store.js';
import { analyze, loadSeries, getEx, suggest, sessionSummary, shownLoad } from '../model.js';
import { MUSCLE } from '../library.js';
import { lineChart, barChart, legend, cssVar } from '../charts.js';
import { loadColor } from '../bodymap.js';
import { ymd, addDays, weekStart, fmtDate, fmtNum, fmtW, parseYmd, MONTHS_SHORT, relDay, fmtMin } from '../util.js';
import { exName } from './common.js';

let range = 12;       // weeks
let selEx = null;

const wkLabel = w => { const d = parseYmd(w); return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; };

function weekList(an, n) {
  const today = ymd(); const cur = weekStart(today);
  let first = addDays(cur, -(n - 1) * 7);
  if (n >= 999) first = an.sessions.length ? weekStart(an.sessions[0].date) : cur;
  const out = [];
  for (let w = first; w <= cur; w = addDays(w, 7)) out.push(an.weeks.get(w) || { week: w, vol: 0, wav: 0, sets: 0, hard: 0, load: 0, zones: { strength: 0, hyper: 0, endur: 0 }, muscles: {}, cardioMin: 0, km: 0, runKm: 0, days: 0 });
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

  root.appendChild(tiles);
  root.appendChild(h('div', { style: { height: '12px' } }));
  root.appendChild(h('div', { class: 'cols' }, h('div', null, volPanel, zonePanel, cardioPanel), h('div', null, loadPanel, exPanel, heatPanel)));
  root.appendChild(h('div', { class: 'cols' }, h('div', null, prPanel), h('div', null, h('div', { class: 'sec', style: { marginTop: 0 } }, 'Recent sessions'), histPanel)));
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
