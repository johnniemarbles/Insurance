import { api, ApiError } from './api';
import { strings, type Locale, type Strings } from './i18n';

interface Me { needsConsent: boolean; user: { displayName: string | null; email: string; locale: Locale }; tenant: { name: string }; product: { name: string; logoUrl: string } }
interface Pipeline { id: string; name: string; stages: { id: string; name: string }[]; fields: { key: string; labels: Record<string, string>; type: string; required: boolean }[] }
interface Box { id: string; name: string; pipelineId: string; stageId: string; ownerNodeId: string }
export interface ThreadInfo { subject: string; sender: { email: string; name: string } | null }

function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> & { class?: string } = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  const { class: cls, ...rest } = props as Record<string, unknown>;
  if (cls) e.className = cls as string;
  Object.assign(e, rest);
  for (const k of kids) e.append(k);
  return e;
}

const STYLE = `
.pii{font:13px/1.45 system-ui,sans-serif;color:#1f2937;padding:12px}
.pii h3{margin:12px 0 6px;font-size:13px}.pii label{display:block;margin:8px 0 2px;color:#4b5563}
.pii input,.pii select{width:100%;box-sizing:border-box;padding:6px;border:1px solid #d1d5db;border-radius:4px}
.pii button{margin-top:8px;padding:6px 12px;border:0;border-radius:4px;background:#1d4ed8;color:#fff;cursor:pointer}
.pii button.link{background:none;color:#1d4ed8;padding:0}.pii button:disabled{opacity:.6}
.pii .head{display:flex;align-items:center;gap:8px;font-weight:600}.pii .head img{width:24px;height:24px}
.pii .box{border-top:1px solid #e5e7eb;padding:8px 0}.pii .err{color:#b91c1c;margin-top:6px}.pii .ok{color:#047857;margin-top:6px}
.pii .muted{color:#6b7280}.pii p.notice{white-space:pre-wrap}
`;

export function mountSidebar(host: HTMLElement, thread: ThreadInfo): void {
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.append(el('style', { textContent: STYLE }));
  const app = el('div', { class: 'pii' });
  root.append(app);
  let t: Strings = strings('en');

  const show = (...nodes: Node[]) => { app.replaceChildren(...nodes); };
  const fail = (e: unknown) => show(el('div', { class: 'err' }, e instanceof ApiError && e.status === 0 ? t.offline : (e as Error).message), el('button', { textContent: t.retry, onclick: () => void load() }));

  async function load(): Promise<void> {
    show(el('div', { class: 'muted', textContent: t.loading }));
    let me: Me;
    try { me = await api<Me>('GET', '/v1/me'); } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        show(el('p', { textContent: t.signedOut }), el('button', { textContent: t.signIn, onclick: () => void chrome.runtime.sendMessage({ type: 'pii:signin' }) }),
          el('div', {}, el('button', { class: 'link', textContent: t.retry, onclick: () => void load() })));
        return;
      }
      return fail(e);
    }
    t = strings(me.user.locale);
    if (me.needsConsent) return consent();
    try { await main(me); } catch (e) { fail(e); }
  }

  async function consent(): Promise<void> {
    try {
      const n = await api<{ text: string }>('GET', '/v1/consent/first-login');
      show(el('h3', { textContent: t.notice }), el('p', { class: 'notice', textContent: n.text }),
        el('button', { textContent: t.accept, onclick: async () => { await api('POST', '/v1/consent/first-login'); await load(); } }));
    } catch (e) { fail(e); }
  }

  async function main(me: Me): Promise<void> {
    const [{ pipelines }, { boxes }] = await Promise.all([
      api<{ pipelines: Pipeline[] }>('GET', '/v1/pipelines'),
      api<{ boxes: Box[] }>('GET', '/v1/boxes?limit=15'),
    ]);
    const head = el('div', { class: 'head' }, el('img', { src: me.product.logoUrl, alt: '' }), me.product.name);
    const sub = el('div', { class: 'muted', textContent: `${me.tenant.name} · ${me.user.email}` });

    // ---- create box from this email ----
    const form = el('div');
    if (pipelines.length === 0) form.append(el('p', { class: 'muted', textContent: t.noPipeline }));
    else {
      const pSel = el('select');
      for (const p of pipelines) pSel.append(el('option', { value: p.id, textContent: p.name }));
      const name = el('input', { value: thread.subject || '' });
      const msg = el('div');
      const locSel = el('select');
      const locWrap = el('div', {}, el('label', { textContent: t.location }), locSel);
      locWrap.style.display = 'none';
      void api<{ locations: { id: string; name: string }[] }>('GET', '/v1/org/contexts').then((r) => {
        if (r.locations.length > 1) {
          locSel.append(el('option', { value: '', textContent: t.chooseLocation }));
          for (const l of r.locations) locSel.append(el('option', { value: l.id, textContent: l.name }));
          locWrap.style.display = '';
        }
      }).catch(() => undefined);
      const btn = el('button', { textContent: t.create });
      btn.onclick = async () => {
        btn.disabled = true; btn.textContent = t.creating; msg.replaceChildren();
        try {
          const loc = locSel.value || undefined;
          let contactId: string | undefined;
          if (thread.sender?.email) {
            const c = await api<{ id: string }>('POST', '/v1/contacts', { email: thread.sender.email, fullName: thread.sender.name || undefined, contextNodeId: loc }).catch(async (e) => {
              if (e instanceof ApiError && e.status === 409) { // already known: reuse
                const found = await api<{ contacts: { id: string }[] }>('GET', `/v1/contacts?q=${encodeURIComponent(thread.sender!.email)}&limit=1`);
                return found.contacts[0];
              }
              throw e;
            });
            contactId = c?.id;
          }
          await api('POST', '/v1/boxes', { pipelineId: pSel.value, name: name.value.trim() || thread.subject || 'Untitled', contextNodeId: loc, contactIds: contactId ? [contactId] : undefined });
          msg.replaceChildren(el('div', { class: 'ok', textContent: t.created }));
          await main(me);
        } catch (e) {
          msg.replaceChildren(el('div', { class: 'err', textContent: (e as Error).message }));
          btn.disabled = false; btn.textContent = t.create;
        }
      };
      form.append(el('label', { textContent: t.pipeline }), pSel, el('label', { textContent: t.boxName }), name, locWrap, btn, msg);
    }

    // ---- recent boxes with stage moves ----
    const list = el('div');
    if (boxes.length === 0) list.append(el('div', { class: 'muted', textContent: t.none }));
    for (const b of boxes) {
      const stages = pipelines.find((p) => p.id === b.pipelineId)?.stages ?? [];
      const sel = el('select');
      for (const s of stages) sel.append(el('option', { value: s.id, textContent: s.name, selected: s.id === b.stageId }));
      const note = el('span', { class: 'muted' });
      sel.onchange = async () => {
        try { await api('PATCH', `/v1/boxes/${b.id}`, { stageId: sel.value }); note.textContent = t.saved; }
        catch (e) { note.textContent = (e as ApiError).status === 403 ? t.readOnly : (e as Error).message; sel.value = b.stageId; }
      };
      list.append(el('div', { class: 'box' }, el('div', { textContent: b.name }), sel, note));
    }
    show(head, sub, el('h3', { textContent: t.createBox }), form, el('h3', { textContent: t.recent }), list);
  }

  void load();
}
