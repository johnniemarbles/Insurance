// Service worker. Talks to the PII server on behalf of the Gmail page so the session cookie never reaches Gmail's page.
import '@inboxsdk/core/background.js';
import type { ApiRequest, ApiResponse, Message } from './messages';

// The server address: an administrator's override first, then the country the person chose, then the build's default.
async function apiBase(): Promise<string> {
  const { apiBase, region } = await chrome.storage.sync.get(['apiBase', 'region']);
  const byRegion = typeof region === 'string' ? __REGIONS__[region] : undefined;
  return ((apiBase as string | undefined) || byRegion || __API_BASE__).replace(/\/+$/, '');
}

async function callApi(m: ApiRequest): Promise<ApiResponse> {
  if (!m.path.startsWith('/v1/')) return { status: 400, json: { error: { message: 'bad path' } } };
  const base = await apiBase();
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

chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  if (msg.type === 'pii:api') {
    callApi(msg).then(sendResponse, () => sendResponse({ status: 0, json: { error: { message: 'Cannot reach the server' } } }));
    return true;
  }
  if (msg.type === 'pii:signin') {
    const pick = msg.region && __REGIONS__[msg.region] ? chrome.storage.sync.set({ region: msg.region }) : Promise.resolve();
    pick.then(apiBase).then((b) => chrome.tabs.create({ url: `${b}/auth/google/start` }));
    return false;
  }
  return false;
});
