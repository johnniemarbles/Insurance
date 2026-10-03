import * as InboxSDK from '@inboxsdk/core';
import { mountSidebar, type CapturedMessage } from './sidebar';

// Gmail page side. Reads only what is on screen for the open conversation, and only sends it after the person accepts the notice.
InboxSDK.load(2, __INBOXSDK_APP_ID__).then((sdk) => {
  sdk.Conversations.registerThreadViewHandler((threadView) => {
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
});
