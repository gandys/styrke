// More: exercise library, blocks, presets, settings, backup and sync, and how the numbers work.

import { h, icon, iconBtn, sheet, toast, confirmSheet, seg, field, toggle, numInput } from '../ui.js';
import { state, local, saveLocal, put, del, commit, setSetting, exportJson, exportCsv, importJson, listSnapshots, restoreSnapshot, saveStatus, _reset, flush } from '../store.js';
import { analyze, allExercises, getSettings, DEFAULTS, muscleTarget, halfLife, bodyweightAt, loadSeries } from '../model.js';
import { lineChart, legend, cssVar } from '../charts.js';
import { loadColor } from '../bodymap.js';
import { MUSCLES, JOINTS, MUSCLE } from '../library.js';
import { importFile, importPlan, examplePlan } from '../importers.js';
import { syncState, syncNow, syncKind, testGithub, cleanRepo, saveFile, shareFile, isAndroid, inArtifact } from '../sync.js';
import { ymd, norm, fmtDate, weekStart, fmtNum } from '../util.js';
import { editExercise, editBlock, editPreset, muscleSummary, markMine, exName, blockMinutes, itemLabel, presetSummary } from './common.js';
import { planMinutes } from '../planner.js';

const VERSION = typeof __VERSION__ !== 'undefined' ? __VERSION__ : 'dev';
let page = 'menu';
let libScope = 'mine', libQ = '';
export function morePage() { return page; }
export function setMorePage(p) { page = p; }

export function renderMore(root, ctx) {
  const go = p => { page = p; ctx.refresh(true); };
  if (page !== 'menu') ctx.setBack(() => go('menu')); else ctx.setBack(null);
  ({ menu, library, blocks, presets, settings, data, science })[page](root, ctx, go);
}

function menu(root, ctx, go) {
  ctx.setTitle('More', 'Your exercises, settings and data');
  const mine = allExercises(state).filter(e => e.mine).length;
  const nb = Object.values(state.blocks).filter(b => !b.deleted).length, np = Object.values(state.presets).filter(p => !p.deleted).length;
  const item = (ic, t, s, p) => h('button', { onClick: () => go(p) }, h('span', { class: 'iconbtn', style: { background: 'var(--raised)', color: 'var(--accent)' } }, icon(ic)), h('span', { class: 'grow' }, h('div', { class: 't' }, t), h('div', { class: 's' }, s)), icon('right', 16));
  const kind = syncKind();
  root.appendChild(h('div', { class: 'panel', style: { padding: '4px 14px' } }, h('div', { class: 'list' },
    item('list', 'Exercises', `${mine} in your list. Add, edit, create your own.`, 'library'),
    item('layers', 'Blocks', nb ? `${nb} saved. Supersets and circuits.` : 'Supersets and circuits you repeat', 'blocks'),
    item('copy', 'Workout presets', np ? `${np} saved` : 'Whole workouts you can drop on a day', 'presets'),
    item('gear', 'Settings', 'Targets, recovery speed, planner, appearance', 'settings'),
    item('cloud', 'Backup, sync and import', kind === 'github' ? 'Syncing to your GitHub repository' : kind === 'artifact' ? 'Saved in your Claude storage' : 'On this device only. Set up a cloud copy.', 'data'),
    item('book', 'How the numbers work', 'Load, fatigue, weight-adjusted volume, and the evidence', 'science'))));
  root.appendChild(h('p', { class: 'note tiny', style: { textAlign: 'center', marginTop: '18px' } }, `Styrke ${VERSION}. Your data stays on your device and in the cloud copy you choose. `,
    inArtifact() ? null : h('a', { href: 'https://github.com/gandys/styrke/releases/latest', target: '_blank', rel: 'noopener', style: { color: 'var(--accent)' } }, 'Check for a newer version')));
}

// ---------- exercises
function library(root, ctx) {
  ctx.setTitle('Exercises', 'Star the ones you do. Tap to edit.');
  const nq = norm(libQ);
  let list = allExercises(state);
  if (nq) list = list.filter(e => norm(e.name).includes(nq) || (e.alias || []).some(a => norm(a).includes(nq)) || Object.keys(e.muscles || {}).some(m => norm(MUSCLE[m]?.name).includes(nq)));
  else if (libScope === 'mine') list = list.filter(e => e.mine);
  list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'strength' ? -1 : 1) || a.name.localeCompare(b.name));
  root.appendChild(h('div', { class: 'stack' },
    h('input', { type: 'search', placeholder: 'Search by name or muscle', value: libQ, onInput: e => { libQ = e.target.value; const pos = e.target.selectionStart; ctx.refresh(); const el = document.querySelector('main input[type=search]'); el?.focus(); try { el.setSelectionRange(pos, pos); } catch { /* ignore */ } } }),
    nq ? null : seg([{ id: 'mine', name: 'My exercises' }, { id: 'all', name: 'Whole library' }], libScope, v => { libScope = v; ctx.refresh(true); }),
    h('button', { class: 'btn block', onClick: () => editExercise(null, { name: libQ }, () => ctx.refresh()) }, icon('plus'), 'Create new exercise')));
  root.appendChild(h('div', { class: 'panel', style: { padding: '4px 6px 4px 14px', marginTop: '12px' } }, h('div', { class: 'list' },
    list.length ? list.map(e => h('div', null,
      h('button', { class: 'grow', style: { textAlign: 'left', minHeight: '44px' }, onClick: () => editExercise(e.id, {}, () => ctx.refresh()) },
        h('div', { class: 't' }, e.name, e.custom ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'yours') : null, e.needsSetup ? h('span', { class: 'tag warn', style: { marginLeft: '8px' } }, 'set muscles') : null, e.kind === 'strength' && e.mine && e.plan === false ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'not planned') : null),
        h('div', { class: 's ell' }, muscleSummary(e))),
      h('button', { class: 'iconbtn', 'aria-label': e.mine ? 'Remove from my exercises' : 'Add to my exercises', style: { color: e.mine ? 'var(--accent)' : 'var(--faint)' }, onClick: () => { markMine(e.id, !e.mine); ctx.refresh(); } }, (() => { const i = icon('star'); if (e.mine) i.style.fill = 'currentColor'; return i; })())))
      : h('div', { class: 'empty' }, h('b', null, 'Nothing here'), libScope === 'mine' && !nq ? 'Open the whole library and star what you do.' : 'No match. Create it as a new exercise.'))));
}

function blocks(root, ctx) {
  ctx.setTitle('Blocks', 'Exercises done back to back, then repeated');
  const list = Object.values(state.blocks).filter(b => !b.deleted);
  root.appendChild(h('button', { class: 'btn primary block', onClick: () => editBlock(null, () => ctx.refresh()) }, icon('plus'), 'New block'));
  root.appendChild(list.length ? h('div', { class: 'panel', style: { padding: '4px 14px', marginTop: '12px' } }, h('div', { class: 'list' }, list.map(b => h('button', { onClick: () => editBlock(b.id, () => ctx.refresh()) },
    h('span', { class: 'grow' }, h('div', { class: 't' }, b.name, b.plan === false ? h('span', { class: 'tag', style: { marginLeft: '8px' } }, 'not planned') : null), h('div', { class: 's' }, b.exIds.map(exName).join(', ')), h('div', { class: 's' }, `${b.rounds} rounds, ${b.rest} s between, about ${blockMinutes(b)} min`)), icon('right', 16)))))
    : h('div', { class: 'empty' }, h('b', null, 'No blocks yet'), 'Example: flies, lateral raises, curls and reverse flies with the same dumbbells, 30 seconds between, three rounds.'));
}

function presets(root, ctx) {
  ctx.setTitle('Workout presets', 'Whole workouts you can drop on a day');
  const list = Object.values(state.presets).filter(p => !p.deleted);
  root.appendChild(h('button', { class: 'btn primary block', onClick: () => editPreset(null, () => ctx.refresh()) }, icon('plus'), 'New preset'));
  root.appendChild(list.length ? h('div', { class: 'panel', style: { padding: '4px 14px', marginTop: '12px' } }, h('div', { class: 'list' }, list.map(p => h('button', { onClick: () => editPreset(p.id, () => ctx.refresh()) },
    h('span', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, presetSummary(p))), icon('right', 16)))))
    : h('div', { class: 'empty' }, h('b', null, 'No presets yet'), 'Save a workout such as "Upper A", "Easy run" or "Hip 3" once: gym work, cardio, or both. Then add one or several to any planned day, or to the workout you are doing, in one tap.'));
}

// ---------- settings
function settings(root, ctx) {
  ctx.setTitle('Settings', '');
  const s = getSettings(state);
  const today = ymd();
  const row = (t, sub, ctl) => h('div', { class: 'row', style: { minHeight: '52px', padding: '6px 0', borderBottom: '1px solid var(--line)' } }, h('div', { class: 'grow' }, h('div', { class: 't', style: { fontWeight: 500 } }, t), sub ? h('div', { class: 'note tiny' }, sub) : null), ctl);
  const n = (key, opts = {}) => h('div', { style: { width: '84px', flex: 'none' } }, numInput(s[key], v => { if (v != null && v >= (opts.min ?? 0)) setSetting(key, v); }, { int: opts.int !== false, style: 'text-align:center', 'aria-label': opts.label || key }));
  root.appendChild(h('div', { class: 'cols' },
    h('div', null,
      h('div', { class: 'panel' }, h('h2', null, 'You'),
        row('Body weight, kg', 'Used for pull-ups, push-ups and other bodyweight work.', h('div', { style: { width: '84px' } }, numInput(bodyweightAt(state, today), v => { if (v > 20) { put('body', { date: today, kg: v }, 'settings'); setSetting('bodyweight', v); } }, { style: 'text-align:center', 'aria-label': 'Body weight' }))),
        row('Appearance', null, h('div', { style: { width: '160px' } }, seg([{ id: 'dark', name: 'Dark' }, { id: 'light', name: 'Light' }], s.theme, v => { setSetting('theme', v); document.documentElement.dataset.theme = v; ctx.refresh(); }))),
        row('Rest timer', 'Starts when you tick a set. The phone buzzes when rest is over.', toggle(s.restTimer, v => setSetting('restTimer', v), 'Rest timer')),
        row('Beep when rest is over', 'Plays through the media volume.', toggle(!!s.restSound, v => setSetting('restSound', v), 'Beep when rest is over'))),
      h('div', { class: 'panel' }, h('h2', null, 'Planner'),
        row('Longest session, minutes', 'Change it for a single day in that day\'s sheet.', n('maxMinutes', { min: 15 })),
        row('Sets per exercise', 'Starting point. The planner adds a set when time allows.', n('setsPerExercise', { min: 1 })),
        row('Lighter week every', 'One set fewer per exercise that week. 0 turns it off.', h('div', { class: 'row' }, n('deloadEvery'), h('span', { class: 'dim' }, 'weeks'))),
        s.deloadEvery ? row('Lighter-week cycle starts', s.deloadAnchor ? `Counting from the week of ${fmtDate(s.deloadAnchor)}.` : 'Not set yet.', h('button', { class: 'btn small', onClick: () => { setSetting('deloadAnchor', weekStart(today)); toast('This week is now a lighter week'); ctx.refresh(); } }, 'This week')) : null,
        row('Count cardio fully in the time limit', 'Off: cardio you fixed for a day counts half.', toggle(!!s.cardioInBudget, v => setSetting('cardioInBudget', v), 'Count cardio')),
        row('Go easy from pain level', 'The planner halves its appetite for exercises that load the area.', n('painCaution', { min: 1 })),
        row('Avoid from pain level', 'Exercises that load the area are left out.', n('painAvoid', { min: 1 }))),
      h('div', { class: 'panel' }, h('h2', null, 'Weight-adjusted volume'),
        h('p', { class: 'note', style: { marginBottom: '10px' } }, 'Each set counts as weight × reps × (weight ÷ your usual weight) raised to a power. At power 1, a set at your usual weight counts the same as plain volume; heavier sets count for more, lighter ones for less.'),
        row('How strongly weight counts', null, h('div', { style: { width: '200px' } }, seg([{ id: 0, name: 'Off' }, { id: 1, name: 'Normal' }, { id: 2, name: 'Strong' }], s.wavPower, v => { setSetting('wavPower', v); }))),
        row('"Usual weight" looks back', 'Average over this many previous sessions of the exercise.', h('div', { class: 'row' }, n('wavSessions', { min: 1 }), h('span', { class: 'dim' }, 'sessions'))))),
    h('div', null,
      h('div', { class: 'panel' }, h('h2', null, 'Weekly targets and recovery speed'),
        h('p', { class: 'note', style: { marginBottom: '8px' } }, 'Target = hard sets per week (helper work counts half). Half-life = hours of rest for the load on that muscle to halve; lower means it bounces back faster.'),
        h('div', { class: 'mrow', style: { gridTemplateColumns: '1fr 60px 60px 66px', minHeight: '24px' } }, h('span'), h('span', { class: 'note tiny', style: { textAlign: 'center' } }, 'from'), h('span', { class: 'note tiny', style: { textAlign: 'center' } }, 'to'), h('span', { class: 'note tiny', style: { textAlign: 'center' } }, 'half-life')),
        MUSCLES.map(m => { const t = muscleTarget(s, m.id); const setT = (k, v) => { const tg = { ...(state.settings.targets || {}) }; tg[m.id] = { ...muscleTarget(getSettings(state), m.id), [k]: v }; setSetting('targets', tg); };
          const inp = (val, fn, lab) => numInput(val, v => { if (v != null && v >= 0) fn(v); }, { int: true, style: 'text-align:center;min-height:38px;padding:0 2px', 'aria-label': `${m.name} ${lab}` });
          return h('div', { class: 'mrow', style: { gridTemplateColumns: '1fr 60px 60px 66px' } }, h('span', { class: 'nm' }, m.name), inp(t.lo, v => setT('lo', v), 'target from'), inp(t.hi, v => setT('hi', v), 'target to'), inp(halfLife(s, m.id), v => { if (v >= 4) setSetting('halfLife', { ...(state.settings.halfLife || {}), [m.id]: v }); }, 'half-life in hours')); }),
        h('div', { class: 'sec' }, 'Joints and tendons'),
        JOINTS.map(j => h('div', { class: 'mrow', style: { gridTemplateColumns: '1fr 66px' } }, h('span', { class: 'nm' }, j.name), numInput(halfLife(s, j.id), v => { if (v >= 4) setSetting('halfLife', { ...(state.settings.halfLife || {}), [j.id]: v }); }, { int: true, style: 'text-align:center;min-height:38px', 'aria-label': `${j.name} half-life in hours` }))),
        h('button', { class: 'btn block', style: { marginTop: '12px' }, onClick: async () => { if (await confirmSheet('Reset targets and recovery speeds?', 'Back to the built-in defaults.', 'Reset')) { state.settings.targets = {}; state.settings.halfLife = {}; setSetting('targets', {}); ctx.refresh(); } } }, 'Reset to defaults')))));
}

function planMsg(r) {
  return [r.presets ? `${r.presets} ${r.presets === 1 ? 'preset' : 'presets'} saved` : '', `${r.added} planned items on ${r.days} ${r.days === 1 ? 'day' : 'days'}`, r.missing?.length ? `Unknown presets skipped: ${r.missing.join(', ')}` : ''].filter(Boolean).join('. ') + '.';
}

// ---------- backup, sync, import
function data(root, ctx) {
  ctx.setTitle('Backup, sync and import', '');
  const kind = syncKind();
  const an = analyze(state);
  const nSets = an.allSets.length, nDays = an.days.size;
  const gh = local.github || { owner: '', repo: '', token: '' };

  const status = h('div', { class: 'panel' }, h('h2', null, 'Where your data is'),
    h('div', { class: 'list' },
      h('div', null, h('span', { class: 'tag good' }, 'on'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'On this device'), h('div', { class: 's' }, `${nSets} sets on ${nDays} days. Saved automatically after every change${saveStatus.at ? ', last at ' + new Date(saveStatus.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}. Seven daily restore points are kept.`))),
      h('div', null, h('span', { class: 'tag ' + (kind ? (syncState.status === 'err' ? 'warn' : 'good') : '') }, kind ? (syncState.status === 'err' ? 'error' : 'on') : 'off'), h('span', { class: 'grow' }, h('div', { class: 't' }, kind === 'artifact' ? 'Claude storage' : 'Cloud copy (GitHub)'),
        h('div', { class: 's' }, kind ? (syncState.status === 'err' ? syncState.msg : `Last synced ${local.lastSync ? new Date(local.lastSync).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'never'}.`) : 'Not set up. If you lose this phone, you lose the data.')),
        kind ? h('button', { class: 'btn small', onClick: async () => { const r = await syncNow(); toast(r.ok ? 'Synced' : 'Sync failed'); ctx.refresh(); } }, 'Sync now') : null),
      isAndroid() ? h('div', null, h('span', { class: 'tag ' + (local.fileBackup === false ? '' : 'good') }, local.fileBackup === false ? 'off' : 'on'), h('span', { class: 'grow' }, h('div', { class: 't' }, 'Daily backup file'), h('div', { class: 's' }, `A dated file in Download/Styrke on this phone${local.lastBackup ? ', last ' + local.lastBackup : ''}. Point Google Drive or any backup app at that folder if you like.`)),
        toggle(local.fileBackup !== false, v => { local.fileBackup = v; saveLocal(); ctx.refresh(); }, 'Daily backup file')) : null));

  const ghPanel = inArtifact() && kind !== 'github' ? null : h('div', { class: 'panel' }, h('h2', null, 'Cloud sync with a private GitHub repository'),
    h('p', { class: 'note', style: { marginBottom: '10px' } }, 'Your log is saved as one file in a repository only you can see, with full version history, plus spreadsheet copies you can open anywhere. Phone and laptop merge automatically.'),
    h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('div', { class: 'grow' }, field('Owner', h('input', { type: 'text', value: gh.owner, placeholder: 'your GitHub name', autocapitalize: 'off', autocomplete: 'off', onInput: e => { gh.owner = e.target.value.trim(); } }))),
        h('div', { class: 'grow' }, field('Repository', h('input', { type: 'text', value: gh.repo, placeholder: 'styrke-data', autocapitalize: 'off', autocomplete: 'off', onInput: e => { gh.repo = e.target.value.trim(); } })))),
      field('Access token', h('input', { type: 'password', value: gh.token, placeholder: 'github_pat_…', autocomplete: 'off', onInput: e => { gh.token = e.target.value.trim(); } }), 'Stays on this device. Never included in backups or synced.'),
      h('div', { class: 'row' },
        h('button', { class: 'btn primary grow', onClick: async e => {
          Object.assign(gh, cleanRepo(gh.owner, gh.repo)); gh.token = gh.token.replace(/\s+/g, '');
          if (!gh.owner || !gh.repo || !gh.token) return toast('Fill in owner, repository and token.');
          const btn = e.currentTarget; btn.disabled = true; btn.textContent = 'Connecting…';
          let msg = '';
          try {
            const info = await testGithub(gh); local.github = { ...gh }; saveLocal();
            const r = await syncNow();
            msg = r.ok ? (info.private ? 'Connected and synced' : 'Connected and synced. Note: that repository is public, so anyone can read your log.') : 'Connected, but the first sync failed: ' + syncState.msg;
          } catch (err) { msg = err.message; }
          ctx.refresh(); toast(msg);
        } }, 'Connect and sync'),
        local.github ? h('button', { class: 'btn', onClick: () => { local.github = null; saveLocal(); toast('Cloud sync turned off on this device'); ctx.refresh(); } }, 'Disconnect') : null),
      h('details', null, h('summary', { style: { cursor: 'pointer', color: 'var(--accent)', fontWeight: 500, minHeight: '36px' } }, 'How to set this up (5 minutes, once)'),
        h('ol', { class: 'note', style: { paddingLeft: '20px', lineHeight: 1.6 } },
          h('li', null, 'On github.com create a new repository, for example ', h('b', null, 'styrke-data'), ', and set it to Private.'),
          h('li', null, 'Go to Settings, Developer settings, Personal access tokens, Fine-grained tokens, Generate new token.'),
          h('li', null, 'Repository access: Only select repositories, pick styrke-data. Permissions: Contents, Read and write. Choose a long expiry.'),
          h('li', null, 'Copy the token, paste it here, and press Connect and sync. Do the same on your other devices.')))));

  const fileIn = h('input', { type: 'file', accept: '.json,.csv,.xlsx,application/json,text/csv', class: 'hide', onChange: async e => {
    const f = e.target.files[0]; if (!f) return; e.target.value = '';
    try {
      const r = await importFile(f);
      if (r.kind === 'backup') {
        const replace = await confirmSheet('Import backup', 'Merge keeps everything you have and adds what is in the file (newest version of each entry wins). Choose Cancel to stop.', 'Merge into my data');
        if (replace) { importJson(r.obj, 'merge'); toast('Backup merged'); }
      } else if (r.kind === 'plan') toast(planMsg(r));
      else { sheet({ title: 'Import finished', body: [h('p', null, `Imported ${r.sets} sets and ${r.cardio} cardio entries on ${r.days} days (${r.from} to ${r.to}).`), r.skipped ? h('p', { class: 'note' }, `${r.skipped} rows had no reps and were skipped.`) : null,
        r.keptEdited ? h('p', { class: 'note' }, `${r.keptEdited} days were left alone because you changed them in the app.`) : null,
        r.created.length ? h('div', { class: 'banner', style: { marginTop: '10px' } }, icon('info'), h('div', null, 'These exercises were not recognised and were created without muscles. Open Exercises and set their muscles so they count toward load: ', h('b', null, r.created.join(', ')))) : h('p', { class: 'note' }, 'Every exercise was matched to the library. Check the muscle settings under Exercises if a name was matched loosely.')] }); }
      ctx.refresh();
    } catch (err) { toast(err.message || 'Could not read that file'); }
  } });
  const backup = h('div', { class: 'panel' }, h('h2', null, 'Backup files and import'),
    h('div', { class: 'stack' },
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', onClick: async () => { try { flush(); const r = await saveFile(`styrke-backup-${ymd()}.json`, exportJson()); toast('Backup saved to ' + r.where); } catch (e) { toast(e.message); } } }, icon('dl'), 'Save backup'),
        h('button', { class: 'btn grow', onClick: async () => { const ok = await shareFile(`styrke-backup-${ymd()}.json`, exportJson()); if (!ok) toast('Sharing is not available here. Use Save backup.'); } }, icon('ul'), 'Share backup')),
      h('button', { class: 'btn block', onClick: async () => { try { const files = exportCsv(); let where = ''; for (const [name, text] of Object.entries(files)) where = (await saveFile('styrke-' + name, text, 'text/csv')).where; toast('4 spreadsheets saved to ' + where); } catch (e) { toast(e.message); } } }, icon('dl'), 'Save as spreadsheets (CSV)'),
      h('button', { class: 'btn block', onClick: () => fileIn.click() }, icon('ul'), 'Import a file'), fileIn,
      h('p', { class: 'note tiny' }, 'Import reads a Styrke backup, a Styrke plan file, or a workout log exported from Notion or Excel (.xlsx or .csv with Exercise, Date, Weight, Reps columns, one row per set). Importing the same log twice does not create duplicates.')));

  let planText = '';
  const planPanel = h('div', { class: 'panel' }, h('h2', null, 'Planned sessions from Claude or another tool'),
    h('p', { class: 'note', style: { marginBottom: '10px' } }, 'Ask Claude (for example in your marathon project) to "export the next weeks as a Styrke plan". Paste the result here, import it as a file, or with GitHub sync let Claude drop it in the repository\'s inbox folder and it appears on the next sync.'),
    h('textarea', { placeholder: '{ "styrke": "plan", "sessions": [ … ] }', style: { minHeight: '96px', fontFamily: 'ui-monospace, monospace', fontSize: '12.5px' }, onInput: e => { planText = e.target.value; } }),
    h('div', { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn primary grow', onClick: () => { try { const r = importPlan(JSON.parse(planText)); toast(planMsg(r)); ctx.refresh(); } catch (e) { toast(e instanceof SyntaxError ? 'That is not valid JSON.' : e.message); } } }, 'Import plan'),
      h('button', { class: 'btn', onClick: async () => { const t = JSON.stringify(examplePlan(), null, 2); try { await navigator.clipboard.writeText(t); toast('Example copied'); } catch { sheet({ title: 'Example plan', body: h('pre', { style: { whiteSpace: 'pre-wrap', fontSize: '12.5px' } }, t) }); } } }, 'Copy an example')));

  const snaps = h('div', { class: 'panel' }, h('h2', null, 'Restore points'), h('div', { id: 'snaps', class: 'note' }, 'Loading…'),
    h('button', { class: 'btn block danger', style: { marginTop: '14px' }, onClick: async () => { if (await confirmSheet('Erase everything on this device?', 'Your log, plan, exercises and settings on this device are deleted. A cloud copy, if you have one, is not touched and will sync back.', 'Erase', true)) { _reset(); state.settings = { _u: Date.now() }; commit('reset'); flush(); toast('Erased'); ctx.refresh(); } } }, 'Erase all data on this device'));
  listSnapshots().then(list => { const el = document.getElementById('snaps'); if (!el) return;
    el.replaceChildren(list.length ? h('div', { class: 'list' }, list.map(d => h('div', null, h('span', { class: 'grow t' }, fmtDate(d, { year: true })), h('button', { class: 'btn small', onClick: async () => { if (await confirmSheet('Go back to this day?', `Everything is restored to how it was at the end of ${fmtDate(d)}. Later changes on this device are lost.`, 'Restore')) { await restoreSnapshot(d); toast('Restored'); ctx.refresh(); } } }, 'Restore')))) : 'A restore point is saved each day you use the app.'); });

  root.appendChild(h('div', { class: 'cols' }, h('div', null, status, ghPanel, snaps), h('div', null, backup, planPanel)));
}

// ---------- how it works (pictures first, detail on request)
function science(root, ctx) {
  ctx.setTitle('How the numbers work', 'The short version, in pictures');
  const s = getSettings(state);
  const an = analyze(state);
  const c1 = cssVar('--c1'), c2 = cssVar('--c2'), c3 = cssVar('--c3');
  const a = (t, u) => h('a', { href: u, target: '_blank', rel: 'noopener' }, t);
  const more = (...kids) => h('details', { class: 'hmore' }, h('summary', null, 'More detail'), h('div', { class: 'prose' }, kids));
  const card = (n, title, lead, ...kids) => h('section', { class: 'panel how' }, h('h2', null, h('span', { class: 'hn num' }, n), title), h('p', { class: 'lead' }, lead), kids);
  const meter = (label, value, max, color, right) => h('div', { class: 'hrow' }, h('span', { class: 'hl' }, label),
    h('div', { class: 'bar', style: { height: '12px', borderRadius: '6px' } }, h('i', { style: { width: Math.max(0, Math.min(100, value / max * 100)) + '%', background: color, borderRadius: '6px' } })), h('span', { class: 'hv num' }, right));
  const badge = (letter, cls, title, text) => h('div', { class: 'hbadge' }, h('span', { class: 'n ' + cls }, letter), h('div', null, h('b', null, title), h('div', { class: 'note' }, text)));

  // 1 ---- hard sets
  const hard = card(1, 'Which sets count', 'Only sets that end close to your limit count as "hard sets". Warm-ups drop out on their own.',
    h('div', { class: 'tank' },
      h('div', { class: 'tankbar' }, h('i', { style: { flex: 5, background: 'var(--accent)' } }), h('i', { style: { flex: 6, background: 'linear-gradient(90deg, var(--accent), var(--raised))' } }), h('i', { style: { flex: 5, background: 'var(--raised)' } })),
      h('div', { class: 'tanklab' }, h('span', { style: { flex: 5 } }, h('b', null, '0–4 reps left'), 'counts as 1 set'), h('span', { style: { flex: 6 } }, h('b', null, '5–9 left'), 'counts partly'), h('span', { style: { flex: 5 } }, h('b', null, '10+ left'), 'counts as 0'))),
    h('div', { class: 'sub' }, 'Example: incline press, best recent set 27.5 kg × 11'),
    meter('15 kg × 26', 0, 1, 'var(--accent)', '0'), meter('22.5 kg × 16', 0.45, 1, 'var(--accent)', '0.5'), meter('27.5 kg × 11', 1, 1, 'var(--accent)', '1'),
    h('div', { class: 'sub' }, 'You can overrule the estimate: tap a set number'),
    badge('2', '', 'Number', 'Normal set. The app estimates how hard it was.'),
    badge('W', 'w', 'Warm-up', 'Logged, but never counts.'),
    badge('H', 'h', 'Hard', 'Always counts as one full set.'),
    badge('D', 'd', 'Drop set', 'Counts as at least half a set.'),
    more(h('p', null, 'The app compares each set with your estimated best for that exercise (from your recent sessions) and works out how many more reps you could have done. Up to 4 reps left counts in full, fading to nothing at 10 left. The estimate cannot see everything: a light set late in a circuit can be hard. That is what H is for.')));

  // 2 ---- sets per muscle
  const perMuscle = card(2, 'Which muscles get the credit', 'The main muscle gets the full set. Muscles that help get about half.',
    h('div', { class: 'sub' }, '3 hard sets of incline dumbbell press give'),
    meter('Chest', 3, 3, c1, '3.0'), meter('Front delts', 1.8, 3, c1, '1.8'), meter('Triceps', 1.5, 3, c1, '1.5'),
    h('p', { class: 'note', style: { marginTop: '8px' } }, 'You can change which muscles an exercise trains under More, Exercises.'),
    more(h('p', null, 'A 2024 analysis of 67 training studies found that counting helper muscles as half a set predicted muscle growth better than counting them fully or not at all.')));

  // 3 ---- weekly targets: diminishing returns
  const tg = muscleTarget(s, 'biceps');
  const W = 320, H = 150, L = 8, B = 24, maxX = 24;
  const fx = v => L + (W - L - 8) * v / maxX, fy = v => (H - B) - (H - B - 12) * Math.sqrt(v / maxX);
  let d = ''; for (let v = 0; v <= maxX; v += 0.5) d += (v ? 'L' : 'M') + fx(v).toFixed(1) + ',' + fy(v).toFixed(1);
  const curve = h('svg', { viewBox: `0 0 ${W} ${H}`, class: 'hsvg', role: 'img', 'aria-label': 'Benefit rises quickly for the first sets and flattens out' },
    h('rect', { x: fx(tg.lo), y: 6, width: fx(tg.hi) - fx(tg.lo), height: H - B - 6, fill: 'var(--good)', opacity: 0.16 }),
    h('line', { x1: L, x2: W - 8, y1: H - B, y2: H - B, class: 'hax' }),
    h('path', { d, fill: 'none', stroke: c1, 'stroke-width': 2.5, 'stroke-linecap': 'round' }),
    h('circle', { cx: fx(4), cy: fy(4), r: 4.5, fill: c1, stroke: 'var(--panel)', 'stroke-width': 2 }),
    h('text', { x: fx(4) + 8, y: fy(4) + 14, class: 'htx' }, 'about 4: the least that works'),
    h('text', { x: (fx(tg.lo) + fx(tg.hi)) / 2, y: 20, class: 'htx', 'text-anchor': 'middle', style: { fill: 'var(--good)' } }, 'your target'),
    [0, 4, 8, 12, 16, 20, 24].map(v => h('text', { x: fx(v), y: H - 7, class: 'htx', 'text-anchor': 'middle' }, v)),
    h('text', { x: W - 8, y: H - B - 6, class: 'htx', 'text-anchor': 'end' }, 'hard sets per week'));
  const targets = card(3, 'How many sets a week', 'The first sets do the most. Each extra set adds a little less, so the planner stops at the top of your target.',
    curve, h('p', { class: 'note' }, `The green band is your biceps target (${tg.lo}–${tg.hi}). Change any muscle's target in Settings.`),
    more(h('p', null, 'Research is clear that more weekly sets build more muscle with diminishing returns, and that around 11 sets for one muscle in a single session is where extra sets stop showing a benefit. Strength flattens out much sooner than size.'),
      h('p', null, 'The exact target for each muscle is a coaching default, not a law. Evidence that particular muscles need different amounts is thin, so adjust to how you respond.')));

  // 4 ---- load fades
  const hrs = []; for (let t = 0; t <= 96; t += 4) hrs.push(t);
  const dec = id => hrs.map(t => 100 * Math.pow(0.5, t / halfLife(s, id)));
  const fade = card(4, 'Load fades while you rest', 'Training puts load on a muscle. Rest halves it at a steady pace: fast for small muscles, slow for legs and tendons.',
    legend([{ name: `Biceps (halves in ${halfLife(s, 'biceps')} h)`, color: c1 }, { name: `Quads (${halfLife(s, 'quads')} h)`, color: c2 }, { name: `Achilles (${halfLife(s, 'achilles')} h)`, color: c3 }, { name: 'Ready again', color: 'var(--faint)', dash: true }]),
    lineChart({ labels: hrs.map(t => t % 24 === 0 ? (t === 0 ? 'now' : `+${t / 24} d`) : `+${t} h`), unit: '%', height: 170, fmt: v => fmtNum(v),
      series: [{ name: 'Biceps', color: c1, values: dec('biceps') }, { name: 'Quads', color: c2, values: dec('quads') }, { name: 'Achilles', color: c3, values: dec('achilles') }, { name: 'Ready', color: cssVar('--faint'), dash: true, values: hrs.map(() => s.readyAt * 100) }] }),
    h('div', { class: 'sub' }, 'The colours on the body map'),
    h('div', { class: 'hramp' }, [['Fresh', 0.05, 'under 20%'], ['Recovering', 0.33, '20–45%'], ['Loaded', 0.62, '45–75%'], ['Heavy', 1, 'over 75%']].map(([t, f, r]) => h('div', null, h('i', { style: { background: loadColor(f) } }), h('b', null, t), h('span', null, r)))),
    h('p', { class: 'note', style: { marginTop: '8px' } }, '100% is roughly one full, hard session for that muscle. Cardio counts too: an easy 30 minute run puts about a third of that on calves and Achilles.'),
    more(h('p', null, 'Big compound lifts add a little more load per set than isolation work, and heavier sets add more to joints. What a muscle or tendon can take also grows with what it is used to: someone who runs five times a week has an Achilles that copes with more.'),
      h('p', null, 'This is a model of how recovery tends to go, not a measurement of your tissue. If you feel wrecked and the map says fresh, believe your body. Recovery speeds are editable in Settings.')));

  // 5 ---- weight-adjusted volume
  const ex = [['30 kg × 20', 600, 300], ['60 kg × 10', 600, 600], ['100 kg × 6', 600, 1000]];
  const wav = card(5, 'Weight-adjusted volume', 'Plain volume (kg × reps) cannot tell heavy from light. The adjusted number counts heavy sets for more.',
    h('div', { class: 'sub' }, 'Three sets, same plain volume. Your usual weight here: 60 kg'),
    legend([{ name: 'Plain volume', color: c1 }, { name: 'Weight-adjusted', color: c2 }]),
    ex.map(([lab, v, w]) => h('div', { class: 'pair' }, h('span', { class: 'hl' }, lab), h('div', null,
      h('div', { class: 'pbar' }, h('i', { style: { width: v / 10 + '%', background: c1 } }), h('span', { class: 'num' }, v)),
      h('div', { class: 'pbar' }, h('i', { style: { width: w / 10 + '%', background: c2 } }), h('span', { class: 'num' }, w))))),
    h('div', { class: 'formula' }, h('span', { class: 'num' }, 'weight × reps'), h('span', null, '×'), h('span', { class: 'frac num' }, h('span', null, 'weight'), h('span', null, 'your usual weight'))),
    h('p', { class: 'note' }, `"Usual weight" is your average over the previous ${s.wavSessions} sessions of that exercise. Lift as usual and both numbers match; go heavier and the adjusted one pulls ahead.`),
    more(h('p', null, 'In Insights, the "What kind of work" chart shows the same idea as zones: heavy (85% of your estimated best or more), moderate (60–85%) and light. How strongly weight counts is adjustable in Settings.')));

  // 6 ---- whole-body load
  const ls = an.sessions.length ? loadSeries(an, ymd(), ymd()) : [];
  const ratio = ls.length ? ls[0].ratio : null;
  const zones = [['Lighter', 0.8, 'var(--l1)'], ['Steady', 1.15, 'var(--good)'], ['Building', 1.5, 'var(--l2)'], ['Spike', 2, 'var(--l4)']];
  const pos = r => Math.min(100, Math.max(0, r / 2 * 100));
  const body = card(6, 'Whole-body load', 'Gym sets and cardio become one number. The app compares your last 7 days with what you are used to over 28.',
    h('div', { class: 'zone', style: { marginTop: '22px' } },
      zones.map(([t, to, col], i) => h('i', { style: { left: pos(i ? zones[i - 1][1] : 0) + '%', width: (pos(to) - pos(i ? zones[i - 1][1] : 0)) + '%', background: col } })),
      ratio != null ? h('b', { style: { left: pos(ratio) + '%' } }, h('span', { class: 'num' }, `you: ${Math.round(ratio * 100)}%`)) : null),
    h('div', { class: 'zonelab' }, zones.map(([t, to], i) => h('span', { style: { left: pos(((i ? zones[i - 1][1] : 0) + to) / 2) + '%' } }, t))),
    h('div', { class: 'zonelab ticks' }, [[0.8, '80%'], [1.15, '115%'], [1.5, '150%']].map(([v, t]) => h('span', { class: 'num', style: { left: pos(v) + '%' } }, t))),
    h('p', { class: 'note', style: { marginTop: '6px' } }, 'Above 150% is a sharp jump from your normal. That is when tendons tend to complain, so the app warns you.'),
    more(h('p', null, 'Researchers disagree on whether this ratio predicts injuries, so the app only uses it as a guard against sudden spikes, not as a forecast.')));

  // 7 ---- pain
  const seg10 = Array.from({ length: 11 }, (_, n) => n);
  const pcol = n => n >= 7 ? 'var(--l4)' : n >= s.painAvoid ? 'var(--pain)' : n >= s.painCaution ? 'var(--warn)' : 'var(--raised)';
  const painC = card(7, 'Pain ratings', 'Rate a joint or tendon from 0 to 10. The planner reacts to your latest rating.',
    h('div', { class: 'pscale' }, seg10.map(n => h('i', { class: 'num', style: { background: pcol(n), color: n >= s.painCaution ? '#10161d' : 'var(--dim)' } }, n))),
    h('div', { class: 'hbadge' }, h('span', { class: 'dot', style: { background: 'var(--raised)' } }), h('div', null, h('b', null, `0–${s.painCaution - 1}: train as planned`), h('div', { class: 'note' }, 'Keep an eye on it.'))),
    h('div', { class: 'hbadge' }, h('span', { class: 'dot', style: { background: 'var(--warn)' } }), h('div', null, h('b', null, `${s.painCaution}–${s.painAvoid - 1}: go easy`), h('div', { class: 'note' }, 'Exercises that load the area are used less and marked "go easy".'))),
    h('div', { class: 'hbadge' }, h('span', { class: 'dot', style: { background: 'var(--pain)' } }), h('div', null, h('b', null, `${s.painAvoid}–6: left out`), h('div', { class: 'note' }, 'The planner leaves out exercises that load the area. Runs you fixed yourself are flagged, not removed.'))),
    h('div', { class: 'hbadge' }, h('span', { class: 'dot', style: { background: 'var(--l4)' } }), h('div', null, h('b', null, '7 and up: stop loading it'), h('div', { class: 'note' }, 'Get it looked at if it does not settle.'))),
    more(h('p', null, 'This follows the pain-monitoring model from Achilles rehab research: discomfort up to about 5/10 during activity is acceptable when it has settled by the next morning and is not creeping up week to week. Until you rate it again, the app assumes it eases by about a point a day. Sharp, one-sided or on-the-bone pain, swelling, or a pop: stop and get it checked. This is a training aid, not medical advice.')));

  const sources = h('div', { class: 'panel prose' }, h('h3', { style: { marginTop: 0 } }, 'Sources'),
    h('p', null, a('Pelland et al., weekly volume and frequency', 'https://sportrxiv.org/index.php/server/preprint/view/460'), '. ', a('Remmert et al., per-session volume', 'https://sportrxiv.org/index.php/server/preprint/view/537'), '. ', a('Silbernagel et al. 2007, pain-monitoring model', 'https://search.pedro.org.au/search-results/record-detail/18389'), '. ', a('Critique of the acute:chronic workload ratio', 'https://nata.kglmeridian.com/view/journals/attr/55/9/article-p893.xml'), '.'));

  root.appendChild(h('div', { class: 'cols' }, h('div', null, hard, perMuscle, targets, painC), h('div', null, fade, wav, body, sources)));
}
