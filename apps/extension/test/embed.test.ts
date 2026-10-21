// The Gmail-side bridge for the server's screens: what the frame may ask the extension to do, and what it gets back.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'https://ca.punjabinsurance.co';

/** Just enough of a page for mountEmbedded: one iframe, window listeners, timers. */
function fakePage() {
  const listeners: Record<string, ((e: any) => unknown)[]> = {};
  const toFrame: { msg: any; origin: string }[] = [];
  const frameWin = { postMessage: (msg: any, origin: string) => { toFrame.push({ msg, origin }); } };
  const iframe: any = { style: {}, contentWindow: frameWin, removed: false, remove() { this.removed = true; } };
  (globalThis as any).document = { createElement: () => iframe };
  (globalThis as any).window = {
    addEventListener: (t: string, f: any) => { (listeners[t] ??= []).push(f); },
    removeEventListener: (t: string, f: any) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
  };
  const host: any = { append: () => undefined };
  const send = async (data: any, opts: { origin?: string; source?: unknown } = {}) => {
    for (const f of listeners.message ?? []) await f({ data, origin: opts.origin ?? BASE, source: opts.source ?? frameWin });
  };
  return { iframe, host, toFrame, send, listeners };
}

function opts(over: Record<string, unknown> = {}) {
  const calls: Record<string, unknown[][]> = { compose: [], relay: [], region: [], nav: [], signin: [], fail: [] };
  const o: any = {
    base: BASE, extVersion: '1.5.0', route: { page: 'home' }, regions: [{ id: 'ca', label: 'Canada' }, { id: 'us', label: 'United States' }], region: 'ca',
    getToken: async () => ({ status: 200, json: { token: 'tok-1' } }),
    onSignIn: (...a: unknown[]) => calls.signin!.push(a),
    navigate: (...a: unknown[]) => calls.nav!.push(a),
    switchRegion: (...a: unknown[]) => calls.region!.push(a),
    compose: async (m: any) => { calls.compose!.push([m]); return { ok: true, threadId: 't1' }; },
    relay: async (...a: unknown[]) => { calls.relay!.push(a); return { status: 200, json: { hello: 'us' } }; },
    onFail: () => calls.fail!.push([]),
    ...over,
  };
  return { o, calls };
}

const { mountEmbedded, READY_TIMEOUT_MS } = await import('../src/embed.ts');

test('frames the server page and hands over a token, regions and the compose flag on ready', async () => {
  const p = fakePage(); const { o } = opts();
  const stop = mountEmbedded(p.host, o);
  assert.equal(p.iframe.src, `${BASE}/app?embed=1`);
  assert.equal(p.iframe.allow, 'microphone'); // voice in Gmail: only the PII frame may ask for the microphone
  await p.send({ pii: 'ready' });
  const init = p.toFrame.find((m) => m.msg.pii === 'init')!;
  assert.equal(init.origin, BASE);
  assert.equal(init.msg.token, 'tok-1');
  assert.equal(init.msg.region, 'ca');
  assert.equal(init.msg.compose, true);
  assert.deepEqual(init.msg.regions.map((r: any) => r.id), ['ca', 'us']);
  stop();
  assert.equal(p.iframe.removed, true);
});

test('ignores messages from Gmail or any other origin', async () => {
  const p = fakePage(); const { o, calls } = opts();
  const stop = mountEmbedded(p.host, o);
  await p.send({ pii: 'compose', reqId: 'x', to: 'a@b.c', subject: 's', html: 'h' }, { origin: 'https://mail.google.com' });
  await p.send({ pii: 'region', region: 'us' }, { source: {} });
  assert.equal(calls.compose!.length, 0);
  assert.equal(calls.region!.length, 0);
  stop();
});

test('sends through Gmail compose and answers the frame', async () => {
  const p = fakePage(); const { o, calls } = opts();
  const stop = mountEmbedded(p.host, o);
  await p.send({ pii: 'compose', reqId: 'c1', to: 'lead@example.com', subject: 'Hi', html: '<p>x</p>', review: true });
  assert.deepEqual(calls.compose![0]![0], { to: 'lead@example.com', subject: 'Hi', html: '<p>x</p>', review: true });
  const r = p.toFrame.find((m) => m.msg.pii === 'compose-result')!;
  assert.deepEqual(r.msg, { pii: 'compose-result', reqId: 'c1', result: { ok: true, threadId: 't1' } });
  stop();
});

test('a failed compose comes back as an error, not silence', async () => {
  const p = fakePage(); const { o } = opts({ compose: async () => { throw new Error('boom'); } });
  const stop = mountEmbedded(p.host, o);
  await p.send({ pii: 'compose', reqId: 'c2', to: 'a@b.c', subject: 's', html: 'h' });
  assert.deepEqual(p.toFrame.find((m) => m.msg.pii === 'compose-result')!.msg.result, { ok: false, error: 'boom' });
  stop();
});

test('relays other-country API calls only for known countries and /v1 paths', async () => {
  const p = fakePage(); const { o, calls } = opts();
  const stop = mountEmbedded(p.host, o);
  await p.send({ pii: 'api', reqId: 'a1', method: 'GET', path: '/v1/ho/companies', region: 'us' });
  assert.deepEqual(calls.relay![0], ['GET', '/v1/ho/companies', undefined, 'us']);
  assert.deepEqual(p.toFrame.find((m) => m.msg.pii === 'api-result')!.msg, { pii: 'api-result', reqId: 'a1', status: 200, json: { hello: 'us' } });
  await p.send({ pii: 'api', reqId: 'a2', method: 'GET', path: '/auth/logout', region: 'us' });
  await p.send({ pii: 'api', reqId: 'a3', method: 'GET', path: '/v1/me', region: 'xx' });
  await p.send({ pii: 'api', reqId: 'a4', method: 'TRACE', path: '/v1/me', region: 'us' });
  assert.equal(calls.relay!.length, 1);
  stop();
});

test('country switch accepts only offered countries', async () => {
  const p = fakePage(); const { o, calls } = opts();
  const stop = mountEmbedded(p.host, o);
  await p.send({ pii: 'region', region: 'zz' });
  await p.send({ pii: 'region', region: 'us' });
  assert.deepEqual(calls.region, [['us']]);
  stop();
});

test('falls back when the frame never says ready, and not once it has', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const a = fakePage(); const one = opts();
  const stopA = mountEmbedded(a.host, one.o);
  t.mock.timers.tick(READY_TIMEOUT_MS + 1);
  assert.equal(one.calls.fail!.length, 1);
  stopA();
  const b = fakePage(); const two = opts();
  const stopB = mountEmbedded(b.host, two.o);
  await b.send({ pii: 'ready' });
  t.mock.timers.tick(READY_TIMEOUT_MS + 1);
  assert.equal(two.calls.fail!.length, 0);
  stopB();
});
