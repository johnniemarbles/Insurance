// Test harness only: mounts the extension's conversation side panel on a plain page, with chrome.runtime answered by
// fetch to the local server (the browser context adds the dev sign-in header). Not shipped in the extension.
import { mountSidebar } from '../../../../apps/extension/src/sidebar';

(globalThis as any).chrome = {
  runtime: {
    id: 'harness',
    sendMessage: async (m: { type: string; method: string; path: string; body?: unknown }) => {
      if (m.type !== 'pii:api') return undefined;
      const r = await fetch(m.path, { method: m.method, headers: m.body ? { 'content-type': 'application/json' } : {}, body: m.body ? JSON.stringify(m.body) : undefined });
      const text = await r.text();
      return { status: r.status, json: text ? JSON.parse(text) : null };
    },
  },
};
const params = new URLSearchParams(location.hash.slice(1));
const host = document.createElement('div');
host.id = 'panel';
host.style.cssText = 'width:340px;border:1px solid #ddd;margin:12px';
document.body.append(host);
mountSidebar(host, {
  getSubject: () => 'Annual review',
  getSender: () => ({ email: params.get('from') ?? '', name: '' }),
  getThreadId: async () => 'harness-thread',
  getRecipients: async () => (params.get('to') ?? '').split(',').filter(Boolean),
  capture: async () => ({ messages: [], skipped: 0 }),
});
