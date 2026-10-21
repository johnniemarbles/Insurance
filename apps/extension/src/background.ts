// Service worker. Talks to the PII server on behalf of the Gmail page so the session cookie never reaches Gmail's page.
import '@inboxsdk/core/background.js';
import type { ApiRequest, ApiResponse, Message } from './messages';

const REGION_IDS = Object.keys(__REGIONS__);
const baseOf = (id: string) => __REGIONS__[id]!.replace(/\/+$/, '');
/** Which country a PII address belongs to (https://ca.… → ca), or null for any other site. */
const regionOfOrigin = (origin: string): string | null => REGION_IDS.find((id) => baseOf(id) === origin) ?? null;

// The server address: the country the page asked for (always sent from 1.7.0), else the one kept from before, else the build's
// default. A typed server address (Options) only counts in development builds.
async function apiBase(want?: string): Promise<string> {
  if (want && __REGIONS__[want]) return baseOf(want);
  const { apiBase, region } = await chrome.storage.sync.get(['apiBase', 'region']);
  if (__DEV_BUILD__ && typeof apiBase === 'string' && apiBase) return apiBase.replace(/\/+$/, '');
  const byRegion = typeof region === 'string' && __REGIONS__[region] ? baseOf(region) : undefined;
  return (byRegion || __API_BASE__).replace(/\/+$/, '');
}

async function callApi(m: ApiRequest): Promise<ApiResponse> {
  if (!m.path.startsWith('/v1/')) return { status: 400, json: { error: { message: 'bad path' } } };
  const base = await apiBase(m.region);
  const res = await fetch(base + m.path, {
    method: m.method,
    credentials: 'include',
    headers: m.body ? { 'content-type': 'application/json' } : {},
    body: m.body ? JSON.stringify(m.body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { error: { message: 'Unexpected server reply' } }; }
  return { status: res.status, json };
}

/** Who is signed in to one country's server in this browser (lower-case email), or null. */
async function whoIsSignedIn(id: string): Promise<string | null> {
  try {
    const r = await fetch(`${baseOf(id)}/v1/me`, { credentials: 'include' });
    if (!r.ok) return null;
    const j = (await r.json()) as { user?: { email?: unknown } };
    return typeof j.user?.email === 'string' ? j.user.email.toLowerCase() : null;
  } catch { return null; }
}

/** Keeps the country for one Gmail account and tells every Gmail tab, which redraws PII at once. */
async function remember(account: string, region: string): Promise<void> {
  const v = await chrome.storage.local.get('regionByAccount');
  const map = { ...((v.regionByAccount ?? {}) as Record<string, string>), [account]: region };
  await chrome.storage.local.set({ regionByAccount: map, signedInAt: Date.now() });
}

// Sign-in tabs this extension opened, by tab id (kept in session storage: the worker may sleep while the person is at Google).
type Pending = Record<string, { account?: string }>;
const pendingGet = async (): Promise<Pending> => ((await chrome.storage.session.get('pendingSignIns')).pendingSignIns ?? {}) as Pending;
const pendingSet = (p: Pending) => chrome.storage.session.set({ pendingSignIns: p });

// The country is saved only when the sign-in worked: the tab reaches a PII page with signed_in=1, on whichever country let the
// person in (the servers send a person to the other country when they have no account). The tab then closes, unless it is
// the welcome page of a new invitation, which the person reads.
chrome.tabs.onUpdated.addListener((tabId: number, info: { url?: string }) => {
  if (!info.url) return;
  let u: URL;
  try { u = new URL(info.url); } catch { return; }
  const region = regionOfOrigin(u.origin);
  if (!region || u.searchParams.get('signed_in') !== '1') return;
  void (async () => {
    const pending = await pendingGet();
    const p = pending[String(tabId)];
    if (!p) return;
    delete pending[String(tabId)];
    await pendingSet(pending);
    const who = (await whoIsSignedIn(region)) ?? p.account;
    if (who) await remember(who, region);
    else await chrome.storage.local.set({ signedInAt: Date.now() });
    if (u.searchParams.get('welcome') !== '1') { try { await chrome.tabs.remove(tabId); } catch { /* already closed */ } }
  })();
});
chrome.tabs.onRemoved.addListener((tabId: number) => {
  void pendingGet().then((p) => { if (p[String(tabId)]) { delete p[String(tabId)]; return pendingSet(p); } return undefined; });
});

// On install and on update: find the country each person is already signed in to (for example right after accepting an
// invitation), so a new partner never has to pick one, and a browser stuck on the wrong country is put right.
chrome.runtime.onInstalled.addListener(() => {
  void (async () => {
    const found: Record<string, string[]> = {};
    for (const id of REGION_IDS) {
      const who = await whoIsSignedIn(id);
      if (who) (found[who] ??= []).push(id);
    }
    const v = await chrome.storage.local.get('regionByAccount');
    const map = { ...((v.regionByAccount ?? {}) as Record<string, string>) };
    const { region: before } = await chrome.storage.sync.get('region');
    let changed = false;
    for (const [who, ids] of Object.entries(found)) {
      if (map[who] && ids.includes(map[who]!)) continue;
      map[who] = ids.length === 1 ? ids[0]! : (typeof before === 'string' && ids.includes(before) ? before : ids[0]!);
      changed = true;
    }
    if (changed) await chrome.storage.local.set({ regionByAccount: map, signedInAt: Date.now() });
  })();
});

chrome.runtime.onMessage.addListener((msg: Message, sender: { id?: string }, sendResponse: (r: unknown) => void) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'pii:api') {
    callApi(msg).then(sendResponse, () => sendResponse({ status: 0, json: { error: { message: 'Cannot reach the server' } } }));
    return true;
  }
  if (msg.type === 'pii:base') {
    apiBase(msg.region).then((base) => sendResponse({ base }), () => sendResponse({}));
    return true;
  }
  if (msg.type === 'pii:signin') {
    // Nothing is saved yet: the country is kept only once the sign-in has worked (see tabs.onUpdated above).
    // fresh: end the current PII session first (it belongs to a different Google account than the Gmail on screen).
    void apiBase(msg.region).then(async (b: string) => {
      if (msg.fresh) { try { await fetch(`${b}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { /* the sign-in below replaces the session anyway */ } }
      const q = msg.hint ? `?hint=${encodeURIComponent(msg.hint)}` : '';
      const tab = await chrome.tabs.create({ url: `${b}/auth/google/start${q}` });
      if (tab.id !== undefined) {
        const p = await pendingGet();
        p[String(tab.id)] = { account: msg.hint?.toLowerCase() };
        await pendingSet(p);
      }
    });
    return false;
  }
  return false;
});
