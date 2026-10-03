import * as InboxSDK from '@inboxsdk/core';
import { mountSidebar, type CapturedMessage } from './sidebar';
import { mountPii } from '../../web/src/mount';
import type { Transport } from '../../web/src/types';

const transport: Transport = async (method, path, body) => {
  const r = (await chrome.runtime.sendMessage({ type: 'pii:api', method, path, body }).catch(() => undefined)) as { status: number; json: any } | undefined;
  return r ?? { status: 0, json: null };
};

// Gmail page side. Reads only what is on screen for the open conversation, and only sends it after the person accepts the notice.
console.info('[PII] content script running');
InboxSDK.load(2, __INBOXSDK_APP_ID__).then((sdk) => {
  console.info('[PII] InboxSDK loaded');
  // Full-page view: a PII item in Gmail's left menu opens the pipeline screen in place of the mailbox.
  sdk.Router.handleCustomRoute('pii/:page', (view) => {
    const host = document.createElement('div');
    host.style.cssText = 'height:calc(100vh - 130px);min-height:480px;background:#fff';
    view.getElement().appendChild(host);
    const unmount = mountPii(host, { transport, onSignIn: () => void chrome.runtime.sendMessage({ type: 'pii:signin' }) });
    view.on('destroy', unmount);
  });
  sdk.NavMenu.addNavItem({ name: 'PII', iconUrl: chrome.runtime.getURL('icon-32.png'), routeID: 'pii/:page', routeParams: { page: 'pipelines' } });
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
    threadView.addSidebarContentPanel({ title: 'PII', iconUrl: chrome.runtime.getURL('icon-32.png'), el });
  });
}).catch((e) => console.error('[PII] InboxSDK failed to load', e));
