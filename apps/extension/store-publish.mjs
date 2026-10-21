// Builds the Chrome Web Store package and submits it for review through the Chrome Web Store API (v2), signed in as a service account.
//
//   node store-publish.mjs             build, upload, submit for review
//   node store-publish.mjs --dry-run   build and zip only (no network, no credentials needed)
//
// Environment (normally set by .github/workflows/extension-store.yml):
//   CWS_ACCESS_TOKEN         a Google access token with the Web Store scope. In GitHub Actions this comes from Workload Identity
//                            Federation (no key file: GitHub proves who it is to Google for each run).
//   CWS_SERVICE_ACCOUNT_KEY  or: a service account JSON key (only where key files are allowed; the PII Google Cloud org blocks them)
//   CWS_PUBLISHER_ID         the publisher ID from the Chrome Web Store developer dashboard
//   CWS_ITEM_ID              the store item ID (defaults to the PII listing)
//   CWS_PUBLISH_TYPE         DEFAULT_PUBLISH (live as soon as approved, the default) or STAGED_PUBLISH (wait for a manual "Publish")
//
// Store review still applies to every version. This script only removes the manual upload.
// The store package has no "key" in its manifest: the store assigns the listing's own ID. (The install-page zip from pack.mjs adds one.)
import { execFileSync } from 'node:child_process';
import { createHash, createSign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, makeZip } from './zip.mjs';

export const DEFAULT_ITEM_ID = 'bbfccaiemeckdhajpejacckieamdbajm';
export const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
const API = 'https://chromewebstore.googleapis.com';

/** Compares dotted Chrome versions ("1.5.0" vs "1.4.10"): negative, zero or positive. */
export function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The highest version the store already has (published or waiting in review), from a fetchStatus reply. */
export function storeVersion(status) {
  const versions = [status?.publishedItemRevisionStatus, status?.submittedItemRevisionStatus]
    .flatMap((r) => r?.distributionChannels ?? [])
    .map((c) => c?.crxVersion)
    .filter((v) => typeof v === 'string' && v.length > 0);
  return versions.reduce((hi, v) => (hi === null || compareVersions(v, hi) > 0 ? v : hi), null);
}

/** A version already submitted and still waiting for Google's review (not yet published), from a fetchStatus reply. */
export function inReview(status) {
  const pick = (r) => (r?.distributionChannels ?? []).map((c) => c?.crxVersion).find((v) => typeof v === 'string' && v.length > 0) ?? null;
  const sub = pick(status?.submittedItemRevisionStatus), pub = pick(status?.publishedItemRevisionStatus);
  const state = String(status?.submittedItemRevisionStatus?.state ?? '');
  if (state && !/PENDING|REVIEW/i.test(state)) return null; // rejected or cancelled: a new version may be sent
  return sub && (!pub || compareVersions(sub, pub) > 0) ? sub : null;
}

/** A signed service-account assertion (RS256 JWT) for Google's token endpoint. */
export function serviceAccountAssertion(key, nowSeconds = Math.floor(Date.now() / 1000)) {
  if (!key?.client_email || !key?.private_key) throw new Error('CWS_SERVICE_ACCOUNT_KEY is not a service account JSON key (needs client_email and private_key)');
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: key.client_email, scope: SCOPE, aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat: nowSeconds, exp: nowSeconds + 3600 })}`;
  const sig = createSign('RSA-SHA256').update(body).sign(key.private_key).toString('base64url');
  return `${body}.${sig}`;
}

async function accessToken(key) {
  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(key) }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`Google sign-in for the service account failed (${res.status}): ${j.error_description ?? j.error ?? 'no token'}`);
  return j.access_token;
}

async function call(token, method, url, body, contentType = 'application/json') {
  const res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': contentType } : {}) }, body });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`${method} ${url.replace(API, '')} failed (${res.status}): ${JSON.stringify(json?.error ?? json).slice(0, 800)}`);
  return json;
}

const inProgress = (s) => s === 'IN_PROGRESS' || s === 'UPLOAD_IN_PROGRESS';

/** Builds dist/ and zips it for the store. Returns the version, zip path and hash. */
export function buildStorePackage(root = fileURLToPath(new URL('.', import.meta.url))) {
  execFileSync(process.execPath, ['build.mjs'], { cwd: root, stdio: 'inherit' });
  const dist = join(root, 'dist');
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  if ('key' in manifest) throw new Error('The store package must not carry a manifest "key"');
  const zip = makeZip(listFiles(dist).sort().map((p) => ({ name: relative(dist, p).split('\\').join('/'), data: readFileSync(p) })));
  const outDir = join(root, 'store');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, `pii-extension-store-${manifest.version}.zip`);
  writeFileSync(file, zip);
  return { version: manifest.version, file, zip, sha256: createHash('sha256').update(zip).digest('hex') };
}

/** The whole run. Exported for tests (fetch is the global one, so tests can stand in for the store). */
export async function main(argv = process.argv, env = process.env, wait = (ms) => new Promise((r) => setTimeout(r, ms))) {
  const dryRun = argv.includes('--dry-run');
  const pkg = buildStorePackage();
  console.log(`Store package ${pkg.version}: ${pkg.zip.length} bytes, SHA-256 ${pkg.sha256}`);
  if (dryRun) { console.log('Dry run: nothing uploaded.'); return { dryRun: true, version: pkg.version }; }

  const rawKey = env.CWS_SERVICE_ACCOUNT_KEY;
  const publisher = env.CWS_PUBLISHER_ID;
  const item = env.CWS_ITEM_ID || DEFAULT_ITEM_ID;
  const publishType = env.CWS_PUBLISH_TYPE || 'DEFAULT_PUBLISH';
  const given = env.CWS_ACCESS_TOKEN;
  if ((!given && !rawKey) || !publisher) throw new Error('CWS_PUBLISHER_ID and a Google sign-in (CWS_ACCESS_TOKEN, or CWS_SERVICE_ACCOUNT_KEY) are required');
  if (!['DEFAULT_PUBLISH', 'STAGED_PUBLISH'].includes(publishType)) throw new Error('CWS_PUBLISH_TYPE must be DEFAULT_PUBLISH or STAGED_PUBLISH');
  let token = given;
  if (!token) {
    let key;
    try { key = JSON.parse(rawKey); } catch { throw new Error('CWS_SERVICE_ACCOUNT_KEY is not valid JSON'); }
    token = await accessToken(key);
  }
  const name = `publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(item)}`;

  // Never re-send a version the store already has (published, or waiting in review).
  const before = await call(token, 'GET', `${API}/v2/${name}:fetchStatus`);
  if (before?.takenDown) throw new Error('The store item is taken down; fix it in the developer dashboard first');
  const have = storeVersion(before);
  if (have && compareVersions(pkg.version, have) <= 0) {
    console.log(`The store already has ${have}; ${pkg.version} is not newer. Bump "version" in public/manifest.json to publish. Nothing sent.`);
    return { skipped: true, have, version: pkg.version };
  }

  // The store takes no new package while another version is in review: wait for that review, then run this again.
  const waiting = inReview(before);
  if (waiting) {
    const msg = `The store is still reviewing ${waiting}, so ${pkg.version} was not sent. Once Google approves ${waiting}, run this workflow again (Actions, extension-store, Run workflow).`;
    console.log(`::warning title=Chrome Web Store::${msg}`);
    if (env.GITHUB_STEP_SUMMARY) writeFileSync(env.GITHUB_STEP_SUMMARY, `### PII extension ${pkg.version} not sent yet\n\n${msg}\n`, { flag: 'a' });
    return { waiting, version: pkg.version };
  }

  console.log(`Uploading ${pkg.version} (store has ${have ?? 'nothing yet'})…`);
  const up = await call(token, 'POST', `${API}/upload/v2/${name}:upload`, pkg.zip, 'application/zip');
  let state = up?.uploadState;
  for (let i = 0; inProgress(state) && i < 60; i++) {
    await wait(5000);
    state = (await call(token, 'GET', `${API}/v2/${name}:fetchStatus`))?.lastAsyncUploadState;
  }
  if (state !== 'SUCCEEDED') throw new Error(`Upload did not succeed (state ${state ?? 'unknown'}): ${JSON.stringify(up).slice(0, 800)}`);
  console.log(`Uploaded ${up?.crxVersion ?? pkg.version}.`);

  const pub = await call(token, 'POST', `${API}/v2/${name}:publish`, JSON.stringify({ publishType }));
  for (const w of pub?.warningInfo?.warnings ?? []) console.warn(`Store warning ${w.reason}: ${w.description}`);
  console.log(`Submitted ${pkg.version} for review (${publishType}). Store state: ${pub?.state ?? 'unknown'}.`);
  if (env.GITHUB_STEP_SUMMARY) {
    writeFileSync(env.GITHUB_STEP_SUMMARY, `### PII extension ${pkg.version} submitted to the Chrome Web Store\n\n- Previous store version: ${have ?? 'none'}\n- Publish type: ${publishType}\n- Store state: ${pub?.state ?? 'unknown'}\n- Package SHA-256: \`${pkg.sha256}\`\n\nIt goes live after Google's review${publishType === 'STAGED_PUBLISH' ? ' and a manual Publish in the dashboard' : ''}.\n`, { flag: 'a' });
  }
  return { submitted: true, version: pkg.version, state: pub?.state };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  // ::error makes the reason show on the run's page, not only in the full log.
  main().catch((e) => { console.error(`::error title=Chrome Web Store::${String(e.message).replace(/\r?\n/g, ' ')}`); process.exit(1); });
}
