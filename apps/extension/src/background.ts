// Service worker. Talks to the PII server on behalf of the Gmail page so the session cookie never reaches Gmail's page.
import '@inboxsdk/core/background.js';
import type { ApiRequest, ApiResponse, Message } from './messages';

// The server address: an administrator's override first, then the country the person chose, then the build's default.
async function apiBase(want?: string): Promise<string> {
  const { apiBase, region } = await chrome.storage.sync.get(['apiBase', 'region']);
  // A named country (the Countries view) goes to that country's server whatever the person last signed in to.
  if (want && __REGIONS__[want]) return __REGIONS__[want].replace(/\/+$/, '');
  const byRegion = typeof region === 'string' ? __REGIONS__[region] : undefined;
  return ((apiBase as string | undefined) || byRegion || __API_BASE__).replace(/\/+$/, '');
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
    // keep: sign in to that country without making it the one the rest of the app uses.
    const pick = msg.region && __REGIONS__[msg.region] && !msg.keep ? chrome.storage.sync.set({ region: msg.region }) : Promise.resolve();
    // fresh: end the current PII session first (it belongs to a different Google account than the Gmail on screen).
    pick.then(() => apiBase(msg.region)).then(async (b: string) => {
      if (msg.fresh) { try { await fetch(`${b}/auth/logout`, { method: 'POST', credentials: 'include' }); } catch { /* the sign-in below replaces the session anyway */ } }
      const q = msg.hint ? `?hint=${encodeURIComponent(msg.hint)}` : '';
      await chrome.tabs.create({ url: `${b}/auth/google/start${q}` });
    });
    return false;
  }
  return false;
});
