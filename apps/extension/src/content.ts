import * as InboxSDK from '@inboxsdk/core';
import { mountSidebar } from './sidebar';

// Gmail page side. Reads only what is on screen for the open conversation; nothing is sent anywhere until the person clicks Create.
InboxSDK.load(2, __INBOXSDK_APP_ID__).then((sdk) => {
  sdk.Conversations.registerThreadViewHandler((threadView) => {
    const subject = threadView.getSubject();
    const first = threadView.getMessageViews()[0];
    const c = first?.getSender();
    const el = document.createElement('div');
    mountSidebar(el, { subject, sender: c ? { email: c.emailAddress, name: c.name ?? '' } : null });
    threadView.addSidebarContentPanel({
      title: 'PII',
      iconUrl: chrome.runtime.getURL('icon-32.png'),
      el,
    });
  });
});
