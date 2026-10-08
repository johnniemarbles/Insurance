import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { mountSidebar, type ThreadInfo } from '../../extension/src/sidebar.ts';
import { DEMO_THREADS, type DemoMsg, type DemoThread } from './demo-inbox-data.ts';
import type { Locale } from './types.ts';

const X = {
  'en': { h: 'Demo inbox', note: 'A simulated mailbox with fictional emails. The panel on the right is the same PII panel that appears next to your emails in Gmail. Nothing is sent anywhere.', all: 'Inbox', reply: 'Reply', send: 'Send (demo)', sent: 'Demo only: this reply stayed here and was not sent.', placeholder: 'Write a reply…', back: 'Back to inbox', me: 'me', to: 'to', unread: 'Unread', att: 'Attachment' },
  'fr-CA': { h: 'Boîte de réception de démonstration', note: 'Une boîte simulée avec des courriels fictifs. Le panneau de droite est le même panneau PII qui s’affiche à côté de vos courriels dans Gmail. Rien n’est envoyé.', all: 'Réception', reply: 'Répondre', send: 'Envoyer (démo)', sent: 'Démo seulement : cette réponse est restée ici et n’a pas été envoyée.', placeholder: 'Écrire une réponse…', back: 'Retour à la boîte', me: 'moi', to: 'à', unread: 'Non lu', att: 'Pièce jointe' },
};

const ago = (h: number, locale: Locale) => {
  const d = new Date(Date.now() - h * 3_600_000);
  return h < 20 ? d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
};

export function DemoInbox({ locale, meEmail, meName }: { locale: Locale; meEmail: string; meName: string }) {
  const x = X[locale];
  const [openId, setOpenId] = useState<string | null>(null);
  const [read, setRead] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState<Record<string, DemoMsg[]>>({});
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const me = { name: meName || x.me, email: meEmail };

  const threads = useMemo(() => DEMO_THREADS, []);
  const open = threads.find((t) => t.id === openId) ?? null;
  const messagesOf = (t: DemoThread): DemoMsg[] => [...t.messages, ...(extra[t.id] ?? [])];

  // The extension's own sidebar, reading this simulated thread the way it reads a Gmail thread.
  useEffect(() => {
    const host = panel.current;
    if (!host || !open) return;
    const fresh = document.createElement('div');
    host.replaceChildren(fresh);
    const first = open.messages[0]!;
    const info: ThreadInfo = {
      accountEmail: () => meEmail.toLowerCase(),
      getSubject: () => open.subject,
      getSender: () => ({ email: first.from.email, name: first.from.name }),
      getThreadId: async () => open.id,
      getRecipients: async () => [meEmail, open.via],
      capture: async () => ({
        skipped: 0,
        messages: messagesOf(open).map((m) => ({
          gmailMessageId: `${open.id}-${m.id}`,
          sentAt: new Date(Date.now() - m.hoursAgo * 3_600_000).toISOString(),
          from: m.from.email,
          to: [m.from.email === meEmail ? { email: first.from.email, name: first.from.name } : { email: meEmail, name: me.name }],
          body: m.body,
          attachments: (m.attachments ?? []).map((name) => ({ name })),
        })),
      }),
    };
    mountSidebar(fresh, info);
  }, [openId, extra, meEmail]);

  const select = (t: DemoThread) => { setOpenId(t.id); setRead(new Set(read).add(t.id)); setDraft(''); setNotice(false); };
  const send = () => {
    if (!open || !draft.trim()) return;
    setExtra({ ...extra, [open.id]: [...(extra[open.id] ?? []), { id: `r${Date.now()}`, from: me, hoursAgo: 0, body: draft.trim() }] });
    setDraft(''); setNotice(true);
  };

  return (
    <div class={`dibox${open ? ' reading' : ''}`}>
      <div class="dibox-top"><h2>{x.h}</h2><p class="muted">{x.note}</p></div>
      <div class="dibox-cols">
        <ul class="dibox-list" aria-label={x.all}>
          {threads.map((t) => {
            const last = messagesOf(t)[messagesOf(t).length - 1]!;
            const isUnread = t.unread && !read.has(t.id);
            return (
              <li key={t.id}>
                <button class={`dibox-row${openId === t.id ? ' on' : ''}${isUnread ? ' unread' : ''}`} onClick={() => select(t)}>
                  <span class="dibox-from">{last.from.email === meEmail ? `${x.me}` : last.from.name}{isUnread && <i aria-label={x.unread} />}</span>
                  <span class="dibox-time">{ago(last.hoursAgo, locale)}</span>
                  <span class="dibox-subj">{t.subject}</span>
                  <span class="dibox-snip">{last.body.replace(/\s+/g, ' ').slice(0, 90)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div class="dibox-read">
          {open ? (
            <>
              <button class="btn quiet dibox-back" onClick={() => setOpenId(null)}>{x.back}</button>
              <h3>{open.subject}</h3>
              {messagesOf(open).map((m) => (
                <article class="dibox-msg" key={m.id}>
                  <header><b>{m.from.name}</b> <span class="muted">&lt;{m.from.email}&gt; · {x.to} {m.from.email === meEmail ? open.messages[0]!.from.name : x.me} · {ago(m.hoursAgo, locale)}</span></header>
                  <p>{m.body}</p>
                  {m.attachments?.map((a) => <span class="dibox-att" title={x.att}>{a}</span>)}
                </article>
              ))}
              <div class="dibox-reply">
                <textarea rows={3} placeholder={x.placeholder} value={draft} aria-label={x.reply} onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)} />
                <button class="btn" disabled={!draft.trim()} onClick={send}>{x.send}</button>
                {notice && <span class="muted">{x.sent}</span>}
              </div>
            </>
          ) : <p class="muted dibox-empty">{x.all}</p>}
        </div>
        <aside class="dibox-panel" aria-label="PII"><div ref={panel} /></aside>
      </div>
    </div>
  );
}
