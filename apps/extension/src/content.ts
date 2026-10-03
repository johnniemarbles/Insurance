import * as InboxSDK from '@inboxsdk/core';
import { mountSidebar, type CapturedMessage } from './sidebar';
import { mountPii } from '../../web/src/mount';
import type { ComposeApi, Transport } from '../../web/src/types';

const transport: Transport = async (method, path, body) => {
  try {
    const r = (await chrome.runtime.sendMessage({ type: 'pii:api', method, path, body })) as { status: number; json: any } | undefined;
    return r ?? { status: -1, json: null };
  } catch {
    // The extension was reloaded or updated while this Gmail tab stayed open.
    return { status: -1, json: null };
  }
};


// Sending for mail merge: open a normal Gmail compose window, fill it in, press Send, and wait to hear how it went.
const sendOne = (sdk: InboxSDK.InboxSDK): ComposeApi['send'] => async ({ to, subject, html }) => {
  let cv: Awaited<ReturnType<typeof sdk.Compose.openNewComposeView>>;
  try { cv = await sdk.Compose.openNewComposeView(); } catch { return { ok: false, error: 'Could not open a Gmail compose window' }; }
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: { ok: boolean; threadId?: string; error?: string }) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    const timer = setTimeout(() => { finish({ ok: false, error: 'Gmail did not confirm the send in time' }); try { cv.close(); } catch { /* already closed */ } }, 90_000);
    cv.on('sent', (e) => { void e.getThreadID().then((threadId) => finish({ ok: true, threadId }), () => finish({ ok: true })); });
    cv.on('sendCanceled', () => finish({ ok: false, error: 'Gmail canceled the send' }));
    cv.on('destroy', () => setTimeout(() => finish({ ok: false, error: 'The compose window was closed before sending' }), 1500));
    try {
      cv.setToRecipients([to]);
      cv.setSubject(subject);
      cv.setBodyHTML(html);
      setTimeout(() => { try { cv.send(); } catch (e) { finish({ ok: false, error: (e as Error).message }); } }, 400);
    } catch (e) { finish({ ok: false, error: (e as Error).message }); }
  });
};

interface Snippet { id: string; name: string; body: string; shared: boolean }

// Gmail page side. Reads only what is on screen for the open conversation, and only sends it after the person accepts the notice.
console.info('[PII] content script running');
InboxSDK.load(2, __INBOXSDK_APP_ID__).then((sdk) => {
  console.info('[PII] InboxSDK loaded');
  // Full-page view: a PII item in Gmail's left menu opens the pipeline screen in place of the mailbox.
  sdk.Router.handleCustomRoute('pii/:page', (view) => {
    const host = document.createElement('div');
    host.style.cssText = 'height:calc(100vh - 130px);min-height:480px;background:#fff';
    view.getElement().appendChild(host);
    const unmount = mountPii(host, { transport, onSignIn: () => void chrome.runtime.sendMessage({ type: 'pii:signin' }), compose: { send: sendOne(sdk) } });
    view.on('destroy', unmount);
  });
  sdk.NavMenu.addNavItem({ name: 'PII', iconUrl: chrome.runtime.getURL('nav-icon.png'), routeID: 'pii/:page', routeParams: { page: 'pipelines' } });
  // Snippets: a button in every compose window that drops a saved reply in, filled in for the person being written to.
  sdk.Compose.registerComposeViewHandler((composeView) => {
    composeView.addButton({
      title: 'PII snippets',
      iconUrl: chrome.runtime.getURL('nav-icon.png'),
      hasDropdown: true,
      orderHint: 10,
      onClick: (ev) => {
        const dd = ev.dropdown; if (!dd) return;
        const box = dd.el;
        box.style.cssText = 'font:13px system-ui,sans-serif;padding:6px;min-width:240px;max-height:320px;overflow:auto;background:#fff;color:#1f2937';
        box.textContent = 'Loading…';
        void transport('GET', '/v1/snippets').then((r) => {
          box.textContent = '';
          const list = (r.json?.snippets ?? []) as Snippet[];
          if (r.status !== 200 || list.length === 0) { box.textContent = r.status === 401 ? 'Sign in to PII to use snippets.' : r.status === 200 ? 'No snippets yet. Add some in PII → More → Snippets.' : 'Could not load snippets.'; return; }
          for (const s of list) {
            const b = document.createElement('button');
            b.style.cssText = 'display:block;width:100%;text-align:left;border:0;background:none;padding:7px 8px;cursor:pointer;border-radius:4px;font:inherit';
            b.onmouseenter = () => { b.style.background = '#eef2ff'; }; b.onmouseleave = () => { b.style.background = 'none'; };
            b.textContent = s.name + (s.shared ? '  ·  team' : '');
            b.onclick = () => {
              const first = composeView.getToRecipients()[0];
              void transport('POST', `/v1/snippets/${s.id}/render`, { toName: first?.name ?? '', toEmail: first?.emailAddress ?? '' }).then((x) => {
                if (x.status === 200) composeView.insertHTMLIntoBodyAtCursor(x.json.html);
                dd.close();
              });
            };
            box.append(b);
          }
        });
      },
    });
  });
  sdk.Conversations.registerThreadViewHandler((threadView) => {
    console.info('[PII] conversation opened');
    const el = document.createElement('div');
    mountSidebar(el, {
      getSubject: () => threadView.getSubject(),
      getSender: () => {
        const c = threadView.getMessageViews()[0]?.getSender();
        return c ? { email: c.emailAddress, name: c.name ?? '' } : null;
      },
      getThreadId: () => threadView.getThreadIDAsync(),
      capture: async () => {
        const messages: CapturedMessage[] = [];
        let skipped = 0;
        for (const mv of threadView.getMessageViews()) {
          if (!mv.isLoaded()) { skipped++; continue; }
          const id = await mv.getMessageIDAsync();
          const sender = mv.getSender();
          const to = (await mv.getRecipientsFull()).map((r) => ({ email: r.emailAddress, name: r.name ?? undefined }));
          const t = Date.parse(mv.getDateString());
          messages.push({
            gmailMessageId: id,
            sentAt: Number.isNaN(t) ? undefined : new Date(t).toISOString(),
            from: sender ? `${sender.name ? sender.name + ' ' : ''}<${sender.emailAddress}>` : undefined,
            to,
            body: mv.getBodyElement().innerText.slice(0, 200000),
            attachments: mv.getFileAttachmentCardViews().map((a) => ({ name: a.getTitle().slice(0, 300) })),
          });
        }
        return { messages, skipped };
      },
    });
    threadView.addSidebarContentPanel({ title: 'PII', iconUrl: chrome.runtime.getURL('nav-icon.png'), el });
  });
}).catch((e) => console.error('[PII] InboxSDK failed to load', e));
