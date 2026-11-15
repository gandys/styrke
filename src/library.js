// Static reference data: muscles, joints, workout types and the built-in exercise library.
// Muscle contributions follow the "fractional set" convention from the dose-response
// literature: 1.0 = the exercise trains this muscle directly, ~0.5 = indirectly.

/** half = recovery half-life in hours (how fast accumulated load fades).
 *  lo/hi = default weekly target band in fractional hard sets. These are practical
 *  defaults, editable in Settings. */
export const MUSCLES = [
  { id: 'chest',      name: 'Chest',            group: 'upper', half: 24, lo: 8,  hi: 14 },
  { id: 'front_delt', name: 'Front delts',      group: 'upper', half: 22, lo: 4,  hi: 8 },
  { id: 'side_delt',  name: 'Side delts',       group: 'upper', half: 16, lo: 10, hi: 18 },
  { id: 'rear_delt',  name: 'Rear delts',       group: 'upper', half: 16, lo: 8,  hi: 14 },
  { id: 'lats',       name: 'Lats',             group: 'upper', half: 24, lo: 10, hi: 16 },
  { id: 'upper_back', name: 'Upper back',       group: 'upper', half: 22, lo: 8,  hi: 14 },
  { id: 'traps',      name: 'Traps',            group: 'upper', half: 18, lo: 4,  hi: 10 },
  { id: 'biceps',     name: 'Biceps',           group: 'upper', half: 18, lo: 10, hi: 16 },
  { id: 'triceps',    name: 'Triceps',          group: 'upper', half: 20, lo: 8,  hi: 14 },
  { id: 'forearms',   name: 'Forearms',         group: 'upper', half: 14, lo: 2,  hi: 8 },
  { id: 'abs',        name: 'Abs',              group: 'core',  half: 14, lo: 4,  hi: 10 },
  { id: 'obliques',   name: 'Obliques',         group: 'core',  half: 14, lo: 0,  hi: 6 },
  { id: 'lower_back', name: 'Lower back',       group: 'core',  half: 30, lo: 3,  hi: 8 },
  { id: 'glutes',     name: 'Glutes',           group: 'lower', half: 28, lo: 4,  hi: 10 },
  { id: 'abductors',  name: 'Hip abductors',    group: 'lower', half: 18, lo: 3,  hi: 8 },
  { id: 'quads',      name: 'Quads',            group: 'lower', half: 32, lo: 6,  hi: 12 },
  { id: 'hamstrings', name: 'Hamstrings',       group: 'lower', half: 32, lo: 5,  hi: 10 },
  { id: 'adductors',  name: 'Adductors',        group: 'lower', half: 26, lo: 0,  hi: 6 },
  { id: 'calves',     name: 'Calves',           group: 'lower', half: 16, lo: 6,  hi: 12 },
];
export const MUSCLE = Object.fromEntries(MUSCLES.map(m => [m.id, m]));

/** Joints and tendons. Connective tissue recovers and adapts more slowly than muscle. */
export const JOINTS = [
  { id: 'shoulder',    name: 'Shoulder',           half: 36 },
  { id: 'elbow',       name: 'Elbow',              half: 36 },
  { id: 'wrist',       name: 'Wrist',              half: 30 },
  { id: 'lower_spine', name: 'Lower back (spine)', half: 48 },
  { id: 'hip',         name: 'Hip',                half: 40 },
  { id: 'knee',        name: 'Knee',               half: 44 },
  { id: 'achilles',    name: 'Achilles / ankle',   half: 48 },
];
export const JOINT = Object.fromEntries(JOINTS.map(j => [j.id, j]));

/** Workout types. `m` = muscles whose exercises belong in that type (by primary muscle). */
export const TYPES = [
  { id: 'auto',   name: 'Auto',        hint: 'Planner decides', m: null },
  { id: 'upper',  name: 'Upper body',  m: ['chest', 'front_delt', 'side_delt', 'rear_delt', 'lats', 'upper_back', 'traps', 'biceps', 'triceps', 'forearms'] },
  { id: 'lower',  name: 'Lower body',  m: ['glutes', 'abductors', 'quads', 'hamstrings', 'adductors', 'calves', 'lower_back'] },
  { id: 'full',   name: 'Full body',   m: MUSCLES.map(m => m.id) },
  { id: 'push',   name: 'Push',        m: ['chest', 'front_delt', 'side_delt', 'triceps'] },
  { id: 'pull',   name: 'Pull',        m: ['lats', 'upper_back', 'rear_delt', 'traps', 'biceps', 'forearms'] },
  { id: 'legs',   name: 'Legs',        m: ['glutes', 'abductors', 'quads', 'hamstrings', 'adductors', 'calves'] },
  { id: 'arms',   name: 'Arms & delts', m: ['biceps', 'triceps', 'forearms', 'side_delt', 'rear_delt'] },
  { id: 'core',   name: 'Core',        m: ['abs', 'obliques', 'lower_back'] },
  { id: 'cardio', name: 'Cardio',      m: [] },
  { id: 'custom', name: 'Custom',      hint: 'Only what you add by hand', m: null },
  { id: 'rest',   name: 'Rest',        m: [] },
];
export const TYPE = Object.fromEntries(TYPES.map(t => [t.id, t]));

export const EQUIP = { barbell: 'Barbell', dumbbell: 'Dumbbell', machine: 'Machine', cable: 'Cable', bodyweight: 'Bodyweight', other: 'Other' };

function parseMap(str) {
  const o = {};
  if (!str) return o;
  for (const tok of str.trim().split(/\s+/)) {
    const m = tok.match(/^([a-z_]+?)(\d*\.?\d+)$/);
    if (m) o[m[1]] = parseFloat(m[2]);
  }
  return o;
}

/** Strength exercise.
 *  mech: C compound, I isolation. opts: side (weight is per hand, load counts x2),
 *  bw (fraction of bodyweight lifted), heavy (high systemic cost), rep [lo,hi], rest (s), alias. */
function S(id, name, equip, mech, muscles, joints, opts = {}) {
  const comp = mech === 'C';
  return {
    id, name, kind: 'strength', equip, mech: comp ? 'compound' : 'isolation',
    muscles: parseMap(muscles), joints: parseMap(joints),
    perSide: !!opts.side, bw: opts.bw || 0,
    cost: opts.heavy ? 1.25 : comp ? 1.1 : 1.0,
    repLo: (opts.rep || (comp ? [8, 12] : [10, 15]))[0],
    repHi: (opts.rep || (comp ? [8, 12] : [10, 15]))[1],
    rest: opts.rest || (opts.heavy ? 150 : comp ? 120 : 75),
    alias: opts.alias || [],
  };
}

/** Cardio exercise. rate = load units per 10 min at moderate effort. */
function C(id, name, rate, muscles, joints, opts = {}) {
  return { id, name, kind: 'cardio', equip: 'other', rate, muscles: parseMap(muscles), joints: parseMap(joints), alias: opts.alias || [], dist: opts.dist !== false };
}

export const LIBRARY = [
  // ---------- Chest
  S('bench_press', 'Bench Press', 'barbell', 'C', 'chest1 front_delt.5 triceps.5', 'shoulder.7 elbow.4 wrist.3', { rep: [5, 10], heavy: true }),
  S('incline_bench_press', 'Incline Bench Press', 'barbell', 'C', 'chest1 front_delt.6 triceps.5', 'shoulder.7 elbow.4 wrist.3', { rep: [6, 10] }),
  S('db_bench_press', 'Dumbbell Bench Press', 'dumbbell', 'C', 'chest1 front_delt.5 triceps.5', 'shoulder.6 elbow.4 wrist.2', { side: true }),
  S('incline_db_press', 'Incline Dumbbell Press', 'dumbbell', 'C', 'chest1 front_delt.6 triceps.5', 'shoulder.6 elbow.4 wrist.2', { side: true }),
  S('chest_press_machine', 'Chest Press Machine', 'machine', 'C', 'chest1 front_delt.5 triceps.5', 'shoulder.5 elbow.4'),
  S('incline_press_machine', 'Incline Press Machine', 'machine', 'C', 'chest1 front_delt.6 triceps.5', 'shoulder.5 elbow.4'),
  S('push_up', 'Push-ups', 'bodyweight', 'C', 'chest1 front_delt.5 triceps.5 abs.2', 'shoulder.5 elbow.4 wrist.5', { bw: 0.64, rep: [10, 25], rest: 90, alias: ['pushups', 'push ups'] }),
  S('dip', 'Dips', 'bodyweight', 'C', 'chest.8 triceps1 front_delt.5', 'shoulder.8 elbow.5', { bw: 1 }),
  S('db_fly', 'Dumbbell Flies', 'dumbbell', 'I', 'chest1 front_delt.3', 'shoulder.6 elbow.2', { side: true, alias: ['dumbbell fly', 'db flies', 'pec fly', 'flys'] }),
  S('cable_fly', 'Cable Fly', 'cable', 'I', 'chest1 front_delt.3', 'shoulder.5', { side: true, alias: ['cable crossover'] }),
  S('pec_deck', 'Pec Deck', 'machine', 'I', 'chest1 front_delt.3', 'shoulder.5', { alias: ['machine fly'] }),
  // ---------- Shoulders
  S('ohp', 'Overhead Press', 'barbell', 'C', 'front_delt1 side_delt.5 triceps.5 traps.3', 'shoulder.8 elbow.4 lower_spine.3', { rep: [5, 10], heavy: true }),
  S('db_shoulder_press', 'Dumbbell Shoulder Press', 'dumbbell', 'C', 'front_delt1 side_delt.5 triceps.5 traps.2', 'shoulder.7 elbow.4', { side: true }),
  S('shoulder_press_machine', 'Shoulder Press Machine', 'machine', 'C', 'front_delt1 side_delt.5 triceps.5', 'shoulder.6 elbow.4'),
  S('db_lateral_raise', 'Lateral Raises', 'dumbbell', 'I', 'side_delt1 traps.2', 'shoulder.5', { side: true, rep: [10, 20], alias: ['lateral raise', 'side raises'] }),
  S('cable_lateral_raise', 'Cable Lateral Raise', 'cable', 'I', 'side_delt1 traps.2', 'shoulder.5', { rep: [10, 20], alias: ['shoulders cable'] }),
  S('lateral_raise_machine', 'Lateral Raise Machine', 'machine', 'I', 'side_delt1 traps.2', 'shoulder.4', { rep: [10, 20] }),
  S('db_front_raise', 'Front Raise', 'dumbbell', 'I', 'front_delt1 side_delt.3', 'shoulder.5', { side: true }),
  S('db_reverse_fly', 'Reverse Flies', 'dumbbell', 'I', 'rear_delt1 upper_back.5', 'shoulder.4', { side: true, rep: [10, 20], alias: ['reverse fly', 'rear delt fly', 'reverse flys'] }),
  S('reverse_pec_deck', 'Reverse Pec Deck', 'machine', 'I', 'rear_delt1 upper_back.5', 'shoulder.3', { rep: [10, 20] }),
  S('face_pull', 'Face Pull', 'cable', 'I', 'rear_delt1 upper_back.5 traps.3', 'shoulder.3', { rep: [12, 20] }),
  S('upright_row', 'Upright Row', 'cable', 'C', 'side_delt1 traps.6 biceps.2', 'shoulder.8 wrist.3'),
  // ---------- Back
  S('pull_up', 'Pull-ups', 'bodyweight', 'C', 'lats1 biceps.5 upper_back.5 rear_delt.3 forearms.3', 'shoulder.6 elbow.5', { bw: 1, rep: [5, 12], alias: ['pullups', 'pull ups'] }),
  S('chin_up', 'Chin-ups', 'bodyweight', 'C', 'lats1 biceps.7 upper_back.4 forearms.3', 'shoulder.6 elbow.6', { bw: 1, rep: [5, 12] }),
  S('lat_pulldown', 'Lat Pulldown', 'cable', 'C', 'lats1 biceps.5 upper_back.4 rear_delt.3', 'shoulder.5 elbow.4'),
  S('seated_row', 'Seated Row', 'machine', 'C', 'upper_back1 lats.8 biceps.5 rear_delt.5', 'shoulder.4 elbow.4 lower_spine.2', { alias: ['complete rows', 'cable row', 'machine row', 'rows'] }),
  S('bb_row', 'Barbell Row', 'barbell', 'C', 'upper_back1 lats.8 biceps.5 rear_delt.5 lower_back.4', 'shoulder.4 elbow.4 lower_spine.6', { heavy: true }),
  S('db_row', 'Dumbbell Row', 'dumbbell', 'C', 'lats1 upper_back.8 biceps.5 rear_delt.4', 'shoulder.4 elbow.4 lower_spine.2'),
  S('chest_supported_row', 'Chest-Supported Row', 'machine', 'C', 'upper_back1 lats.7 biceps.5 rear_delt.5', 'shoulder.4 elbow.4'),
  S('high_cable_row', 'High Cable Row', 'cable', 'C', 'upper_back1 lats.6 rear_delt.6 biceps.4', 'shoulder.4 elbow.4'),
  S('cable_pullover', 'Standing Lat Pullover', 'cable', 'I', 'lats1 triceps.3 abs.2', 'shoulder.5', { alias: ['straight arm pulldown', 'cable pullover'] }),
  S('db_pullover', 'Dumbbell Pullover', 'dumbbell', 'I', 'lats1 chest.5 triceps.3', 'shoulder.7', { alias: ['lat pullover db'] }),
  S('db_shrug', 'Shrugs', 'dumbbell', 'I', 'traps1 forearms.3', 'shoulder.2', { side: true, alias: ['bench shrugs', 'dumbbell shrug'] }),
  S('back_extension', 'Back Extension', 'bodyweight', 'I', 'lower_back1 glutes.5 hamstrings.5', 'lower_spine.6 hip.3', { bw: 0.4, rep: [10, 20], alias: ['lumbares', 'hyperextension'] }),
  S('inverted_row', 'Inverted Row', 'bodyweight', 'C', 'upper_back1 lats.7 biceps.5 rear_delt.5', 'shoulder.4 elbow.4', { bw: 0.6 }),
  // ---------- Arms
  S('db_curl', 'Biceps Curl', 'dumbbell', 'I', 'biceps1 forearms.4', 'elbow.5 wrist.2', { side: true, alias: ['biceps', 'dumbbell curl', 'bicep curl', 'biceps curls'] }),
  S('bb_curl', 'Barbell / EZ Curl', 'barbell', 'I', 'biceps1 forearms.4', 'elbow.5 wrist.4'),
  S('hammer_curl', 'Hammer Curl', 'dumbbell', 'I', 'biceps.8 forearms.7', 'elbow.5', { side: true }),
  S('incline_db_curl', 'Incline Dumbbell Curl', 'dumbbell', 'I', 'biceps1 forearms.3', 'elbow.5 shoulder.2', { side: true }),
  S('preacher_curl', 'Preacher Curl', 'machine', 'I', 'biceps1 forearms.3', 'elbow.6'),
  S('cable_curl', 'Cable Curl', 'cable', 'I', 'biceps1 forearms.4', 'elbow.5'),
  S('triceps_pushdown', 'Triceps Pushdown', 'cable', 'I', 'triceps1', 'elbow.6', { alias: ['triceps down'] }),
  S('overhead_triceps_ext', 'Overhead Triceps Extension', 'cable', 'I', 'triceps1', 'elbow.7 shoulder.3', { alias: ['triceps up'] }),
  S('skullcrusher', 'Skullcrusher', 'barbell', 'I', 'triceps1', 'elbow.8'),
  S('close_grip_bench', 'Close-Grip Bench Press', 'barbell', 'C', 'triceps1 chest.6 front_delt.5', 'shoulder.6 elbow.6 wrist.4'),
  S('triceps_kickback', 'Triceps Kickback', 'dumbbell', 'I', 'triceps1', 'elbow.5', { side: true }),
  S('wrist_curl', 'Wrist Curl', 'dumbbell', 'I', 'forearms1', 'wrist.6', { side: true, rep: [12, 20] }),
  S('reverse_wrist_curl', 'Reverse Wrist Curl', 'dumbbell', 'I', 'forearms1', 'wrist.6 elbow.3', { side: true, rep: [12, 20], alias: ['forearm up'] }),
  S('reverse_curl', 'Reverse Curl', 'barbell', 'I', 'forearms1 biceps.5', 'elbow.5 wrist.4'),
  // ---------- Legs
  S('squat', 'Back Squat', 'barbell', 'C', 'quads1 glutes.7 adductors.5 lower_back.4 hamstrings.2 abs.2', 'knee.8 hip.6 lower_spine.7', { rep: [5, 10], heavy: true }),
  S('front_squat', 'Front Squat', 'barbell', 'C', 'quads1 glutes.6 adductors.4 upper_back.3 abs.3', 'knee.8 hip.5 lower_spine.5 wrist.4', { rep: [5, 10], heavy: true }),
  S('goblet_squat', 'Goblet Squat', 'dumbbell', 'C', 'quads1 glutes.6 adductors.4 abs.3', 'knee.7 hip.5 lower_spine.3', { bw: 0.6 }),
  S('heel_elevated_squat', 'Elevated-Heel BW Squat', 'bodyweight', 'C', 'quads1 glutes.4', 'knee.8 hip.3', { bw: 0.7, rep: [10, 25], rest: 90 }),
  S('leg_press', 'Leg Press', 'machine', 'C', 'quads1 glutes.6 adductors.4 hamstrings.2', 'knee.7 hip.4'),
  S('hack_squat', 'Hack Squat', 'machine', 'C', 'quads1 glutes.5 adductors.3', 'knee.8 hip.4', { heavy: true }),
  S('bulgarian_split_squat', 'Bulgarian Split Squat', 'dumbbell', 'C', 'quads1 glutes.8 adductors.4 hamstrings.3 abductors.3', 'knee.7 hip.6', { side: true, bw: 0.6, alias: ['bulgarian squat'] }),
  S('lunge', 'Lunges', 'dumbbell', 'C', 'quads1 glutes.8 adductors.4 hamstrings.3', 'knee.7 hip.5', { side: true, bw: 0.6 }),
  S('step_up', 'Step-ups', 'dumbbell', 'C', 'quads1 glutes.8 abductors.3', 'knee.6 hip.4', { side: true, bw: 0.7 }),
  S('leg_extension', 'Leg Extension', 'machine', 'I', 'quads1', 'knee.7'),
  S('leg_curl', 'Leg Curl', 'machine', 'I', 'hamstrings1 calves.2', 'knee.4'),
  S('deadlift', 'Deadlift', 'barbell', 'C', 'glutes1 lower_back1 hamstrings.8 quads.4 traps.5 forearms.5 lats.3', 'lower_spine1 hip.7 knee.4', { rep: [3, 8], heavy: true }),
  S('rdl', 'Romanian Deadlift', 'barbell', 'C', 'hamstrings1 glutes.8 lower_back.6 forearms.3', 'lower_spine.8 hip.6', { heavy: true }),
  S('db_rdl', 'Stiff-Leg Deadlift (DB)', 'dumbbell', 'C', 'hamstrings1 glutes.8 lower_back.6 forearms.3', 'lower_spine.7 hip.6', { side: true, alias: ['stiff-leg dl', 'stiff leg dl', 'dumbbell rdl'] }),
  S('db_deadlift', 'Dumbbell Deadlift', 'dumbbell', 'C', 'lower_back1 glutes.8 hamstrings.7 quads.4 traps.3 forearms.4', 'lower_spine.8 hip.6 knee.3', { side: true, alias: ['lower back dl'] }),
  S('deficit_db_deadlift', 'Elevated Deep Deadlift', 'dumbbell', 'C', 'glutes1 hamstrings.9 lower_back.9 quads.5 forearms.4', 'lower_spine.9 hip.7 knee.4', { side: true, alias: ['elevated deep dl', 'deficit deadlift'] }),
  S('hip_thrust', 'Hip Thrust', 'barbell', 'C', 'glutes1 hamstrings.4 quads.3', 'hip.5 lower_spine.3'),
  S('hip_abduction', 'Hip Abduction', 'machine', 'I', 'abductors1 glutes.4', 'hip.4', { rep: [12, 20] }),
  S('band_abduction', 'Banded Hip Work', 'other', 'I', 'abductors1 glutes.5', 'hip.3', { rep: [12, 20], rest: 45, alias: ['clamshell', 'monster walk', 'hip 3', 'side-lying abduction'] }),
  S('hip_adduction', 'Hip Adduction', 'machine', 'I', 'adductors1', 'hip.4', { rep: [12, 20] }),
  S('calf_raise', 'Calf Raise', 'machine', 'I', 'calves1', 'achilles.8', { rep: [10, 20], alias: ['calves', 'standing calf raise'] }),
  S('seated_calf_raise', 'Seated Calf Raise', 'machine', 'I', 'calves1', 'achilles.6', { rep: [10, 20] }),
  S('single_leg_calf_raise', 'Single-Leg Calf Raise', 'bodyweight', 'I', 'calves1', 'achilles.9', { bw: 1, rep: [10, 20], rest: 60 }),
  S('nordic_curl', 'Nordic Curl', 'bodyweight', 'I', 'hamstrings1 glutes.3', 'knee.5', { bw: 0.6, rep: [4, 10] }),
  // ---------- Core
  S('crunch', 'Abs / Crunch', 'bodyweight', 'I', 'abs1 obliques.3', 'lower_spine.3', { bw: 0.3, rep: [12, 25], rest: 60, alias: ['abs', 'crunches', 'sit-ups'] }),
  S('cable_crunch', 'Cable Crunch', 'cable', 'I', 'abs1 obliques.3', 'lower_spine.3', { rep: [10, 20] }),
  S('hanging_leg_raise', 'Hanging Leg Raise', 'bodyweight', 'I', 'abs1 obliques.3 forearms.3', 'shoulder.3 lower_spine.3', { bw: 0.4, rep: [8, 15] }),
  S('ab_wheel', 'Ab Wheel', 'other', 'I', 'abs1 lats.3 obliques.3', 'shoulder.4 lower_spine.5', { bw: 0.5, rep: [6, 15] }),
  S('plank', 'Plank (reps = seconds)', 'bodyweight', 'I', 'abs1 obliques.4', 'shoulder.2 lower_spine.2', { bw: 0.5, rep: [30, 90], rest: 60 }),
  S('side_plank', 'Side Plank (reps = seconds)', 'bodyweight', 'I', 'obliques1 abductors.4 abs.4', 'shoulder.3', { bw: 0.4, rep: [20, 60], rest: 45 }),
  S('russian_twist', 'Russian Twist', 'other', 'I', 'obliques1 abs.5', 'lower_spine.5', { bw: 0.2, rep: [12, 30], rest: 60 }),
  // ---------- Cardio and other activity
  C('run', 'Run', 1.25, 'calves.9 quads.6 hamstrings.5 glutes.5 abductors.3 adductors.2 abs.1', 'achilles1 knee.8 hip.5 lower_spine.2', { alias: ['running', 'correr', 'easy run', 'long run', 'løp'] }),
  C('treadmill_run', 'Treadmill Run', 1.2, 'calves.9 quads.6 hamstrings.5 glutes.5 abductors.3 adductors.2 abs.1', 'achilles1 knee.7 hip.5 lower_spine.2', { alias: ['treadmill'] }),
  C('bike', 'Bike', 0.8, 'quads.7 glutes.4 hamstrings.3 calves.3', 'knee.4 hip.2', { alias: ['bici', 'cycling', 'sykkel', 'stationary bike', 'spinning'] }),
  C('hike', 'Hike (tur)', 0.7, 'calves.6 quads.6 glutes.5 hamstrings.4 abductors.2', 'knee.6 achilles.5 hip.4', { alias: ['tur', 'hiking', 'fjelltur'] }),
  C('walk', 'Walk', 0.3, 'calves.4 quads.3 glutes.3', 'achilles.4 knee.3', { alias: ['walking'] }),
  C('row_erg', 'Rowing Machine', 1.0, 'lats.5 upper_back.5 quads.5 glutes.4 hamstrings.4 biceps.3 lower_back.5', 'lower_spine.6 knee.3 elbow.2'),
  C('elliptical', 'Elliptical', 0.7, 'quads.5 glutes.4 hamstrings.3 calves.3', 'knee.3'),
  C('stairs', 'Stair Climber', 1.0, 'quads.7 glutes.6 calves.5', 'knee.6 achilles.5'),
  C('swim', 'Swim', 0.9, 'lats.6 front_delt.4 triceps.4 upper_back.3 abs.2', 'shoulder.7'),
  C('xc_ski', 'Cross-Country Ski', 1.0, 'lats.5 triceps.5 quads.5 glutes.5 calves.4 abs.3 hamstrings.3', 'shoulder.4 knee.4 hip.3 achilles.3', { alias: ['langrenn', 'ski'] }),
  C('climbing', 'Climbing / Bouldering', 0.9, 'forearms1 lats.7 biceps.6 upper_back.5 abs.3', 'elbow.7 shoulder.6 wrist.6', { alias: ['bouldering'], dist: false }),
  C('cardio_other', 'Cardio (other)', 0.7, 'quads.4 calves.3 glutes.3', 'knee.3', { alias: ['cardio'], dist: false }),
];
export const LIB = Object.fromEntries(LIBRARY.map(e => [e.id, e]));

/** Exercises marked as "mine" on a fresh install: a sensible machine + dumbbell starter set. */
export const STARTER_MINE = ['incline_db_press', 'seated_row', 'db_lateral_raise', 'db_curl', 'db_fly', 'db_reverse_fly',
  'triceps_pushdown', 'pull_up', 'leg_press', 'db_rdl', 'calf_raise', 'crunch', 'run', 'bike', 'hike'];

export function primaryMuscle(ex) {
  let best = null, bv = -1;
  for (const [m, v] of Object.entries(ex.muscles || {})) if (v > bv) { bv = v; best = m; }
  return best;
}

/** Does this exercise belong in a workout of the given type? */
export function fitsType(ex, typeId) {
  if (!typeId || typeId === 'auto' || typeId === 'full' || typeId === 'custom') return ex.kind === 'strength';
  if (typeId === 'cardio') return ex.kind === 'cardio';
  if (ex.kind !== 'strength') return false;
  const t = TYPE[typeId];
  if (!t || !t.m) return true;
  return t.m.includes(primaryMuscle(ex));
}
