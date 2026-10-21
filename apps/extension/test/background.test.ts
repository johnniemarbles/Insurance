// The background worker's country rules (1.7.0): the country is kept per Gmail account, saved only after a sign-in works,
// found by itself on install, and a typed server address counts in development builds only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';

const CA = 'https://ca.punjabinsurance.co', US = 'https://us.punjabinsurance.co';

/** Builds src/background.ts as the store does, with InboxSDK's worker part left out, for one run against a fake Chrome. */
async function code(dev = false): Promise<string> {
  const out = await build({
    entryPoints: [fileURLToPath(new URL('../src/background.ts', import.meta.url))], bundle: true, write: false, format: 'iife', platform: 'browser',
    define: { __API_BASE__: JSON.stringify(CA), __REGIONS__: JSON.stringify({ ca: CA, us: US }), __INBOXSDK_APP_ID__: '"x"', __DEV_BUILD__: JSON.stringify(dev) },
    plugins: [{ name: 'no-inboxsdk', setup(b) { b.onResolve({ filter: /^@inboxsdk\// }, () => ({ path: 'x', namespace: 'empty' })); b.onLoad({ filter: /.*/, namespace: 'empty' }, () => ({ contents: '' })); } }],
  });
  return out.outputFiles[0]!.text;
}

/** A fake Chrome: storage areas, tabs, runtime events; signedIn says who each server would answer /v1/me with. */
function fakeChrome(signedIn: Record<string, string | null>) {
  const area = () => { const d: Record<string, unknown> = {}; return { d, get: async (k: string | string[]) => Object.fromEntries((Array.isArray(k) ? k : [k]).filter((x) => x in d).map((x) => [x, d[x]])), set: async (v: Record<string, unknown>) => { Object.assign(d, v); }, remove: async (k: string) => { delete d[k]; } }; };
  const ev = () => { const fs: ((...a: any[]) => unknown)[] = []; return { fs, addListener: (f: any) => fs.push(f) }; };
  const created: string[] = [], removed: number[] = [], fetched: string[] = [];
  let nextTab = 7;
  const chrome = {
    storage: { local: area(), sync: area(), session: area() },
    tabs: { onUpdated: ev(), onRemoved: ev(), create: async (o: { url: string }) => { created.push(o.url); return { id: nextTab++ }; }, remove: async (id: number) => { removed.push(id); } },
    runtime: { id: 'me', onInstalled: ev(), onMessage: ev() },
  };
  const fetch = async (url: string) => {
    fetched.push(url);
    const origin = new URL(url).origin;
    const who = signedIn[origin];
    return { ok: Boolean(who), status: who ? 200 : 401, json: async () => ({ user: { email: who } }), text: async () => JSON.stringify(who ? { user: { email: who } } : {}) };
  };
  return { chrome, fetch, created, removed, fetched };
}
const plain = (v: unknown) => JSON.parse(JSON.stringify(v));
const settle = () => new Promise((r) => setTimeout(r, 20));
async function boot(signedIn: Record<string, string | null>, dev = false) {
  const f = fakeChrome(signedIn);
  runInNewContext(await code(dev), { chrome: f.chrome, fetch: f.fetch, URL, console });
  return f;
}
const send = (f: Awaited<ReturnType<typeof boot>>, msg: unknown) => new Promise<any>((resolve) => {
  const keep = f.chrome.runtime.onMessage.fs[0]!(msg, { id: 'me' }, resolve);
  if (keep !== true) setTimeout(() => resolve(undefined), 10);
});

test('on install: the country each person is already signed in to is remembered for their Gmail', async () => {
  const f = await boot({ [CA]: 'harpreet@agency.test', [US]: null });
  for (const g of f.chrome.runtime.onInstalled.fs) g({ reason: 'update' });
  await settle();
  assert.deepEqual(plain(f.chrome.storage.local.d.regionByAccount), { 'harpreet@agency.test': 'ca' });
  assert.ok(f.chrome.storage.local.d.signedInAt, 'Gmail tabs are told to redraw');
});

test('signing in saves nothing until it works; then the country that let the person in is kept and the tab closes', async () => {
  const f = await boot({ [CA]: null, [US]: 'jordan@broker.test' });
  f.chrome.storage.sync.d.region = 'ca'; // left over from before 1.7.0
  await send(f, { type: 'pii:signin', region: 'ca', hint: 'Jordan@Broker.test' });
  await settle();
  assert.equal(f.created[0], `${CA}/auth/google/start?hint=Jordan%40Broker.test`);
  assert.equal(f.chrome.storage.local.d.regionByAccount, undefined, 'nothing kept before the sign-in works');
  assert.equal(f.chrome.storage.sync.d.region, 'ca', 'the old browser-wide setting is not touched');
  // Canada had no account and sent the person to the US, which signed them in.
  for (const g of f.chrome.tabs.onUpdated.fs) g(7, { url: `${CA}/auth/google/callback?code=x` });
  for (const g of f.chrome.tabs.onUpdated.fs) g(7, { url: `${US}/?signed_in=1&moved=1` });
  await settle();
  assert.deepEqual(plain(f.chrome.storage.local.d.regionByAccount), { 'jordan@broker.test': 'us' });
  assert.deepEqual(f.removed, [7], 'the sign-in tab closes');
});

test('a welcome page after an invitation stays open; tabs the extension did not open are left alone', async () => {
  const f = await boot({ [CA]: 'new@partner.test', [US]: null });
  for (const g of f.chrome.tabs.onUpdated.fs) g(99, { url: `${CA}/?signed_in=1` });
  await settle();
  assert.equal(f.chrome.storage.local.d.regionByAccount, undefined);
  await send(f, { type: 'pii:signin', region: 'ca', hint: 'new@partner.test' });
  await settle();
  for (const g of f.chrome.tabs.onUpdated.fs) g(7, { url: `${CA}/?signed_in=1&welcome=1` });
  await settle();
  assert.deepEqual(plain(f.chrome.storage.local.d.regionByAccount), { 'new@partner.test': 'ca' });
  assert.deepEqual(f.removed, []);
});

test('API calls go to the country asked for; a typed server address counts only in development builds', async () => {
  const store = await boot({ [CA]: 'a@x.test', [US]: 'a@x.test' });
  store.chrome.storage.sync.d.apiBase = 'https://evil.test';
  assert.equal((await send(store, { type: 'pii:base', region: 'us' })).base, US);
  assert.equal((await send(store, { type: 'pii:base' })).base, CA, 'store build ignores the typed address');
  const dev = await boot({}, true);
  dev.chrome.storage.sync.d.apiBase = 'https://test.example';
  assert.equal((await send(dev, { type: 'pii:base' })).base, 'https://test.example');
});
