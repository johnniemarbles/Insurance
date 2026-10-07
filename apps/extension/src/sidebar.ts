import { api, ApiError } from './api';
import { strings, type Locale, type Strings } from './i18n';

interface Me { needsConsent: boolean; user: { displayName: string | null; email: string; locale: Locale }; tenant: { name: string }; product: { name: string; logoUrl: string } }
interface Pipeline { id: string; name: string; stages: { id: string; name: string }[] }
interface Box { id: string; name: string; pipelineId: string; stageId: string; ownerNodeId: string }
interface AliasRule { alias: string; pipelineId: string; stageId: string | null; pipelineName: string | null }
interface Note { id: string; authorName: string | null; body: string; createdAt: string }
interface Task { id: string; title: string; dueAt: string | null; doneAt: string | null }
export interface CapturedMessage {
  gmailMessageId: string; sentAt?: string; from?: string; to: { email: string; name?: string }[]; body: string; attachments: { name: string }[];
}
export interface ThreadInfo {
  /** The Gmail account on screen. PII only shows when it is the account signed in to PII. */
  accountEmail?(): string;
  signInAs?(): void;
  getSubject(): string;
  getSender(): { email: string; name: string } | null;
  getThreadId(): Promise<string>;
  /** Every address the conversation was sent to or copied to, read from the open page. Stays in the browser. */
  getRecipients?(): Promise<string[]>;
  capture(): Promise<{ messages: CapturedMessage[]; skipped: number }>;
}

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
.pii h3{margin:14px 0 6px;font-size:13px}.pii label{display:block;margin:8px 0 2px;color:#4b5563}
.pii input,.pii select,.pii textarea{width:100%;box-sizing:border-box;padding:6px;border:1px solid #d1d5db;border-radius:4px;font:inherit}
.pii button{margin-top:8px;margin-right:6px;padding:6px 12px;border:0;border-radius:4px;background:#1d4ed8;color:#fff;cursor:pointer}
.pii button.link{background:none;color:#1d4ed8;padding:0}.pii button.danger{background:#fff;color:#b91c1c;border:1px solid #fca5a5}.pii button.quiet{background:#e5e7eb;color:#111}
.pii button:disabled{opacity:.6}.pii .head{display:flex;align-items:center;gap:8px;font-weight:600}.pii .head img{width:24px;height:24px}
.pii .card{border:1px solid #e5e7eb;border-radius:6px;padding:10px;margin-top:10px}.pii .row{border-top:1px solid #f3f4f6;padding:6px 0}
.pii .err{color:#b91c1c;margin-top:6px}.pii .ok{color:#047857;margin-top:6px}.pii .muted{color:#6b7280}.pii p.notice{white-space:pre-wrap}.pii .done{text-decoration:line-through;color:#6b7280}
`;

export function mountSidebar(host: HTMLElement, thread: ThreadInfo): void {
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  root.append(el('style', { textContent: STYLE }));
  const app = el('div', { class: 'pii' });
  root.append(app);
  let t: Strings = strings('en');
  let myEmail = '';

  const show = (...nodes: Node[]) => { app.replaceChildren(...nodes); };
  const errText = (e: unknown) => (e instanceof ApiError && e.status === 0 ? t.offline : e instanceof ApiError && e.code === 'keys_unavailable' ? t.keysOff : (e as Error).message);
  const fail = (e: unknown) => show(el('div', { class: 'err' }, errText(e)), el('button', { textContent: t.retry, onclick: () => void load() }));

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
    const gmail = thread.accountEmail?.() ?? '';
    if (gmail && gmail !== me.user.email.toLowerCase()) {
      show(el('b', { textContent: t.wrongTitle }), el('p', { textContent: t.wrongBody(gmail, me.user.email) }),
        el('button', { textContent: t.signInAs(gmail), onclick: () => thread.signInAs?.() }));
      return;
    }
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
    myEmail = me.user.email.toLowerCase();
    const threadId = await thread.getThreadId();
    const [{ pipelines }, { boxes: recent }, linked, aliasRules, recipients] = await Promise.all([
      api<{ pipelines: Pipeline[] }>('GET', '/v1/pipelines'),
      api<{ boxes: Box[] }>('GET', '/v1/boxes?limit=50'),
      api<{ boxes: (Box & { threadId: string })[] }>('GET', `/v1/threads/lookup?gmailThreadId=${encodeURIComponent(threadId)}`),
      api<{ rules: AliasRule[] }>('GET', '/v1/alias-rules').then((r) => r.rules, () => [] as AliasRule[]),
      (thread.getRecipients ? thread.getRecipients() : Promise.resolve([] as string[])).catch(() => [] as string[]),
    ]);
    // Matching happens here, in the browser: only the rules came from the server, nothing about the email went up.
    const seen = new Set(recipients.map((a) => a.trim().toLowerCase()));
    const hit = aliasRules.find((r) => seen.has(r.alias));
    const head = el('div', { class: 'head' }, el('img', { src: me.product.logoUrl, alt: '' }), me.product.name);
    const sub = el('div', { class: 'muted', textContent: `${me.tenant.name} · ${me.user.email}` });
    const parts: Node[] = [head, sub];
    if (linked.boxes.length === 0) parts.push(addPanel(me, threadId, pipelines, recent, hit));
    else for (const b of linked.boxes) parts.push(boxPanel(b, pipelines, threadId));
    show(...parts);
  }

  // ---------------- not linked yet ----------------
  function addPanel(_me: Me, threadId: string, pipelines: Pipeline[], recent: Box[], suggest?: AliasRule): HTMLElement {
    const wrap = el('div', { class: 'card' }, el('b', { textContent: t.addToBox }));
    const target = el('select');
    target.append(el('option', { value: '', textContent: t.newBox }));
    for (const b of recent) target.append(el('option', { value: b.id, textContent: b.name }));
    const pSel = el('select');
    for (const p of pipelines) pSel.append(el('option', { value: p.id, textContent: p.name }));
    const suggested = suggest && pipelines.find((p) => p.id === suggest.pipelineId);
    if (suggested) pSel.value = suggested.id;
    const name = el('input', { value: thread.getSubject() || '' });
    const locSel = el('select');
    const locWrap = el('div', {}, el('label', { textContent: t.location }), locSel);
    locWrap.style.display = 'none';
    const newFields = el('div', {}, el('label', { textContent: t.pipeline }), pSel, el('label', { textContent: t.boxName }), name, locWrap);
    void api<{ locations: { id: string; name: string }[] }>('GET', '/v1/org/contexts').then((r) => {
      if (r.locations.length > 1) {
        locSel.append(el('option', { value: '', textContent: t.chooseLocation }));
        for (const l of r.locations) locSel.append(el('option', { value: l.id, textContent: l.name }));
        locWrap.style.display = '';
      }
    }).catch(() => undefined);
    target.onchange = () => { newFields.style.display = target.value ? 'none' : ''; };
    const msg = el('div');
    const go = el('button', { textContent: t.review });
    if (suggest && suggested) wrap.append(el('div', { class: 'ok', textContent: t.aliasHint(suggest.alias, suggested.name) }));
    wrap.append(el('label', { textContent: t.existingBox }), target, newFields, go, msg);
    if (pipelines.length === 0 && recent.length === 0) { wrap.replaceChildren(el('b', { textContent: t.addToBox }), el('p', { class: 'muted', textContent: t.noPipeline })); return wrap; }

    go.onclick = async () => {
      msg.replaceChildren();
      const existing = recent.find((b) => b.id === target.value);
      const recordName = existing?.name ?? (name.value.trim() || 'Untitled');
      try {
        const n = await api<{ text: string }>('GET', `/v1/link-notice?recordName=${encodeURIComponent(recordName)}`);
        const accept = el('button', { textContent: t.acceptAdd });
        const cancel = el('button', { class: 'quiet', textContent: t.cancel, onclick: () => void load() });
        accept.onclick = async () => {
          accept.disabled = true; accept.textContent = t.creating;
          try {
            const { messages, skipped } = await thread.capture();
            let boxId = existing?.id;
            if (!boxId) {
              const loc = locSel.value || undefined;
              const sender = thread.getSender();
              let contactId: string | undefined;
              if (sender?.email) {
                const c = await api<{ id: string }>('POST', '/v1/contacts', { email: sender.email, fullName: sender.name || undefined, contextNodeId: loc }).catch(async (e) => {
                  if (e instanceof ApiError && e.status === 409) {
                    const f = await api<{ contacts: { id: string }[] }>('GET', `/v1/contacts?q=${encodeURIComponent(sender.email)}&limit=1`);
                    return f.contacts[0];
                  }
                  throw e;
                });
                contactId = c?.id;
              }
              boxId = (await api<{ id: string }>('POST', '/v1/boxes', { pipelineId: pSel.value, stageId: suggest && suggest.pipelineId === pSel.value && suggest.stageId ? suggest.stageId : undefined, name: recordName, contextNodeId: loc, contactIds: contactId ? [contactId] : undefined })).id;
            }
            await api('POST', `/v1/boxes/${boxId}/threads`, { gmailThreadId: threadId, subject: thread.getSubject() || undefined, acceptedNotice: true, messages });
            await load();
            if (skipped > 0) app.append(el('div', { class: 'muted', textContent: t.skipped(skipped) }));
          } catch (e) { accept.disabled = false; accept.textContent = t.acceptAdd; msg.replaceChildren(el('div', { class: 'err', textContent: errText(e) })); }
        };
        wrap.replaceChildren(el('b', { textContent: t.notice }), el('p', { class: 'notice', textContent: n.text }), accept, cancel, msg);
      } catch (e) { msg.replaceChildren(el('div', { class: 'err', textContent: errText(e) })); }
    };
    return wrap;
  }

  // ---------------- linked: stage, notes, tasks ----------------
  function boxPanel(b: Box & { threadId: string }, pipelines: Pipeline[], _threadId: string): HTMLElement {
    const card = el('div', { class: 'card' }, el('b', { textContent: b.name }));
    const stages = pipelines.find((p) => p.id === b.pipelineId)?.stages ?? [];
    const sel = el('select');
    for (const s of stages) sel.append(el('option', { value: s.id, textContent: s.name, selected: s.id === b.stageId }));
    const stageMsg = el('span', { class: 'muted' });
    sel.onchange = async () => {
      try { await api('PATCH', `/v1/boxes/${b.id}`, { stageId: sel.value }); stageMsg.textContent = t.saved; b.stageId = sel.value; }
      catch (e) { stageMsg.textContent = (e as ApiError).status === 403 ? t.readOnly : errText(e); sel.value = b.stageId; }
    };
    card.append(el('label', { textContent: t.stage }), sel, stageMsg);

    const notes = el('div'), tasks = el('div');
    const loadNotes = async () => {
      const r = await api<{ notes: Note[] }>('GET', `/v1/boxes/${b.id}/notes?limit=20`);
      notes.replaceChildren(...(r.notes.length ? r.notes.map((n) => el('div', { class: 'row' }, el('div', { class: 'muted', textContent: `${n.authorName ?? ''} · ${new Date(n.createdAt).toLocaleString()}` }), el('div', { textContent: n.body }))) : [el('div', { class: 'muted', textContent: t.none })]));
    };
    const loadTasks = async () => {
      const r = await api<{ tasks: Task[] }>('GET', `/v1/tasks?boxId=${b.id}&limit=50`);
      tasks.replaceChildren(...(r.tasks.length ? r.tasks.map((k) => {
        const cb = el('input', { type: 'checkbox', checked: !!k.doneAt });
        cb.style.width = 'auto';
        cb.onchange = async () => { try { await api('PATCH', `/v1/tasks/${k.id}`, { done: cb.checked }); await loadTasks(); } catch { cb.checked = !cb.checked; } };
        return el('div', { class: 'row' }, cb, ' ', el('span', { class: k.doneAt ? 'done' : '', textContent: k.title }), k.dueAt ? el('span', { class: 'muted', textContent: ` · ${new Date(k.dueAt).toLocaleDateString()}` }) : '');
      }) : [el('div', { class: 'muted', textContent: t.none })]));
    };

    const noteBox = el('textarea', { rows: 2, placeholder: t.notePh });
    const noteBtn = el('button', { textContent: t.addNote });
    noteBtn.onclick = async () => {
      if (!noteBox.value.trim()) return;
      try { await api('POST', `/v1/boxes/${b.id}/notes`, { body: noteBox.value.trim() }); noteBox.value = ''; await loadNotes(); } catch (e) { alert(errText(e)); }
    };
    const taskIn = el('input', { placeholder: t.taskPh });
    const taskBtn = el('button', { textContent: t.addTask });
    taskBtn.onclick = async () => {
      if (!taskIn.value.trim()) return;
      try { await api('POST', `/v1/boxes/${b.id}/tasks`, { title: taskIn.value.trim() }); taskIn.value = ''; await loadTasks(); } catch (e) { alert(errText(e)); }
    };
    const unlink = el('button', { class: 'danger', textContent: t.unlink });
    unlink.onclick = async () => {
      if (!confirm(t.confirmUnlink)) return;
      try { await api('DELETE', `/v1/boxes/${b.id}/threads/${b.threadId}`); await load(); } catch (e) { alert(errText(e)); }
    };
    // Point a teammate at this conversation. They can already open it through the record; this tells them it is worth a look.
    const shareBox = el('div');
    const shareBtn = el('button', { class: 'quiet', textContent: t.share });
    shareBtn.onclick = async () => {
      shareBtn.disabled = true;
      try {
        const { users } = await api<{ users: { id: string; displayName: string | null; email: string }[] }>('GET', '/v1/users');
        const others = users.filter((u) => u.email.toLowerCase() !== myEmail);
        const pick = el('select', { multiple: true, size: Math.min(5, Math.max(2, others.length)) });
        for (const u of others) pick.append(el('option', { value: u.id, textContent: u.displayName ? `${u.displayName} (${u.email})` : u.email }));
        const note = el('input', { placeholder: t.shareNote, maxLength: 300 });
        const msg = el('div');
        const send = el('button', { textContent: t.shareSend });
        send.onclick = async () => {
          const ids = [...pick.selectedOptions].map((o) => o.value);
          if (ids.length === 0) return;
          send.disabled = true;
          try { await api('POST', `/v1/threads/${b.threadId}/share`, { userIds: ids, boxId: b.id, message: note.value.trim() || undefined }); shareBox.replaceChildren(el('div', { class: 'ok', textContent: t.shareDone })); }
          catch (e) { send.disabled = false; msg.replaceChildren(el('div', { class: 'err', textContent: errText(e) })); }
        };
        shareBox.replaceChildren(...(others.length ? [el('label', { textContent: t.shareWho }), pick, note, send, msg] : [el('div', { class: 'muted', textContent: t.shareNone })]));
      } catch (e) { shareBtn.disabled = false; shareBox.replaceChildren(el('div', { class: 'err', textContent: errText(e) })); }
    };
    card.append(el('h3', { textContent: t.notes }), noteBox, noteBtn, notes, el('h3', { textContent: t.tasks }), taskIn, taskBtn, tasks, el('div', {}, shareBtn, unlink), shareBox);
    void loadNotes().catch(() => undefined);
    void loadTasks().catch(() => undefined);
    return card;
  }

  void load();
}
