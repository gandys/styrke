import test from 'node:test';
import assert from 'node:assert/strict';
import { state, local, _reset, commit, serialize } from '../src/store.js';
import { syncNow, syncState, testGithub, cleanRepo } from '../src/sync.js';

// A tiny in-memory stand-in for the GitHub contents API.
function fakeGithub() {
  const files = new Map(); let n = 0; const log = [];
  const enc = t => Buffer.from(t, 'utf8').toString('base64'), dec = b => Buffer.from(b, 'base64').toString('utf8');
  const res = (status, body) => ({ ok: status < 400, status, json: async () => body, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  globalThis.fetch = async (url, opts = {}) => {
    // like the real API from a browser: a trailing slash or doubled slash fails before any response
    if (/\/$/.test(url) || /[^:]\/\//.test(url)) throw new TypeError('Failed to fetch');
    const path = decodeURIComponent(url.split('/contents/')[1] || '');
    const method = opts.method || 'GET'; log.push(method + ' ' + path);
    if (!url.includes('/contents/')) return res(200, { private: true, full_name: 'me/data', permissions: { push: true } });
    if (opts.headers?.Authorization !== 'Bearer tok') return res(401, { message: 'Bad credentials' });
    if (method === 'GET') {
      if (files.has(path)) { const f = files.get(path); return res(200, { sha: f.sha, content: enc(f.text), path }); }
      const kids = [...files.keys()].filter(k => k.startsWith(path + '/'));
      if (kids.length) return res(200, kids.map(k => ({ name: k.split('/').pop(), path: k, sha: files.get(k).sha })));
      return res(404, { message: 'Not Found' });
    }
    const body = JSON.parse(opts.body);
    if (method === 'PUT') {
      const cur = files.get(path);
      if (cur && cur.sha !== body.sha) return res(409, { message: 'sha mismatch' });
      const sha = 'sha' + (++n); files.set(path, { sha, text: dec(body.content) });
      return res(200, { content: { sha } });
    }
    if (method === 'DELETE') { files.delete(path); return res(200, {}); }
  };
  return { files, log, put: (p, t) => files.set(p, { sha: 'x' + (++n), text: t }) };
}

test('GitHub sync: first push, merge from another device, inbox plan import, CSV copies', async () => {
  const gh = fakeGithub();
  _reset(); local.github = { owner: 'me', repo: 'data', token: 'tok' }; local.lastCsv = '';
  state.settings = { _u: 5, bodyweight: 80 };
  state.sessions.a = { id: 'a', date: '2026-11-01', items: [{ k: 'ex', ex: 'leg_press', sets: [{ w: 60, r: 10, d: true }] }], u: 10 };
  const info = await testGithub(local.github);   // the 'Connect' button
  assert.equal(info.private, true);
  assert.deepEqual(cleanRepo('gandys', 'styrke-data'), { owner: 'gandys', repo: 'styrke-data' });
  assert.deepEqual(cleanRepo('', 'https://github.com/gandys/styrke-data.git'), { owner: 'gandys', repo: 'styrke-data' });
  assert.deepEqual(cleanRepo('gandys/styrke-data', ''), { owner: 'gandys', repo: 'styrke-data' });
  assert.deepEqual(cleanRepo(' gandys ', 'styrke-data/'), { owner: 'gandys', repo: 'styrke-data' });
  let r = await syncNow();
  assert.equal(r.ok, true, syncState.msg);
  assert.ok(gh.files.has('styrke-data.json'));
  assert.ok(gh.files.has('export/sets.csv') && gh.files.get('export/sets.csv').text.includes('Leg Press'));
  assert.equal(JSON.parse(gh.files.get('styrke-data.json').text).sessions.a.date, '2026-11-01');

  // another device adds a session and edits ours with a newer timestamp
  const remote = JSON.parse(gh.files.get('styrke-data.json').text);
  remote.sessions.b = { id: 'b', date: '2026-11-03', items: [], u: 20 };
  remote.sessions.a = { ...remote.sessions.a, note: 'from laptop', u: 30 };
  gh.put('styrke-data.json', JSON.stringify(remote));
  // meanwhile this device logs something new, and Claude drops a plan in the inbox
  state.sessions.c = { id: 'c', date: '2026-11-04', items: [], u: 40 }; state._rev++;
  gh.put('inbox/week.json', JSON.stringify({ styrke: 'plan', source: 'marathon', sessions: [{ date: '2026-12-01', kind: 'run', minutes: 40 }] }));
  r = await syncNow();
  assert.equal(r.ok, true, syncState.msg);
  assert.equal(r.imported, 1);
  assert.equal(state.sessions.a.note, 'from laptop');
  assert.ok(state.sessions.b && state.sessions.c);
  assert.equal(state.plan['2026-12-01'].items[0].ex, 'run');
  assert.ok(!gh.files.has('inbox/week.json'), 'inbox file is removed once imported');
  const after = JSON.parse(gh.files.get('styrke-data.json').text);
  assert.ok(after.sessions.a && after.sessions.b && after.sessions.c && after.plan['2026-12-01']);
  assert.ok(!('github' in after) && !JSON.stringify(after).includes('tok'), 'token never leaves the device');

  // nothing changed: no write
  const puts = gh.log.filter(l => l.startsWith('PUT')).length;
  await syncNow();
  assert.equal(gh.log.filter(l => l.startsWith('PUT')).length, puts);

  // wrong token gives a clear error and keeps local data
  local.github.token = 'nope';
  r = await syncNow();
  assert.equal(r.ok, false); assert.match(syncState.msg, /token/i);
  assert.ok(state.sessions.c);
  local.github = null;
});
