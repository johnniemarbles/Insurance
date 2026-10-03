// Service worker. Talks to the PII server on behalf of the Gmail page so the session cookie never reaches Gmail's page.
import '@inboxsdk/core/background.js';
import type { ApiRequest, ApiResponse, Message } from './messages';

async function apiBase(): Promise<string> {
  const { apiBase } = await chrome.storage.sync.get('apiBase');
  return ((apiBase as string | undefined) || __API_BASE__).replace(/\/+$/, '');
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
    apiBase().then((b) => chrome.tabs.create({ url: `${b}/auth/google/start` }));
    return false;
  }
  return false;
});
