import test from "node:test";
import assert from "node:assert/strict";
import { ManagementSession, SessionEndedError } from "../factory/management-session.js";

function harness() {
  let wall = 100000, mono = 0, timer;
  const calls = [], ended = [], replies = [];
  const session = new ManagementSession({ clock: () => wall, monotonic: () => mono,
    schedule: action => { timer = action; return 1; }, cancel: () => { timer = undefined; },
    onEnd: message => ended.push(message),
    fetcher: async (url, options) => {
      calls.push({ url, options });
      if (replies.length) return await replies.shift();
      const value = url.endsWith('/session') ? { csrf: 'anonymous-fixture', identity: null }
        : url.endsWith('/login') ? { csrf: 'page-fixture', identity: { role: 'platform' }, expiresIn: 3600 } : { ok: true };
      return { ok: true, status: 200, json: async () => value, blob: async () => new Blob(['fixture']) };
    } });
  return { session, calls, ended, replies, advance(ms) { wall += ms; mono += ms; }, wallOnly(ms) { wall += ms; },
    monoOnly(ms) { mono += ms; }, fire() { timer?.(); } };
}
async function login(h) { await h.session.reset(); await h.session.login('synthetic', 'synthetic-only'); }
const response = data => ({ ok: true, status: 200, json: async () => data });

test('page session reset never adopts cookie identity and authenticated requests carry page proof', async () => {
  const h = harness(); await login(h);
  await h.session.call('/factories'); await h.session.call('/config/a', 'PUT', { version: 1 });
  await h.session.download('/factories/a/contacts.csv');
  assert.equal(h.calls[0].options.headers['X-Page-Proof'], undefined);
  assert.equal(h.calls[1].options.headers['X-CSRF-Token'], 'anonymous-fixture');
  for (const call of h.calls.slice(2)) assert.equal(call.options.headers['X-Page-Proof'], 'page-fixture');
  assert.equal(h.calls[3].options.headers['X-CSRF-Token'], 'page-fixture');
  await h.session.reset(); assert.equal(h.session.active, false); assert.equal(h.session.ready, true);
  await assert.rejects(h.session.call('/factories'), SessionEndedError);
  h.replies.push(response({ csrf: 'legacy', identity: { role: 'platform' } }));
  await assert.rejects(h.session.reset(), /需要更新/); assert.equal(h.session.ready, false);
});

test('page authority expires at3600 seconds without activity renewal and catches suspended timer', async () => {
  const h = harness(); await login(h); h.advance(3599000);
  await h.session.call('/factories'); assert.equal(h.session.active, true);
  h.advance(1000); await assert.rejects(h.session.call('/config/a', 'PUT', {}), SessionEndedError);
  assert.equal(h.session.ready, false); assert.match(h.ended.at(-1), /一小时/);
  assert.equal(h.calls.filter(c => c.options.method === 'PUT').length, 0);
});

test('wall clock suspend and monotonic clock each enforce expiry without extending login', async () => {
  const h = harness(); await login(h); h.wallOnly(3600000); assert.equal(h.session.check(), false);
  await login(h); h.wallOnly(-7200000); h.monoOnly(3600000); h.fire(); assert.equal(h.session.active, false);
});

test('logout clears authority immediately offline and delayed protected data cannot be returned', async () => {
  const h = harness(); await login(h); let release;
  h.replies.push(new Promise(resolve => { release = resolve; }));
  const pending = h.session.call('/factories/a/contacts');
  h.replies.push(Promise.reject(new Error('offline')));
  const logout = h.session.logout(); assert.equal(h.session.active, false);
  release(response({ contacts: ['sensitive-fixture'] }));
  await assert.rejects(logout, /网络未连接/); await assert.rejects(pending, SessionEndedError);
  assert.equal(h.session.ready, false);
  await h.session.reset(); assert.equal(h.session.ready, true); assert.equal(h.session.active, false);
});

test('late login and late CSV body after exit cannot restore authority or produce a download', async () => {
  const h = harness(); await h.session.reset(); let releaseLogin;
  h.replies.push(new Promise(resolve => { releaseLogin = resolve; }));
  const pending = h.session.login('synthetic', 'synthetic-only'); h.session.clear();
  releaseLogin(response({ csrf: 'late-proof', identity: { role: 'platform' }, expiresIn: 3600 }));
  await assert.rejects(pending, SessionEndedError); assert.equal(h.session.active, false);
  await login(h); let releaseBlob;
  h.replies.push({ ok: true, status: 200, blob: () => new Promise(resolve => { releaseBlob = resolve; }) });
  const csv = h.session.download('/factories/a/contacts.csv');
  for (let n = 0; n < 5; n++) await Promise.resolve();
  h.session.clear(); releaseBlob(new Blob(['fixture'])); await assert.rejects(csv, SessionEndedError);
});

test('expired late response and server401 clear page while ordinary403 retains scoped session', async () => {
  const h = harness(); await login(h); let release;
  h.replies.push(new Promise(resolve => { release = resolve; }));
  const pending = h.session.call('/config/a'); h.advance(3600000); release(response({ private: 'fixture' }));
  await assert.rejects(pending, SessionEndedError); assert.equal(h.session.active, false);
  await login(h); h.replies.push({ ok: false, status: 403, json: async () => ({ detail: '只能管理本厂' }) });
  await assert.rejects(h.session.call('/config/b'), /只能管理本厂/); assert.equal(h.session.active, true);
  h.replies.push({ ok: false, status: 401, json: async () => ({ detail: 'expired' }) });
  await assert.rejects(h.session.call('/config/a'), SessionEndedError); assert.equal(h.session.active, false);
});
