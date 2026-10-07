import * as InboxSDK from '@inboxsdk/core';
import { mountSidebar, type CapturedMessage } from './sidebar';
import { mountPii, mountHeader } from '../../web/src/mount';
import { mountEmbedded } from './embed';
import type { ComposeApi, Transport } from '../../web/src/types';

const REGION_LABELS: Record<string, string> = { ca: 'Canada', us: 'United States' };
const REGION_CHOICES = Object.keys(__REGIONS__).map((id) => ({ id, label: REGION_LABELS[id] ?? id }));
let chosenRegion: string | undefined;
// The country changed (here or in another Gmail tab): every PII screen on this page starts over in place, no Gmail reload.
const announceRegion = () => { try { window.dispatchEvent(new CustomEvent('pii-region-changed')); window.dispatchEvent(new CustomEvent('pii-settings-changed')); } catch { /* ignore */ } };
chrome.storage.onChanged.addListener((ch, area) => {
  if (area !== 'sync' || !ch.region) return;
  const next = typeof ch.region.newValue === 'string' ? ch.region.newValue : Object.keys(__REGIONS__)[0];
  if (next !== chosenRegion) { chosenRegion = next; announceRegion(); }
});
// Test switch (options page): show the screens from the server in a frame instead of the copy built into this extension.
let embedUi = false;
chrome.storage.sync.get('embedUi').then((v) => { embedUi = v.embedUi === true; }, () => undefined);
chrome.storage.sync.get('region').then((v) => { chosenRegion = typeof v.region === 'string' ? v.region : Object.keys(__REGIONS__)[0]; }, () => undefined);

const rawTransport: Transport = async (method, path, body, region) => {
  try {
    const r = (await chrome.runtime.sendMessage({ type: 'pii:api', method, path, body, region })) as { status: number; json: any } | undefined;
    return r ?? { status: -1, json: null };
  } catch {
    // The extension was reloaded or updated while this Gmail tab stayed open.
    return { status: -1, json: null };
  }
};

// The PII sign-in belongs to the browser, not to one Gmail tab. With several Google accounts open, the Gmail on screen
// can be a different person from the one signed in to PII. Until the two match, nothing is shown or sent.
let gmailAccount = '';
const wrong = (pii: string) => ({ status: 409, json: { error: { code: 'wrong_account', message: `This Gmail is ${gmailAccount}, but PII is signed in as ${pii}.` }, piiEmail: pii, gmailEmail: gmailAccount } });
const whoCache = new Map<string, { at: number; email: Promise<string | null> }>();
const piiEmailFor = (region?: string): Promise<string | null> => {
  const key = region ?? '';
  const hit = whoCache.get(key);
  if (hit && Date.now() - hit.at < 15_000) return hit.email;
  const email = rawTransport('GET', '/v1/me', undefined, region).then((r) => (r.status === 200 && typeof r.json?.user?.email === 'string' ? (r.json.user.email as string).toLowerCase() : null));
  whoCache.set(key, { at: Date.now(), email });
  return email;
};
const transport: Transport = async (method, path, body, region) => {
  if (!gmailAccount || !path.startsWith('/v1/')) return rawTransport(method, path, body, region);
  const who = await piiEmailFor(region);
  if (who && who !== gmailAccount) return wrong(who);
  return rawTransport(method, path, body, region);
};
const signIn = (region?: string, keep?: boolean, opts?: { fresh?: boolean }) => { whoCache.clear(); void chrome.runtime.sendMessage({ type: 'pii:signin', region, keep, hint: gmailAccount || undefined, fresh: opts?.fresh }); };


// Sending for mail merge: open a normal Gmail compose window, fill it in, press Send, and wait to hear how it went.
const sendOne = (sdk: InboxSDK.InboxSDK): ComposeApi['send'] => async ({ to, subject, html, review }) => {
  let cv: Awaited<ReturnType<typeof sdk.Compose.openNewComposeView>>;
  try { cv = await sdk.Compose.openNewComposeView(); } catch { return { ok: false, error: 'Could not open a Gmail compose window' }; }
  return new Promise((resolve) => {
    type R = { ok: boolean; threadId?: string; error?: string; unconfirmed?: boolean };
    let done = false, clicked = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: R) => { if (done) return; done = true; clearTimeout(timer); resolve(r); };
    // One timer at a time. Before Gmail accepts the click a stall is a failure; after it, Gmail has the message,
    // and when it never announces "sent" (undo-send delay, a slow page) the message is reported as handed over, not lost.
    const arm = (ms: number, r: R, closeWindow = false) => { clearTimeout(timer); timer = setTimeout(() => { finish(r); if (closeWindow) { try { cv.close(); } catch { /* already closed */ } } }, ms); };
    // Review mode leaves the window open for the person to read and press Send; they get ten minutes.
    if (review) arm(10 * 60_000, { ok: false, error: 'The email was not sent from the Gmail window' });
    else arm(30_000, { ok: false, error: 'Gmail did not start sending. Close any open drafts and try again.' }, true);
    cv.on('presending', () => { clicked = true; });
    cv.on('sending', () => { clicked = true; arm(45_000, { ok: true, unconfirmed: true }); });
    cv.on('sent', (e) => { void e.getThreadID().then((threadId) => finish({ ok: true, threadId }), () => finish({ ok: true })); });
    cv.on('sendCanceled', () => finish({ ok: false, error: 'Gmail canceled the send' }));
    cv.on('destroy', () => {
      if (clicked) arm(45_000, { ok: true, unconfirmed: true }); // the window closes as Gmail takes the message
      else setTimeout(() => finish({ ok: false, error: 'The compose window was closed before sending' }), 1500);
    });
    try {
      cv.setToRecipients([to]);
      cv.setSubject(subject);
      cv.setBodyHTML(html);
      if (!review) setTimeout(() => { try { clicked = true; cv.send(); } catch (e) { clicked = false; finish({ ok: false, error: (e as Error).message }); } }, 600);
    } catch (e) { finish({ ok: false, error: (e as Error).message }); }
  });
};

interface Snippet { id: string; name: string; body: string; shared: boolean }

// Gmail page side. Reads only what is on screen for the open conversation, and only sends it after the person accepts the notice.
console.info('[PII] content script running');
InboxSDK.load(2, __INBOXSDK_APP_ID__).then((sdk) => {
  console.info('[PII] InboxSDK loaded');
  try { gmailAccount = (sdk.User.getEmailAddress() || '').trim().toLowerCase(); } catch { gmailAccount = ''; }
  // Full-page views: every item in the PII section of Gmail's left panel opens a page in place of the mailbox.
  const goto = (page: string, id?: string) => {
    if (id) sdk.Router.goto('pii/:page/:id', { page, id });
    else sdk.Router.goto('pii/:page', { page });
  };
  const mountRoute = (view: { getElement(): HTMLElement; getParams(): Record<string, string>; on(ev: 'destroy', fn: () => void): unknown }) => {
    const params = view.getParams();
    const host = document.createElement('div');
    host.style.cssText = 'height:calc(100vh - 130px);min-height:480px;background:#fff';
    view.getElement().appendChild(host);
    const regionBase = () => (__REGIONS__[chosenRegion ?? ''] ?? __API_BASE__).replace(/\/+$/, '');
    const unmount = embedUi ? mountEmbedded(host, {
      base: regionBase(), extVersion: chrome.runtime.getManifest().version, route: { page: params.page ?? 'pipelines', id: params.id },
      getToken: () => transport('POST', '/v1/embed-token'), onSignIn: signIn, navigate: goto,
    }) : mountPii(host, {
      extVersion: chrome.runtime.getManifest().version, transport, onSignIn: signIn, regions: REGION_CHOICES, get region() { return chosenRegion; }, switchRegion: (id: string) => { chosenRegion = id; void chrome.storage.sync.set({ region: id }); announceRegion(); }, compose: { send: sendOne(sdk) },
      route: { page: params.page ?? 'pipelines', id: params.id }, navigate: goto,
    });
    view.on('destroy', unmount);
  };
  sdk.Router.handleCustomRoute('pii/:page', mountRoute);
  sdk.Router.handleCustomRoute('pii/:page/:id', mountRoute);

  // The PII mark and the bell in Gmail's top bar, next to the account area. If Gmail's layout changes and the spot is not found, they float top right instead.
  const hostEl = document.createElement('div');
  hostEl.id = 'pii-header';
  mountHeader(hostEl, { extVersion: chrome.runtime.getManifest().version, transport, onSignIn: signIn, regions: REGION_CHOICES, get region() { return chosenRegion; }, switchRegion: (id: string) => { chosenRegion = id; void chrome.storage.sync.set({ region: id }); announceRegion(); }, navigate: goto }, chrome.runtime.getURL('nav-icon.png'));
  const place = () => {
    const acct = document.querySelector('header[role="banner"] a[aria-label*="Google Account"], header[role="banner"] [aria-label*="Google Account"]');
    let anchor: HTMLElement | null = acct as HTMLElement | null;
    while (anchor && anchor.parentElement && anchor.parentElement.tagName !== 'HEADER' && anchor.parentElement.children.length < 3) anchor = anchor.parentElement;
    const parent = anchor?.parentElement;
    if (anchor && parent && parent.tagName !== 'BODY') {
      hostEl.style.cssText = 'display:inline-flex;align-items:center;margin-right:4px';
      if (hostEl.parentElement !== parent || hostEl.nextElementSibling !== anchor) parent.insertBefore(hostEl, anchor);
    } else if (hostEl.parentElement !== document.body) {
      hostEl.style.cssText = 'position:fixed;top:10px;right:210px;z-index:1000;background:#fff;border-radius:22px;box-shadow:0 1px 4px rgba(10,31,92,.25)';
      document.body.appendChild(hostEl);
    }
  };
  place();
  let placeTimer: ReturnType<typeof setTimeout> | undefined;
  new MutationObserver(() => { if (placeTimer) return; placeTimer = setTimeout(() => { placeTimer = undefined; if (!hostEl.isConnected || hostEl.style.position === 'fixed') place(); }, 500); }).observe(document.body, { childList: true, subtree: true });

  // The left panel is drawn from the person's own layout (Settings > Left panel), limited to what they can use, with live counts.
  interface NavData { items: { id: string; name: string; count: number }[]; pipelines: { id: string; name: string; count: number; views?: { id: string; name: string }[] }[] }
  let section: { remove(): void } | null = null;
  let navSig = '';
  const icon = chrome.runtime.getURL('nav-icon.png');
  const withCount = (name: string, n: number) => (n > 0 ? `${name} (${n})` : name);
  const drawNav = async () => {
    const r = await transport('GET', '/v1/nav');
    const sig = JSON.stringify(r.status === 200 ? r.json : r.status);
    if (sig === navSig && section) return;
    navSig = sig;
    section?.remove();
    // A normal link item (the kind that worked before) with the pages nested under it, each with a Google Material icon.
    const top = sdk.NavMenu.addNavItem({ name: 'PII', iconUrl: icon, routeID: 'pii/:page', routeParams: { page: 'home' }, orderHint: 5 });
    section = top;
    const fallback: NavData = { items: [['home', 'Home'], ['notifications', 'Notifications'], ['pipelines', 'Pipelines'], ['contacts', 'Contacts'], ['settings', 'Settings']].map(([id, name]) => ({ id, name, count: 0 })), pipelines: [] };
    const nav = r.status === 200 && Array.isArray(r.json?.items) ? (r.json as NavData) : fallback;
    const svg = (n: string) => chrome.runtime.getURL(`icons/${n}.svg`);
    // Each item is added on its own, so one that fails never takes the rest of the menu with it. Two levels only (page > pipeline).
    nav.items.filter((it) => it.id !== 'notifications').forEach((it, i) => { // notifications live in the bell in Gmail's top bar
      try {
        const child = top.addNavItem({ name: withCount(it.name, it.count), iconUrl: svg(it.id), routeID: 'pii/:page', routeParams: { page: it.id }, orderHint: i });
        if (it.id === 'pipelines') {
          (nav.pipelines ?? []).forEach((p, j) => {
            try { child.addNavItem({ name: p.count > 0 ? `${p.name}  ⚠ ${p.count}` : p.name, iconUrl: svg('view'), routeID: 'pii/:page/:id', routeParams: { page: 'pipelines', id: p.id }, orderHint: j }); } catch (e) { console.warn('[PII] pipeline item failed', e); }
          });
        }
      } catch (e) { console.warn('[PII] nav item failed', it.id, e); }
    });
  };
  const redraw = () => { void drawNav().catch((e) => console.warn('[PII] left panel failed', e)); };
  redraw();
  setInterval(redraw, 5 * 60_000);
  let redrawTimer: ReturnType<typeof setTimeout> | undefined;
  window.addEventListener('pii-settings-changed', () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(redraw, 400); });

  // Whether the Snippets button shows is a setting; read it at most once a minute.
  let snippetsOn = true;
  let snippetsAt = 0;
  const snippetsEnabled = async () => {
    if (Date.now() - snippetsAt > 60_000) {
      snippetsAt = Date.now();
      const r = await transport('GET', '/v1/settings');
      if (r.status === 200) snippetsOn = r.json?.settings?.['email.snippetsButton']?.value !== false;
    }
    return snippetsOn;
  };
  // Snippets: a button in every compose window that drops a saved reply in, filled in for the person being written to.
  sdk.Compose.registerComposeViewHandler(async (composeView) => {
    if (!(await snippetsEnabled())) return;
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
      accountEmail: () => gmailAccount,
      signInAs: () => signIn(undefined, undefined, { fresh: true }),
      getSubject: () => threadView.getSubject(),
      getSender: () => {
        const c = threadView.getMessageViews()[0]?.getSender();
        return c ? { email: c.emailAddress, name: c.name ?? '' } : null;
      },
      getThreadId: () => threadView.getThreadIDAsync(),
      getRecipients: async () => {
        const out = new Set<string>();
        for (const mv of threadView.getMessageViews()) {
          try { for (const r of await mv.getRecipientsFull()) out.add(r.emailAddress.toLowerCase()); } catch { /* a collapsed message may not answer */ }
        }
        return [...out];
      },
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
