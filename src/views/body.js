// Body: where the load sits right now, how it fades with rest, and how sore joints are doing.

import { h, icon, sheet, toast, seg, field, toggle } from '../ui.js';
import { state, put, del } from '../store.js';
import { analyze, loadAt, statusOf, hoursToReady, currentPain, muscleTarget, halfLife, getEx, myExercises } from '../model.js';
import { futureEvents, weekProjection } from '../planner.js';
import { MUSCLES, MUSCLE, JOINTS, JOINT } from '../library.js';
import { bodyMap, loadColor } from '../bodymap.js';
import { ymd, addDays, weekStart, fmtDate, fmtNum, uid, relDay } from '../util.js';

let ahead = 0;          // hours ahead to show
let withPlan = true;

function readyText(settings, id, load, cap) {
  const hrs = hoursToReady(settings, id, load, cap);
  if (hrs <= 0) return 'Ready';
  if (hrs < 1) return 'Ready within the hour';
  if (hrs < 36) return `Ready in ${Math.round(hrs)} h`;
  return `Ready in ${Math.round(hrs / 24 * 10) / 10} days`;
}

export function renderBody(root, ctx) {
  const an = analyze(state);
  const settings = an.settings;
  const today = ymd();
  const now = Date.now();
  const t = now + ahead * 3600000;
  const planned = withPlan && ahead > 0 ? futureEvents(state, today, addDays(today, 4)).filter(e => e.t > now - 6 * 3600000 && !(an.days.has(today) && e.t < now + 12 * 3600000 && ymd(new Date(e.t)) === today)) : [];
  const l = loadAt(an, t, planned);
  const cap = settings.capacity;
  const pain = currentPain(state);
  const painLv = Object.fromEntries(Object.entries(pain).map(([k, p]) => [k, p.level]));
  const frac = l.fm, jfrac = l.fj;
  ctx.setTitle('Body', ahead ? `Expected load in ${ahead} hours` : 'Load on muscles and joints right now');

  const map = h('div', { class: 'panel' },
    seg([{ id: 0, name: 'Now' }, { id: 24, name: '+24 h' }, { id: 48, name: '+48 h' }, { id: 72, name: '+72 h' }], ahead, v => { ahead = v; ctx.refresh(); }),
    h('div', { style: { height: '10px' } }),
    bodyMap({ muscles: frac, joints: jfrac, pain: painLv, onPick: (kind, id) => kind === 'muscle' ? muscleSheet(id, ctx) : jointSheet(id, ctx) }),
    h('div', { class: 'ramp' }, 'Fresh', h('i'), 'Heavily loaded'),
    h('p', { class: 'note tiny', style: { textAlign: 'center', marginTop: '4px' } }, 'Dots are joints and tendons. A pink dot with a number is pain you logged.'),
    ahead ? h('div', { class: 'row', style: { marginTop: '10px' } }, h('span', { class: 'grow', style: { fontSize: '14px' } }, 'Include planned sessions'), toggle(withPlan, v => { withPlan = v; ctx.refresh(); }, 'Include planned sessions')) : null);

  const painBanner = Object.keys(pain).length ? h('div', { class: 'banner pain' }, icon('heart'), h('div', { class: 'grow' },
    Object.entries(pain).map(([r, p]) => h('div', null, h('b', null, `${JOINT[r]?.name || r} ${p.level}/10`), `  logged ${relDay(ymd(new Date(p.t)), today).toLowerCase()}. `, adviceFor(p.level, settings))),
    h('div', { class: 'note tiny', style: { marginTop: '4px' } }, 'Re-rate it tomorrow morning: the planner follows your latest rating.'))) : null;

  const wk = weekStart(today);
  const proj = weekProjection(state, an, wk, today);
  const mlist = MUSCLES.map(m => ({ m, f: frac[m.id], load: l.muscles[m.id] })).sort((a, b) => b.f - a.f);
  const muscles = h('div', { class: 'panel' },
    h('h2', null, 'Muscles', h('span', { class: 'note', style: { fontWeight: 400 } }, 'tap one for detail')),
    mlist.map(({ m, f, load }) => h('button', { class: 'mrow', onClick: () => muscleSheet(m.id, ctx) },
      h('span', { class: 'nm' }, m.name),
      h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, f * 100) + '%', background: loadColor(f) } })),
      h('span', { class: 'st' }, f < 0.03 ? 'Fresh' : readyText(settings, m.id, load, l.capM[m.id])))));
  const joints = h('div', { class: 'panel' },
    h('h2', null, 'Joints and tendons'),
    JOINTS.map(j => h('button', { class: 'mrow', onClick: () => jointSheet(j.id, ctx) },
      h('span', { class: 'nm' }, j.name),
      h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, jfrac[j.id] * 100) + '%', background: loadColor(jfrac[j.id]) } })),
      pain[j.id] ? h('span', { class: 'tag pain' }, `pain ${pain[j.id].level}/10`) : h('span', { class: 'st' }, statusOf(jfrac[j.id]).label))),
    h('button', { class: 'btn block', style: { marginTop: '12px' }, onClick: () => painSheet(null, ctx) }, icon('heart'), 'Log pain or discomfort'));

  root.appendChild(h('div', { class: 'cols' }, h('div', null, map, painBanner), h('div', null, muscles, joints)));
  if (!an.events.length) root.appendChild(h('p', { class: 'note', style: { textAlign: 'center' } }, 'Everything is grey because nothing is logged yet. Colour appears after your first workout and fades as you rest.'));
}

function adviceFor(level, settings) {
  if (level >= 7) return 'Stop loading it and get it looked at if it does not settle.';
  if (level >= settings.painAvoid) return 'Exercises that load it are kept out of your plan for now.';
  if (level >= settings.painCaution) return 'The planner goes easy on it. Fine to train if it is back to normal by morning.';
  return 'Mild. Keep an eye on it.';
}

function muscleSheet(id, ctx) {
  const an = analyze(state); const s = an.settings; const m = MUSCLE[id];
  const now = Date.now(); const today = ymd();
  const L = loadAt(an, now); const load = L.muscles[id]; const f = L.fm[id]; const capNow = L.capM[id];
  const tg = muscleTarget(s, id);
  const proj = weekProjection(state, an, weekStart(today), today)[id];
  // what loaded it in the last 10 days
  const contrib = new Map();
  for (const st of an.allSets) {
    if (st.date < addDays(today, -10)) continue;
    const ex = getEx(state, st.ex); const c = ex?.muscles?.[id]; if (!c) continue;
    const k = st.date + '|' + st.ex; const o = contrib.get(k) || { date: st.date, ex: ex.name, sets: 0 }; o.sets += st.hard * c; contrib.set(k, o);
  }
  const rows = [...contrib.values()].filter(r => r.sets >= 0.25).sort((a, b) => a.date < b.date ? 1 : -1).slice(0, 8);
  const weeks = [...an.weeks.values()].sort((a, b) => a.week < b.week ? 1 : -1).slice(0, 8).reverse();
  const max = Math.max(tg.hi * 1.2, ...weeks.map(w => w.muscles[id] || 0), 1);
  sheet({
    title: m.name,
    body: [
      h('div', { class: 'tiles' },
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v', style: { color: loadColor(f) } }, Math.round(Math.min(f, 2) * 100), h('small', null, '%')), h('div', { class: 'k' }, statusOf(f).label)),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, (() => { const hrs = hoursToReady(s, id, load, capNow); return hrs <= 0 ? 'Now' : hrs < 36 ? Math.round(hrs) : fmtNum(hrs / 24, 1); })(), h('small', null, (() => { const hrs = hoursToReady(s, id, load, capNow); return hrs <= 0 ? '' : hrs < 36 ? 'h' : 'days'; })())), h('div', { class: 'k' }, 'Ready for hard work')),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, fmtNum(proj.done, 1), h('small', null, `/ ${tg.lo}–${tg.hi}`)), h('div', { class: 'k' }, 'Hard sets this week'))),
      h('p', { class: 'note', style: { margin: '12px 0' } }, `Load on this muscle halves about every ${halfLife(s, id)} hours of rest. ${proj.planned > 0 ? `Another ${fmtNum(proj.planned, 1)} sets are planned this week.` : ''}`),
      weeks.length > 1 ? [h('div', { class: 'sec', style: { marginTop: '8px' } }, 'Hard sets per week'),
        h('div', { class: 'row', style: { alignItems: 'flex-end', height: '84px', gap: '6px', position: 'relative' } },
          h('div', { style: { position: 'absolute', left: 0, right: 0, bottom: (tg.lo / max * 100) + '%', height: ((tg.hi - tg.lo) / max * 100) + '%', background: 'color-mix(in srgb, var(--good) 16%, transparent)', borderTop: '1px solid var(--good)', borderBottom: '1px solid var(--good)' } }),
          weeks.map(w => h('div', { class: 'grow', title: `${fmtDate(w.week)}: ${fmtNum(w.muscles[id] || 0, 1)} sets`, style: { height: Math.max(2, (w.muscles[id] || 0) / max * 100) + '%', background: 'var(--c1)', borderRadius: '3px 3px 0 0', position: 'relative' } }))),
        h('div', { class: 'row note tiny', style: { justifyContent: 'space-between', marginTop: '4px' } }, h('span', null, fmtDate(weeks[0].week)), h('span', null, 'green band = target'), h('span', null, 'this week'))] : null,
      h('div', { class: 'sec' }, 'What loaded it lately'),
      rows.length ? h('table', { class: 't' }, h('tbody', null, rows.map(r => h('tr', null, h('td', { class: 'dim', style: { whiteSpace: 'nowrap' } }, relDay(r.date, today)), h('td', null, r.ex), h('td', { class: 'n' }, fmtNum(r.sets, 1) + ' sets')))))
        : h('p', { class: 'note' }, 'Nothing in the last 10 days.'),
    ],
  });
}

function jointSheet(id, ctx) {
  const an = analyze(state); const s = an.settings; const j = JOINT[id];
  const f = loadAt(an, Date.now()).fj[id];
  const hist = Object.values(state.pain).filter(p => !p.deleted && p.region === id).sort((a, b) => b.t - a.t).slice(0, 8);
  const stress = myExercises(state).filter(e => (e.joints?.[id] || 0) >= 0.5).map(e => e.name);
  const sh = sheet({
    title: j.name,
    body: [
      h('div', { class: 'tiles' },
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v', style: { color: loadColor(f) } }, Math.round(Math.min(f, 2) * 100), h('small', null, '%')), h('div', { class: 'k' }, statusOf(f).label)),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v' }, halfLife(s, id), h('small', null, 'h')), h('div', { class: 'k' }, 'Load halves every')),
        h('div', { class: 'tile', style: { background: 'var(--raised)' } }, h('div', { class: 'v', style: hist[0]?.level ? { color: 'var(--pain)' } : null }, hist[0] && Date.now() - hist[0].t < 14 * 86400000 ? hist[0].level : 0, h('small', null, '/ 10')), h('div', { class: 'k' }, 'Latest pain'))),
      h('p', { class: 'note', style: { margin: '12px 0' } }, 'Tendons and joints recover more slowly than muscle, and tolerate sudden jumps in load badly. ', stress.length ? `From your list, these load it most: ${stress.slice(0, 6).join(', ')}.` : ''),
      h('button', { class: 'btn primary block', onClick: () => { sh.close(); painSheet(id, ctx); } }, icon('heart'), 'Rate pain here'),
      hist.length ? [h('div', { class: 'sec' }, 'Pain log'), h('table', { class: 't' }, h('tbody', null, hist.map(p => h('tr', null,
        h('td', { class: 'dim', style: { whiteSpace: 'nowrap' } }, fmtDate(ymd(new Date(p.t)))), h('td', { class: 'n', style: { textAlign: 'left', color: p.level ? 'var(--pain)' : 'var(--good)' } }, p.level + '/10'), h('td', null, [p.side && p.side !== 'both' ? p.side : '', p.note].filter(Boolean).join(', ')),
        h('td', { style: { width: '40px', padding: 0 } }, h('button', { class: 'iconbtn', 'aria-label': 'Delete entry', onClick: () => { del('pain', p.id, 'pain'); sh.close(); jointSheet(id, ctx); ctx.refresh(); } }, icon('x', 18)))))))] : null,
    ],
  });
}

export function painSheet(region, ctx) {
  const cur = currentPain(state);
  const r0 = region || Object.keys(cur)[0] || 'achilles';
  const d = { region: r0, level: cur[r0] ? cur[r0].level : 3, side: cur[r0]?.side || 'both', note: '' };
  const words = n => n === 0 ? 'No pain. Clears the warning.' : n <= 2 ? 'Aware of it, nothing more.' : n <= 4 ? 'Uncomfortable, but movement is normal.' : n <= 6 ? 'Painful. It changes how you move.' : 'Strong pain. Stop loading it.';
  sheet({
    title: 'Pain or discomfort',
    body: api => [
      h('label', { class: 'f' }, 'Where'),
      h('div', { class: 'chips' }, JOINTS.map(j => h('button', { class: 'chip' + (d.region === j.id ? ' on' : ''), onClick: () => { d.region = j.id; if (cur[j.id]) d.level = cur[j.id].level; api.render(); } }, j.name))),
      h('div', { style: { marginTop: '16px' } }, h('label', { class: 'f' }, 'How much, 0 to 10'),
        h('div', { class: 'row' }, h('span', { class: 'num', style: { fontSize: '40px', fontWeight: 700, width: '52px', color: d.level >= 5 ? 'var(--pain)' : d.level >= 3 ? 'var(--warn)' : 'var(--text)' } }, d.level),
          h('input', { type: 'range', min: 0, max: 10, step: 1, value: d.level, style: { flex: 1, minHeight: '44px', padding: 0, accentColor: 'var(--pain)' }, 'aria-label': 'Pain level', onInput: e => { d.level = +e.target.value; api.render(); } })),
        h('p', { class: 'note' }, words(d.level))),
      h('div', { style: { marginTop: '12px' } }, field('Side', seg([{ id: 'left', name: 'Left' }, { id: 'both', name: 'Both / centre' }, { id: 'right', name: 'Right' }], d.side, v => { d.side = v; }))),
      h('div', { style: { marginTop: '12px' } }, field('Note', h('input', { type: 'text', placeholder: 'e.g. after the treadmill run', value: d.note, onInput: e => { d.note = e.target.value; } }))),
      h('div', { class: 'banner info', style: { marginTop: '14px', fontSize: '13.5px' } }, icon('info'), h('div', null,
        'Rule of thumb from tendon rehab research: discomfort up to about 5/10 during activity is acceptable if it has settled by the next morning and is not creeping up week to week. Sharp, one-sided or on-the-bone pain, swelling, or a pop: stop and get it checked. This app is not medical advice.')),
    ],
    footer: api => [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      put('pain', { id: uid('n'), t: Date.now(), region: d.region, level: d.level, side: d.side, note: d.note.trim() }, 'pain');
      api.close();
      toast(d.level ? `${JOINT[d.region].name} ${d.level}/10 saved. Plans will take it into account.` : 'Marked as pain-free');
      ctx.refresh(); ctx.replanSoon && ctx.replanSoon();
    } }, 'Save rating')],
  });
}
