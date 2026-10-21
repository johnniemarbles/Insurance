// The pieces of store publishing that can be checked without the Chrome Web Store: versions and the service-account sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync } from 'node:crypto';
// @ts-ignore: plain ES module next to the build scripts
import { compareVersions, storeVersion, inReview, serviceAccountAssertion, SCOPE, main, DEFAULT_ITEM_ID } from '../store-publish.mjs';
import { readFileSync } from 'node:fs';

const LOCAL_VERSION: string = JSON.parse(readFileSync(new URL('../public/manifest.json', import.meta.url), 'utf8')).version;
const { privateKey: testKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ENV = {
  CWS_SERVICE_ACCOUNT_KEY: JSON.stringify({ client_email: 'ci@p.iam.gserviceaccount.com', private_key: testKey.export({ type: 'pkcs8', format: 'pem' }) }),
  CWS_PUBLISHER_ID: 'pub-1',
};

/** Stands in for Google: records each request and answers from the script. */
function fakeStore(answers: Record<string, (body: unknown) => unknown>) {
  const calls: { method: string; path: string; body?: unknown; type?: string }[] = [];
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: string, init: any) => {
    const u = new URL(url);
    const key = `${init.method} ${u.host === 'oauth2.googleapis.com' ? 'token' : u.pathname.replace(`/publishers/pub-1/items/${DEFAULT_ITEM_ID}`, '/ITEM')}`;
    calls.push({ method: init.method, path: key, body: init.body, type: init.headers?.['content-type'] });
    const f = answers[key];
    if (!f) return new Response(JSON.stringify({ error: { message: `unexpected ${key}` } }), { status: 500 });
    const out = f(init.body);
    return new Response(JSON.stringify(out), { status: (out as any)?.__status ?? 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
const quiet = async <T>(f: () => Promise<T>) => { const l = console.log, w = console.warn; console.log = () => undefined; console.warn = () => undefined; try { return await f(); } finally { console.log = l; console.warn = w; } };
const bumped = (v: string) => v.split('.').map((n, i, a) => (i === a.length - 1 ? String(Number(n) + 1) : n)).join('.');

test('does not upload when the store already has this version (published or in review)', async () => {
  const s = fakeStore({
    'POST token': () => ({ access_token: 'at' }),
    'GET /v2/ITEM:fetchStatus': () => ({ submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: LOCAL_VERSION }] } }),
  });
  try {
    const r = await quiet(() => main(['node', 'x'], ENV, async () => undefined));
    assert.deepEqual(r, { skipped: true, have: LOCAL_VERSION, version: LOCAL_VERSION });
    assert.ok(!s.calls.some((c) => c.path.includes(':upload')));
  } finally { s.restore(); }
});

test('uploads, waits for an in-progress upload, then submits for review', async () => {
  let polls = 0;
  const s = fakeStore({
    'POST token': (b) => { assert.match(String(b), /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/); return { access_token: 'at' }; },
    'GET /v2/ITEM:fetchStatus': () => (polls++ === 0
      ? { publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.0.0' }] } }
      : { lastAsyncUploadState: polls < 3 ? 'IN_PROGRESS' : 'SUCCEEDED' }),
    'POST /upload/v2/ITEM:upload': () => ({ uploadState: 'IN_PROGRESS' }),
    'POST /v2/ITEM:publish': (b) => { assert.deepEqual(JSON.parse(String(b)), { publishType: 'STAGED_PUBLISH' }); return { state: 'PENDING_REVIEW' }; },
  });
  try {
    const r = await quiet(() => main(['node', 'x'], { ...ENV, CWS_PUBLISH_TYPE: 'STAGED_PUBLISH' }, async () => undefined));
    assert.deepEqual(r, { submitted: true, version: LOCAL_VERSION, state: 'PENDING_REVIEW' });
    const up = s.calls.find((c) => c.path === 'POST /upload/v2/ITEM:upload')!;
    assert.equal(up.type, 'application/zip');
    assert.equal(Buffer.from(up.body as Uint8Array).subarray(0, 4).toString('hex'), '504b0304'); // a zip
    assert.deepEqual(s.calls.map((c) => c.path), ['POST token', 'GET /v2/ITEM:fetchStatus', 'POST /upload/v2/ITEM:upload', 'GET /v2/ITEM:fetchStatus', 'GET /v2/ITEM:fetchStatus', 'POST /v2/ITEM:publish']);
  } finally { s.restore(); }
});

test('a failed upload stops before publishing', async () => {
  const s = fakeStore({
    'POST token': () => ({ access_token: 'at' }),
    'GET /v2/ITEM:fetchStatus': () => ({}),
    'POST /upload/v2/ITEM:upload': () => ({ uploadState: 'FAILED' }),
  });
  try {
    await assert.rejects(quiet(() => main(['node', 'x'], ENV, async () => undefined)), /Upload did not succeed \(state FAILED\)/);
    assert.ok(!s.calls.some((c) => c.path.endsWith(':publish')));
  } finally { s.restore(); }
});

test('refuses to run without credentials, and accepts a newer version string', async () => {
  await assert.rejects(quiet(() => main(['node', 'x'], {}, async () => undefined)), /CWS_PUBLISHER_ID and a Google sign-in/);
  assert.ok(compareVersions(bumped(LOCAL_VERSION), LOCAL_VERSION) > 0);
});

test('compares dotted versions numerically', () => {
  assert.ok(compareVersions('1.5.0', '1.4.10') > 0);
  assert.ok(compareVersions('1.4.10', '1.4.9') > 0);
  assert.equal(compareVersions('1.5', '1.5.0'), 0);
  assert.ok(compareVersions('1.4.4', '1.5.0') < 0);
});

test('store version is the highest of published and in-review', () => {
  assert.equal(storeVersion({}), null);
  assert.equal(storeVersion({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.4.4', deployPercentage: 100 }] } }), '1.4.4');
  assert.equal(storeVersion({
    publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.4.4' }] },
    submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.5.0' }] },
  }), '1.5.0');
});

test('service-account assertion is a valid RS256 JWT for the Web Store scope', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const key = { client_email: 'pii-publisher@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
  const jwt = serviceAccountAssertion(key, 1_000_000);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(JSON.parse(Buffer.from(p!, 'base64url').toString()), { iss: key.client_email, scope: SCOPE, aud: key.token_uri, iat: 1_000_000, exp: 1_003_600 });
  assert.ok(createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(s!, 'base64url')));
  assert.throws(() => serviceAccountAssertion({ client_email: 'x' }), /service account JSON key/);
});

test('uses a ready-made access token (Workload Identity Federation) without signing in again', async () => {
  const s = fakeStore({ 'GET /v2/ITEM:fetchStatus': () => ({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: LOCAL_VERSION }] } }) });
  try {
    const r = await quiet(() => main(['node', 'x'], { CWS_ACCESS_TOKEN: 'wif-token', CWS_PUBLISHER_ID: 'pub-1' }, async () => undefined));
    assert.equal((r as any).skipped, true);
    assert.ok(!s.calls.some((c) => c.path === 'POST token'));
  } finally { s.restore(); }
});

test('while an older version is still in review, nothing is uploaded and the run says to try again after approval', async () => {
  const older = '1.0.0';
  const s = fakeStore({
    'POST token': () => ({ access_token: 'at' }),
    'GET /v2/ITEM:fetchStatus': () => ({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '0.9.0' }] }, submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: older }] } }),
  });
  const said: string[] = [];
  const l = console.log; console.log = (m: string) => { said.push(m); };
  try {
    const r = await main(['node', 'x'], ENV, async () => undefined);
    assert.deepEqual(r, { waiting: older, version: LOCAL_VERSION });
    assert.deepEqual(s.calls.map((c) => c.path), ['POST token', 'GET /v2/ITEM:fetchStatus']); // no upload, no publish
    assert.match(said.join('\n'), new RegExp(`::warning title=Chrome Web Store::The store is still reviewing ${older.replace(/\./g, '\\.')}, so ${LOCAL_VERSION.replace(/\./g, '\\.')} was not sent`));
  } finally { console.log = l; s.restore(); }
});

test('in review means submitted and newer than what is published', () => {
  assert.equal(inReview({}), null);
  assert.equal(inReview({ submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.7.0' }] } }), '1.7.0');
  assert.equal(inReview({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.7.0' }] }, submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.7.0' }] } }), null);
  assert.equal(inReview({ publishedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.6.0' }] }, submittedItemRevisionStatus: { distributionChannels: [{ crxVersion: '1.7.0' }] } }), '1.7.0');
  assert.equal(inReview({ submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '1.7.0' }] } }), '1.7.0');
  assert.equal(inReview({ submittedItemRevisionStatus: { state: 'REJECTED', distributionChannels: [{ crxVersion: '1.7.0' }] } }), null);
});
