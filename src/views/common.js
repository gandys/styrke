// Shared sheets: exercise picker and editor, block and preset editors.

import { h, sheet, icon, iconBtn, field, toggle, seg, toast, confirmSheet, numInput } from '../ui.js';
import { state, put, del, commit, touch } from '../store.js';
import { MUSCLES, MUSCLE, JOINTS, EQUIP, LIB, primaryMuscle } from '../library.js';
import { getEx, allExercises, analyze } from '../model.js';
import { itemMinutes, planMinutes, presetItems } from '../planner.js';
import { norm, uid, fmtDate, ymd } from '../util.js';

export function exName(id) { return getEx(state, id)?.name || 'Unknown exercise'; }

export function muscleSummary(ex) {
  if (!ex) return '';
  const ms = Object.entries(ex.muscles || {}).filter(([m]) => MUSCLE[m]).sort((a, b) => b[1] - a[1]);
  if (!ms.length) return ex.kind === 'cardio' ? 'Cardio' : 'No muscles set';
  const main = ms.filter(([, v]) => v >= 0.75).map(([m]) => MUSCLE[m].name);
  const also = ms.filter(([, v]) => v < 0.75 && v >= 0.3).map(([m]) => MUSCLE[m].name.toLowerCase());
  return (main.length ? main.join(', ') : MUSCLE[ms[0][0]].name) + (also.length ? ' + ' + also.slice(0, 3).join(', ') : '');
}

export function itemLabel(it) {
  if (it.k === 'block') { const b = state.blocks[it.block]; return { name: it.name || b?.name || 'Block', q: `${it.rounds || b?.rounds || 3} rounds`, sub: (it.exIds || b?.exIds || []).map(exName).join(', ') }; }
  if (it.k === 'cardio') return { name: it.name || exName(it.ex), q: it.min ? `${it.min} min` : it.km ? `${it.km} km` : '', sub: [it.name ? exName(it.ex) : '', it.km && it.min ? `${it.km} km` : '', it.note].filter(Boolean).join(', ') };
  const ex = getEx(state, it.ex);
  return { name: ex?.name || 'Unknown', q: `${it.sets || 3} × ${it.repLo && it.repHi ? (it.repLo === it.repHi ? it.repLo : it.repLo + '–' + it.repHi) : (ex ? ex.repLo + '–' + ex.repHi : '')}`, sub: muscleSummary(ex) };
}

// ---------- exercise picker
export function pickExercise({ kind = null, title = 'Add exercise', onPick, exclude = [] }) {
  let q = '', scope = 'mine';
  const an = analyze(state);
  const lastUsed = id => { const hs = an.exHist.get(id); return hs?.length ? hs[hs.length - 1].date : ''; };
  const s = sheet({
    title,
    body: api => {
      let list = allExercises(state).filter(e => (!kind || e.kind === kind) && !exclude.includes(e.id));
      const nq = norm(q);
      if (nq) list = list.filter(e => norm(e.name).includes(nq) || (e.alias || []).some(a => norm(a).includes(nq)) || Object.keys(e.muscles || {}).some(m => norm(MUSCLE[m]?.name).includes(nq)));
      else if (scope === 'mine') list = list.filter(e => e.mine);
      list.sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (lastUsed(b.id) > lastUsed(a.id) ? 1 : lastUsed(b.id) < lastUsed(a.id) ? -1 : a.name.localeCompare(b.name)));
      const search = h('input', { type: 'search', placeholder: 'Search by name or muscle', value: q, onInput: e => { q = e.target.value; const pos = e.target.selectionStart; api.render(); const el = api.body.querySelector('input[type=search]'); el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* ignore */ } } });
      return [
        h('div', { class: 'stack' }, search,
          nq ? null : seg([{ id: 'mine', name: 'My exercises' }, { id: 'all', name: 'Whole library' }], scope, v => { scope = v; api.render(); })),
        h('div', { class: 'list', style: { marginTop: '8px' } },
          list.length ? list.map(e => h('div', null,
            h('button', { class: 'grow', style: { textAlign: 'left', minHeight: '44px' }, onClick: () => { if (!e.mine) markMine(e.id, true); api.close(); onPick(e); } },
              h('div', { class: 't' }, e.name, e.needsSetup ? h('span', { class: 'tag warn', style: { marginLeft: '8px' } }, 'set muscles') : null),
              h('div', { class: 's ell' }, muscleSummary(e))),
            h('button', { class: 'iconbtn', 'aria-label': e.mine ? 'Remove from my exercises' : 'Add to my exercises', style: { color: e.mine ? 'var(--accent)' : 'var(--faint)' }, onClick: () => { markMine(e.id, !e.mine); api.render(); } }, starIcon(e.mine)),
            iconBtn('edit', 'Edit exercise', () => editExercise(e.id, {}, () => api.render()))))
            : h('div', { class: 'empty' }, h('b', null, scope === 'mine' && !nq ? 'No exercises in your list yet' : 'Nothing matches'), scope === 'mine' && !nq ? 'Open the whole library and tap the star on the ones you do.' : 'Create it as a new exercise.')),
        h('button', { class: 'btn block', style: { marginTop: '12px' }, onClick: () => editExercise(null, { kind: kind || 'strength', name: q }, ex => { api.close(); onPick(ex); }) }, icon('plus'), 'Create new exercise'),
      ];
    },
  });
  return s;
}
function starIcon(on) { const i = icon('star'); if (on) i.style.fill = 'currentColor'; return i; }

export function markMine(id, mine) {
  const u = state.ex[id] || { id };
  u.mine = mine; put('ex', u, 'library');
}

// ---------- exercise editor
export function editExercise(id, defaults = {}, onSaved) {
  const base = id ? getEx(state, id) : null;
  const isNew = !id;
  const d = base ? JSON.parse(JSON.stringify(base)) : { id: 'c_' + uid(), name: defaults.name || '', kind: defaults.kind || 'strength', equip: 'machine', mech: 'compound', muscles: {}, joints: {}, perSide: false, bw: 0, cost: 1.1, repLo: 8, repHi: 12, rest: 120, rate: 0.7, custom: true, mine: true };
  if (d.plan === undefined) d.plan = true;
  const cyc = [0, 0.5, 1];
  const lvl = v => v >= 0.75 ? 1 : v >= 0.25 ? 0.5 : 0;
  const s = sheet({
    title: isNew ? 'New exercise' : 'Edit exercise',
    body: api => [
      h('div', { class: 'stack' },
        field('Name', h('input', { type: 'text', value: d.name, placeholder: 'e.g. Machine Chest Press', onInput: e => { d.name = e.target.value; } })),
        d.custom ? field('Type', seg([{ id: 'strength', name: 'Strength' }, { id: 'cardio', name: 'Cardio / activity' }], d.kind, v => { d.kind = v; api.render(); })) : null,
        d.kind === 'strength' ? [
          h('div', { class: 'row' },
            h('div', { class: 'grow' }, field('Equipment', h('select', { onChange: e => { d.equip = e.target.value; } }, Object.entries(EQUIP).map(([k, v]) => h('option', { value: k, selected: d.equip === k }, v))))),
            h('div', { class: 'grow' }, field('Movement', seg([{ id: 'compound', name: 'Compound' }, { id: 'isolation', name: 'Isolation' }], d.mech, v => { d.mech = v; d.cost = v === 'compound' ? 1.1 : 1; })))),
          h('div', { class: 'row' },
            h('div', { class: 'grow' }, field('Rep range', h('div', { class: 'row' }, numInput(d.repLo, v => { d.repLo = v || 1; }, { int: true }), h('span', { class: 'dim' }, 'to'), numInput(d.repHi, v => { d.repHi = v || d.repLo; }, { int: true })))),
            h('div', { class: 'grow' }, field('Rest (seconds)', numInput(d.rest, v => { d.rest = v || 60; }, { int: true })))),
          h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Weight is per hand'), h('div', { class: 'note tiny' }, 'Two dumbbells: you log one, volume counts both.')), toggle(d.perSide, v => { d.perSide = v; }, 'Weight is per hand')),
          field('Share of bodyweight lifted (%)', numInput(Math.round((d.bw || 0) * 100), v => { d.bw = Math.max(0, Math.min(100, v || 0)) / 100; }, { int: true }), 'Pull-ups 100, push-ups about 64, machines and free weights 0.'),
        ] : field('Load per 10 minutes at moderate effort', numInput(d.rate, v => { d.rate = v || 0.7; }), 'Running is about 1.25, cycling 0.8, walking 0.3.'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'In my exercises')), toggle(d.mine, v => { d.mine = v; }, 'In my exercises')),
        d.kind === 'strength' ? h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Let the planner use it')), toggle(d.plan !== false, v => { d.plan = v; }, 'Let the planner use it')) : null,
      ),
      h('div', { class: 'sec' }, 'Muscles worked', h('span', { class: 'note tiny' }, 'main counts as a full set, helper as half')),
      h('div', null, MUSCLES.map(m => h('div', { class: 'musc' }, h('span', null, m.name),
        seg([{ id: 0, name: 'No' }, { id: 0.5, name: 'Helper' }, { id: 1, name: 'Main' }], lvl(d.muscles[m.id] || 0), v => { if (v) d.muscles[m.id] = v; else delete d.muscles[m.id]; })))),
      h('div', { class: 'sec' }, 'Joints and tendons stressed'),
      h('div', null, JOINTS.map(j => h('div', { class: 'musc' }, h('span', null, j.name),
        seg([{ id: 0, name: 'No' }, { id: 0.5, name: 'Some' }, { id: 1, name: 'A lot' }], lvl(d.joints[j.id] || 0), v => { if (v) d.joints[j.id] = v; else delete d.joints[j.id]; })))),
      !isNew ? h('button', { class: 'btn block danger', style: { marginTop: '16px' }, onClick: async () => {
        if (d.custom) { if (await confirmSheet('Delete exercise?', 'Sets you already logged stay in your history.', 'Delete', true)) { del('ex', d.id, 'library'); api.close(); onSaved && onSaved(null); } }
        else if (await confirmSheet('Reset to default?', 'Your edits to this built-in exercise are discarded.', 'Reset')) { put('ex', { id: d.id, mine: d.mine }, 'library'); api.close(); onSaved && onSaved(getEx(state, d.id)); }
      } }, d.custom ? 'Delete exercise' : 'Reset to default') : null,
    ],
    footer: api => [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      if (!d.name.trim()) { toast('Give the exercise a name.'); return; }
      d.name = d.name.trim(); delete d.needsSetup;
      const rec = d.custom ? d : diffFromBase(d);
      put('ex', rec, 'library'); api.close(); toast('Saved'); onSaved && onSaved(getEx(state, d.id));
    } }, 'Save')],
  });
  return s;
}
/** For built-in exercises store only what the user changed. */
function diffFromBase(d) {
  const base = LIB[d.id]; const out = { id: d.id };
  for (const k of ['name', 'equip', 'mech', 'perSide', 'bw', 'cost', 'repLo', 'repHi', 'rest', 'rate']) if (JSON.stringify(d[k]) !== JSON.stringify(base[k])) out[k] = d[k];
  if (JSON.stringify(d.muscles) !== JSON.stringify(base.muscles)) out.muscles = d.muscles;
  if (JSON.stringify(d.joints) !== JSON.stringify(base.joints)) out.joints = d.joints;
  out.mine = !!d.mine; if (d.plan === false) out.plan = false;
  if (d.importNames) out.importNames = d.importNames;
  return out;
}

// ---------- blocks
export function blockMinutes(b) { return Math.round(itemMinutes(state, { k: 'block', exIds: b.exIds, rounds: b.rounds, rest: b.rest, restRound: b.restRound })); }

export function editBlock(id, onSaved) {
  const isNew = !id;
  const d = id ? JSON.parse(JSON.stringify(state.blocks[id])) : { id: uid('b'), name: '', exIds: [], rounds: 3, rest: 30, restRound: 60, sameWeight: false, plan: true };
  sheet({
    title: isNew ? 'New block' : 'Edit block',
    body: api => [
      h('p', { class: 'note', style: { marginBottom: '12px' } }, 'A block is a set of exercises done back to back, then repeated: supersets, circuits, giant sets.'),
      h('div', { class: 'stack' },
        field('Name', h('input', { type: 'text', value: d.name, placeholder: 'e.g. Dumbbell circuit', onInput: e => { d.name = e.target.value; } })),
        h('div', null, h('label', { class: 'f' }, 'Exercises, in order'),
          h('div', { class: 'list' }, d.exIds.map((exId, i) => h('div', null,
            h('span', { class: 'num dim', style: { width: '18px' } }, i + 1), h('span', { class: 'grow t' }, exName(exId)),
            i > 0 ? iconBtn('up', 'Move up', () => { d.exIds.splice(i - 1, 0, d.exIds.splice(i, 1)[0]); api.render(); }) : null,
            iconBtn('x', 'Remove', () => { d.exIds.splice(i, 1); api.render(); })))),
          h('button', { class: 'btn block small', style: { marginTop: '8px' }, onClick: () => pickExercise({ kind: 'strength', exclude: d.exIds, onPick: ex => { d.exIds.push(ex.id); api.render(); } }) }, icon('plus'), 'Add exercise')),
        h('div', { class: 'row' },
          h('div', { class: 'grow' }, field('Rounds', numInput(d.rounds, v => { d.rounds = Math.max(1, v || 1); }, { int: true }))),
          h('div', { class: 'grow' }, field('Rest between (s)', numInput(d.rest, v => { d.rest = v || 0; }, { int: true }))),
          h('div', { class: 'grow' }, field('Rest after round (s)', numInput(d.restRound, v => { d.restRound = v || 0; }, { int: true })))),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Same weight for every exercise'), h('div', { class: 'note tiny' }, 'Type the weight once per round.')), toggle(d.sameWeight, v => { d.sameWeight = v; }, 'Same weight')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Let the planner use it'), h('div', { class: 'note tiny' }, 'Only on days where every exercise in the block fits.')), toggle(d.plan !== false, v => { d.plan = v; }, 'Planner')),
      ),
      !isNew ? h('button', { class: 'btn block danger', style: { marginTop: '16px' }, onClick: async () => { if (await confirmSheet('Delete block?', 'Logged sessions keep their sets.', 'Delete', true)) { del('blocks', d.id, 'library'); api.close(); onSaved && onSaved(null); } } }, 'Delete block') : null,
    ],
    footer: api => [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      if (!d.name.trim()) return toast('Give the block a name.');
      if (d.exIds.length < 2) return toast('A block needs at least two exercises.');
      put('blocks', d, 'library'); api.close(); toast('Saved'); onSaved && onSaved(d);
    } }, 'Save')],
  });
}

export function pickBlock(onPick) {
  sheet({
    title: 'Add block',
    body: api => {
      const blocks = Object.values(state.blocks).filter(b => !b.deleted);
      return [
        h('div', { class: 'list' }, blocks.length ? blocks.map(b => h('div', null,
          h('button', { class: 'grow', style: { textAlign: 'left' }, onClick: () => { api.close(); onPick(b); } },
            h('div', { class: 't' }, b.name), h('div', { class: 's' }, `${b.exIds.map(exName).join(', ')}. ${b.rounds} rounds, about ${blockMinutes(b)} min`)),
          iconBtn('edit', 'Edit block', () => editBlock(b.id, () => api.render()))))
          : h('div', { class: 'empty' }, h('b', null, 'No blocks yet'), 'Group exercises you do back to back.')),
        h('button', { class: 'btn block', style: { marginTop: '12px' }, onClick: () => editBlock(null, b => { if (b) { api.close(); onPick(b); } }) }, icon('plus'), 'Create new block'),
      ];
    },
  });
}

// ---------- presets (whole workouts)
export function editPreset(id, onSaved) {
  const isNew = !id;
  const d = id ? JSON.parse(JSON.stringify(state.presets[id])) : { id: uid('p'), name: '', items: [], plan: true };
  sheet({
    title: isNew ? 'New workout preset' : 'Edit preset',
    body: api => [
      h('div', { class: 'stack' },
        field('Name', h('input', { type: 'text', value: d.name, placeholder: 'e.g. Upper A (push)', onInput: e => { d.name = e.target.value; } })),
        h('div', null, h('label', { class: 'f' }, 'Exercises and blocks, in order'),
          h('div', { class: 'list' }, d.items.map((it, i) => { const l = itemLabel(it); return h('div', null,
            h('span', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's ell' }, l.sub)),
            it.k === 'ex' ? h('div', { style: { width: '64px' } }, numInput(it.sets || 3, v => { it.sets = Math.max(1, v || 1); }, { int: true, 'aria-label': 'Sets', style: 'text-align:center' }))
              : it.k === 'cardio' ? h('div', { class: 'row', style: { gap: '4px' } }, h('div', { style: { width: '64px' } }, numInput(it.min ?? '', v => { it.min = v || undefined; }, { int: true, placeholder: 'min', 'aria-label': 'Minutes', style: 'text-align:center' })), h('span', { class: 'dim tiny' }, 'min'))
              : h('span', { class: 'dim' }, l.q),
            i > 0 ? iconBtn('up', 'Move up', () => { d.items.splice(i - 1, 0, d.items.splice(i, 1)[0]); api.render(); }) : null,
            iconBtn('x', 'Remove', () => { d.items.splice(i, 1); api.render(); })); })),
          h('div', { class: 'row', style: { marginTop: '8px' } },
            h('button', { class: 'btn small grow', onClick: () => pickExercise({ kind: 'strength', onPick: ex => { d.items.push({ k: 'ex', ex: ex.id, sets: 3 }); api.render(); } }) }, icon('plus'), 'Exercise'),
            h('button', { class: 'btn small grow', onClick: () => pickBlock(b => { d.items.push({ k: 'block', block: b.id, rounds: b.rounds }); api.render(); }) }, icon('plus'), 'Block'),
            h('button', { class: 'btn small grow', onClick: () => pickExercise({ kind: 'cardio', title: 'Add cardio', onPick: ex => { d.items.push({ k: 'cardio', ex: ex.id, min: 30, rpe: 4 }); api.render(); } }) }, icon('plus'), 'Cardio')),
          h('p', { class: 'note tiny', style: { marginTop: '8px' } }, 'A preset can be gym work, cardio, or both: "Easy run", "Lower", "Hip 3". Several presets can go on the same day.')),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, h('div', { class: 't' }, 'Let the planner hand it out'), h('div', { class: 'note tiny' }, 'Used when the planner is set to distribute whole presets.')), toggle(d.plan !== false, v => { d.plan = v; }, 'Planner')),
      ),
      !isNew ? h('button', { class: 'btn block danger', style: { marginTop: '16px' }, onClick: async () => { if (await confirmSheet('Delete preset?', 'Planned days that use it fall back to Auto.', 'Delete', true)) { del('presets', d.id, 'library'); api.close(); onSaved && onSaved(null); } } }, 'Delete preset') : null,
    ],
    footer: api => [h('button', { class: 'btn', onClick: () => api.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: () => {
      if (!d.name.trim()) return toast('Give the preset a name.');
      if (!d.items.length) return toast('Add at least one exercise.');
      put('presets', d, 'library');
      const n = refreshPresetOnDays(d.id);
      api.close(); toast(n ? `Saved. Updated on ${n} planned ${n === 1 ? 'day' : 'days'}.` : 'Saved'); onSaved && onSaved(d);
    } }, 'Save')],
  });
}

/** After a preset changes, planned days from today on that use it get the new version. */
function refreshPresetOnDays(id) {
  const p = state.presets[id]; const today = ymd(); let n = 0;
  for (const pd of Object.values(state.plan)) {
    if (pd.deleted || pd.date < today) continue;
    const idx = (pd.items || []).findIndex(i => i.pre === id && i.src === 'preset');
    if (idx < 0) continue;
    const rest = pd.items.filter(i => !(i.pre === id && i.src === 'preset'));
    const at = pd.items.slice(0, idx).filter(i => !(i.pre === id && i.src === 'preset')).length;
    rest.splice(at, 0, ...presetItems(state, p));
    pd.items = rest; touch(pd); n++;
  }
  if (n) commit('plan');
  return n;
}

export function presetSummary(p) {
  const names = p.items.map(i => itemLabel(i).name);
  return `${names.slice(0, 5).join(', ')}${names.length > 5 ? ` and ${names.length - 5} more` : ''}. About ${planMinutes(state, p.items)} min`;
}

export function pickPreset(onPick, title = 'Add a preset') {
  sheet({
    title,
    body: api => {
      const presets = Object.values(state.presets).filter(p => !p.deleted);
      return [
        h('div', { class: 'list' }, presets.length ? presets.map(p => h('div', null,
          h('button', { class: 'grow', style: { textAlign: 'left' }, onClick: () => { api.close(); onPick(p); } }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, presetSummary(p))),
          iconBtn('edit', 'Edit preset', () => editPreset(p.id, () => api.render()))))
          : h('div', { class: 'empty' }, h('b', null, 'No presets yet'), 'Save a workout you repeat, such as "Easy run", "Lower" or "Hip 3", and add it to any day in one tap.')),
        h('button', { class: 'btn block', style: { marginTop: '12px' }, onClick: () => editPreset(null, p => { if (p) { api.close(); onPick(p); } }) }, icon('plus'), 'Create new preset'),
      ];
    },
  });
}

export function lastDone(an, exId) {
  const hs = an.exHist.get(exId); if (!hs?.length) return '';
  return fmtDate(hs[hs.length - 1].date);
}
export { primaryMuscle };
