import { useEffect, useMemo, useState, useRef } from 'preact/hooks';
import type { ComposeApi, Locale } from './types.ts';
import { ActivityTab } from './activity.tsx';
import { OrgTab } from './org.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface Node { id: string; type: 'tenant' | 'location' | 'partner'; name: string; isActive: boolean }
export interface Link { parentId: string; childId: string }
interface Member { nodeId: string; role: string; userId: string; email: string; displayName: string | null; status: string }
interface Inv { id: string; email: string; nodeId: string; role: string; locale: string; expiresAt: string; acceptedAt: string | null; createdAt: string; sentAt: string | null; deliveryMethod: 'gmail' | 'link' | null; deliveryError: string | null; gmailThreadId: string | null; attempts: number; linkOpenedAt: string | null; invitedBy: string | null; status: 'created' | 'sent' | 'opened' | 'accepted' | 'expired' | 'not_sent' }
import { LMS } from './features.ts';
const ROLES = (['admin', 'manager', 'trainer', 'member', 'learner'] as const).filter((r) => LMS || (r !== 'trainer' && r !== 'learner'));

export const X = {
  'en': {
    title: 'Company and people', sub: { people: 'People', structure: 'Structure', activity: 'Activity' },
    add: 'Add person', search: 'Search by name or email', all: 'Everyone', active: 'Active', waiting: 'Waiting', attention: 'Needs attention',
    emptyT: 'Nobody here yet', emptyB: 'Add the first person. They get an email from your Gmail with a button to join.',
    status: { created: 'Ready to send', sent: 'Sent', opened: 'Link opened', accepted: 'Active', expired: 'Expired', not_sent: 'Not sent', off: 'Switched off' } as Record<string, string>,
    hint: { created: 'Nothing has been sent yet.', sent: 'Waiting for them to open the link.', opened: 'They opened the link but have not signed in.', expired: 'Nobody joined within 7 days.', not_sent: 'The email did not go out.' } as Record<string, string>,
    invitedBy: 'Invited by', ago: 'ago', via: { gmail: 'from Gmail', link: 'by a copied link' },
    resend: 'Resend', newLink: 'Get a link', withdraw: 'Withdraw', switchOff: 'Switch off', switchOn: 'Switch back on', giveRole: 'Give a role', removeRole: 'Remove', copy: 'Copy link', copied: 'Copied', sending: 'Sending from your Gmail…', sendingNow: 'Sending…', reviewL: 'Let me check each email in Gmail first', reviewD: 'A Gmail window opens for each person with the message ready. Press Send there. Recommended until you have seen one arrive.', openSent: 'Open the sent email', notThere: 'Not there yet? Ask them to check Spam, or use ⋯ → Get a link and send it yourself.', sendingHint: 'Gmail is sending this now.', queued: 'Waiting for Gmail', handedOff: (e: string) => `Handed to Gmail for ${e}. Check your Sent folder if you want to be sure.`, closeKeep: 'Close, sending continues',
    sentOk: (e: string) => `Sent to ${e} from your Gmail.`, linkReady: 'Link ready. Send it to the person yourself.', openGmail: 'Open Gmail with the PII extension to send from your own address.',
    step: ['Who', 'Where', 'Role', 'Send'], next: 'Next', back: 'Back', close: 'Close', cancel: 'Cancel',
    whoT: 'Who are you adding?', whoHelp: 'One email per line. You can paste a list.', whoPh: 'asha@example.com\nraj@example.com', already: (e: string) => `${e} is already in the company. Use Give a role on their row.`, bad: 'That does not look like an email address.',
    whereT: 'Where do they belong?', whereHelp: 'Their records and the people above them follow this choice.', searchPlace: 'Search places', company: 'Whole company', notListed: 'Not listed? Add a partner here', partnerName: 'Partner name', create: 'Create',
    roleT: 'What can they do?', roleHelp: 'You can change this later.',
    roleName: { admin: { tenant: 'Company admin', location: 'Branch admin', partner: 'Partner owner' }, manager: 'Manager', trainer: 'Trainer', member: 'Member', learner: 'Learner' } as any,
    roleDesc: { admin: 'Runs this place: adds people, sets it up, sees everything below it.', manager: 'Builds pipelines and training, manages the team’s work.', trainer: 'Creates and assigns courses.', member: 'Works records and email in the CRM.', learner: 'Takes the courses assigned to them.' } as Record<string, string>,
    adminLocked: 'Only a company admin can choose this here.',
    sendT: 'How should they get it?', viaGmail: 'Send from my Gmail', viaGmailD: 'The email comes from your own address, so they recognise it.', viaLink: 'Only create a link', viaLinkD: 'You send it yourself, by chat or any other way.', noteL: 'Add a personal line (optional)', notePh: 'Looking forward to working with you.',
    review: (n: number, p: string, r: string, g: boolean) => `Invite ${n} ${n === 1 ? 'person' : 'people'} to ${p} as ${r}, ${g ? 'sent from your Gmail' : 'with a link you send yourself'}.`,
    send: (n: number) => `Invite ${n}`, creating: 'Working…', done: 'Done', doneT: 'Invitations', retry: 'Try again', fixLater: 'You can resend from the People list at any time.',
    subj: (c: string) => `You are invited to ${c} on PII`, mailHi: 'Hello,', mailBody: (who: string, c: string, p: string, r: string) => `${who} invited you to join <b>${c}</b> (${p}) as <b>${r}</b> on PII by Punjab Insurance.`, mailBtn: 'Accept your invitation', mailFoot: 'This link works once and expires in 7 days.',
    roleHead: 'Roles', addRoleT: 'Give a role', person: 'Person', place: 'Place', role: 'Role', save: 'Save', off: 'Off',
    oldExt: 'This page is not running inside Gmail, so it cannot send from your address.',
  },
  'fr-CA': {
    title: 'Entreprise et personnes', sub: { people: 'Personnes', structure: 'Structure', activity: 'Activité' },
    add: 'Ajouter une personne', search: 'Chercher par nom ou courriel', all: 'Tout le monde', active: 'Actives', waiting: 'En attente', attention: 'À traiter',
    emptyT: 'Personne pour l’instant', emptyB: 'Ajoutez la première personne. Elle reçoit un courriel de votre Gmail avec un bouton pour se joindre.',
    status: { created: 'Prête à envoyer', sent: 'Envoyée', opened: 'Lien ouvert', accepted: 'Active', expired: 'Expirée', not_sent: 'Non envoyée', off: 'Désactivée' } as Record<string, string>,
    hint: { created: 'Rien n’a encore été envoyé.', sent: 'En attente de l’ouverture du lien.', opened: 'Le lien a été ouvert, mais la personne ne s’est pas connectée.', expired: 'Personne ne s’est joint en 7 jours.', not_sent: 'Le courriel n’est pas parti.' } as Record<string, string>,
    invitedBy: 'Invitée par', ago: '', via: { gmail: 'depuis Gmail', link: 'par un lien copié' },
    resend: 'Renvoyer', newLink: 'Obtenir un lien', withdraw: 'Retirer', switchOff: 'Désactiver', switchOn: 'Réactiver', giveRole: 'Donner un rôle', removeRole: 'Retirer', copy: 'Copier le lien', copied: 'Copié', sending: 'Envoi depuis votre Gmail…', sendingNow: 'Envoi…', reviewL: 'Me laisser vérifier chaque courriel dans Gmail', reviewD: 'Une fenêtre Gmail s’ouvre pour chaque personne avec le message prêt. Appuyez sur Envoyer. Recommandé tant que vous n’en avez pas vu arriver un.', openSent: 'Ouvrir le courriel envoyé', notThere: 'Pas encore reçu? Demandez de vérifier les pourriels, ou utilisez ⋯ → Obtenir un lien et envoyez-le vous-même.', sendingHint: 'Gmail envoie ce message.', queued: 'En attente de Gmail', handedOff: (e: string) => `Remis à Gmail pour ${e}. Vérifiez vos éléments envoyés pour en être certain.`, closeKeep: 'Fermer, l’envoi continue',
    sentOk: (e: string) => `Envoyé à ${e} depuis votre Gmail.`, linkReady: 'Lien prêt. Transmettez-le vous-même à la personne.', openGmail: 'Ouvrez Gmail avec l’extension PII pour envoyer depuis votre adresse.',
    step: ['Qui', 'Où', 'Rôle', 'Envoi'], next: 'Suivant', back: 'Retour', close: 'Fermer', cancel: 'Annuler',
    whoT: 'Qui ajoutez-vous?', whoHelp: 'Un courriel par ligne. Vous pouvez coller une liste.', whoPh: 'asha@exemple.com\nraj@exemple.com', already: (e: string) => `${e} fait déjà partie de l’entreprise. Utilisez Donner un rôle sur sa ligne.`, bad: 'Ceci ne ressemble pas à une adresse courriel.',
    whereT: 'Où cette personne se situe-t-elle?', whereHelp: 'Ses dossiers et les gens au-dessus d’elle suivent ce choix.', searchPlace: 'Chercher un endroit', company: 'Toute l’entreprise', notListed: 'Absent? Ajoutez un partenaire ici', partnerName: 'Nom du partenaire', create: 'Créer',
    roleT: 'Que peut-elle faire?', roleHelp: 'Vous pourrez le changer plus tard.',
    roleName: { admin: { tenant: 'Admin de l’entreprise', location: 'Admin de la succursale', partner: 'Propriétaire du partenaire' }, manager: 'Gestionnaire', trainer: 'Formateur', member: 'Membre', learner: 'Apprenant' } as any,
    roleDesc: { admin: 'Dirige cet endroit : ajoute des gens, le configure, voit tout ce qui est en dessous.', manager: 'Crée les pipelines et la formation, gère le travail de l’équipe.', trainer: 'Crée et assigne des cours.', member: 'Travaille les dossiers et les courriels dans le CRM.', learner: 'Suit les cours qui lui sont assignés.' } as Record<string, string>,
    adminLocked: 'Seul un admin de l’entreprise peut choisir ceci ici.',
    sendT: 'Comment la personne le reçoit-elle?', viaGmail: 'Envoyer depuis mon Gmail', viaGmailD: 'Le courriel vient de votre propre adresse, donc elle le reconnaît.', viaLink: 'Créer seulement un lien', viaLinkD: 'Vous l’envoyez vous-même, par clavardage ou autrement.', noteL: 'Ajouter un mot personnel (facultatif)', notePh: 'Au plaisir de travailler avec vous.',
    review: (n: number, p: string, r: string, g: boolean) => `Inviter ${n} ${n === 1 ? 'personne' : 'personnes'} à ${p} comme ${r}, ${g ? 'envoyé depuis votre Gmail' : 'avec un lien que vous transmettez'}.`,
    send: (n: number) => `Inviter ${n}`, creating: 'En cours…', done: 'Terminé', doneT: 'Invitations', retry: 'Réessayer', fixLater: 'Vous pouvez renvoyer depuis la liste des personnes à tout moment.',
    subj: (c: string) => `Vous êtes invité à ${c} sur PII`, mailHi: 'Bonjour,', mailBody: (who: string, c: string, p: string, r: string) => `${who} vous invite à joindre <b>${c}</b> (${p}) comme <b>${r}</b> sur PII par Punjab Insurance.`, mailBtn: 'Accepter l’invitation', mailFoot: 'Ce lien sert une seule fois et expire dans 7 jours.',
    roleHead: 'Rôles', addRoleT: 'Donner un rôle', person: 'Personne', place: 'Endroit', role: 'Rôle', save: 'Enregistrer', off: 'Inactif',
    oldExt: 'Cette page n’est pas dans Gmail, elle ne peut donc pas envoyer depuis votre adresse.',
  },
};
export type Strs = (typeof X)['en'];

export const initials = (s: string) => (s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('') || '?');
export const hue = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
export function Avatar({ name, size = 36 }: { name: string; size?: number }) {
  const h = hue(name);
  return <span class="av" style={{ width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.38)}px`, background: `linear-gradient(135deg,hsl(${h} 70% 55%),hsl(${(h + 40) % 360} 70% 45%))` }} aria-hidden="true">{initials(name)}</span>;
}

export function ago(iso: string, locale: Locale): string {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (s < 60) return rtf.format(-s, 'second');
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute');
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour');
  return rtf.format(-Math.round(s / 86400), 'day');
}

/** Place names with their path, in tree order: Company > Branch > Partner. */
export function placeList(nodes: Node[], links: Link[]): { node: Node; path: string; depth: number }[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map<string, string>();
  for (const l of links) if (byId.has(l.parentId) && byId.get(l.parentId)!.type !== 'tenant' && !parentOf.has(l.childId)) parentOf.set(l.childId, l.parentId);
  const kids = (id: string) => nodes.filter((n) => parentOf.get(n.id) === id).sort((a, b) => a.name.localeCompare(b.name));
  const out: { node: Node; path: string; depth: number }[] = [];
  const walk = (n: Node, trail: string[], depth: number) => { const p = [...trail, n.name]; out.push({ node: n, path: p.join(' › '), depth }); for (const c of kids(n.id)) walk(c, p, depth + 1); };
  const root = nodes.find((n) => n.type === 'tenant');
  if (root) out.push({ node: root, path: root.name, depth: 0 });
  const tops = nodes.filter((n) => n.type !== 'tenant' && !parentOf.has(n.id)).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'location' ? -1 : 1));
  for (const t of tops) walk(t, root ? [root.name] : [], 1);
  return out;
}

export function PeopleHub({ call, locale, isTenantAdmin, compose }: { call: Call; locale: Locale; isTenantAdmin: boolean; compose?: ComposeApi }) {
  const x = X[locale];
  const [sub, setSub] = useState<'people' | 'structure' | 'activity'>('people');
  return (
    <div class="ph">
      <div class="ph-head">
        <div class="seg2" role="tablist">
          {(['people', 'structure', 'activity'] as const).map((k) => <button role="tab" aria-selected={sub === k} onClick={() => setSub(k)}>{x.sub[k]}</button>)}
        </div>
      </div>
      {sub === 'people' && <PeopleList call={call} locale={locale} isTenantAdmin={isTenantAdmin} compose={compose} />}
      {sub === 'structure' && <OrgTab call={call} locale={locale} isTenantAdmin={isTenantAdmin} compose={compose} />}
      {sub === 'activity' && <ActivityTab call={call} locale={locale} />}
    </div>
  );
}

type Filter = 'all' | 'active' | 'waiting' | 'attention';

function PeopleList({ call, locale, isTenantAdmin, compose }: { call: Call; locale: Locale; isTenantAdmin: boolean; compose?: ComposeApi }) {
  const x = X[locale];
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [me, setMe] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [toast, setToast] = useState('');
  const [adding, setAdding] = useState(false);
  const [roleFor, setRoleFor] = useState<string | null>(null);
  const [linkBox, setLinkBox] = useState<{ email: string; url: string; id: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [review, setReviewState] = useState(() => { try { return localStorage.getItem('pii.inviteAuto') !== '1'; } catch { return true; } });
  const setReview = (v: boolean) => { setReviewState(v); try { localStorage.setItem('pii.inviteAuto', v ? '0' : '1'); } catch { /* private window */ } };
  const [flight, setFlight] = useState<Set<string>>(new Set());
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const load = async () => {
    try {
      const [n, l, m, i, who] = await Promise.all([call('GET', '/v1/org/nodes'), call('GET', '/v1/org/links'), call('GET', '/v1/org/members'), call('GET', '/v1/invitations'), call('GET', '/v1/me')]);
      setNodes(n.nodes); setLinks(l.links); setMembers(m.members); setInvs(i.invitations); setMe({ id: who.user.id, name: who.user.displayName || who.user.email });
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4500); return () => clearTimeout(t); }, [toast]);

  const places = useMemo(() => placeList(nodes, links), [nodes, links]);
  const placeName = (id: string) => nodes.find((n) => n.id === id)?.name ?? '';
  const rootName = nodes.find((n) => n.type === 'tenant')?.name ?? 'PII';
  const roleLabel = (role: string, nodeId: string) => { const t = nodes.find((n) => n.id === nodeId)?.type ?? 'partner'; return role === 'admin' ? x.roleName.admin[t] : x.roleName[role]; };

  const people = useMemo(() => {
    const m = new Map<string, { userId: string; email: string; name: string; off: boolean; roles: Member[] }>();
    for (const r of members) {
      const p = m.get(r.userId) ?? { userId: r.userId, email: r.email, name: r.displayName || r.email, off: r.status === 'disabled', roles: [] };
      p.roles.push(r); m.set(r.userId, p);
    }
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [members]);
  const pending = invs.filter((i) => i.status !== 'accepted');
  const needs = (i: Inv) => i.status === 'not_sent' || i.status === 'expired';
  const counts = { all: people.length + pending.length, active: people.filter((p) => !p.off).length, waiting: pending.filter((i) => !needs(i)).length, attention: pending.filter(needs).length + people.filter((p) => p.off).length };
  const needle = q.trim().toLowerCase();
  const matches = (s: string) => !needle || s.toLowerCase().includes(needle);

  /** Send the invitation email from the person's own Gmail and tell the server what happened. */
  const email = (i: { email: string; role: string; nodeId: string; acceptUrl: string; note?: string; locale?: string }) => {
    const loc = (i.locale === 'fr-CA' ? 'fr-CA' : locale) as Locale, t = X[loc];
    const place = placeName(i.nodeId) || rootName, role = roleLabel(i.role, i.nodeId) ?? i.role;
    return {
      to: i.email, subject: t.subj(rootName), review,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;max-width:520px"><p>${t.mailHi}</p><p>${t.mailBody(esc(me?.name ?? ''), esc(rootName), esc(place), esc(role))}</p>${i.note ? `<p style="border-left:3px solid #c7d2fe;padding-left:10px;color:#475569">${esc(i.note)}</p>` : ''}<p><a href="${i.acceptUrl}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold">${t.mailBtn}</a></p><p style="color:#64748b;font-size:13px">${t.mailFoot}</p></div>`,
    };
  };
  const report = (id: string, method: 'gmail' | 'link', ok: boolean, error?: string, threadId?: string) => call('POST', `/v1/invitations/${id}/delivery`, { method, ok, ...(error ? { error: error.slice(0, 300) } : {}), ...(threadId && /^[A-Za-z0-9_:-]{4,80}$/.test(threadId) ? { threadId } : {}) }).catch(() => undefined);

  /** One Gmail window at a time: the message goes out from the person's own Gmail, and the server is told what happened. */
  const deliver = (id: string, mail: { to: string; subject: string; html: string }) => {
    setFlight((f) => new Set(f).add(id));
    const run = queue.current.then(async () => { const sent = await compose!.send(mail); await report(id, 'gmail', sent.ok, sent.error, sent.threadId); return sent; });
    queue.current = run.catch(() => undefined);
    return run.catch((e) => ({ ok: false as const, error: (e as Error).message, unconfirmed: false, threadId: undefined })).finally(() => { setFlight((f) => { const n = new Set(f); n.delete(id); return n; }); void load(); });
  };
  const resend = async (inv: Inv, viaGmail = true) => {
    setBusy(inv.id); setErr('');
    try {
      const r = await call('POST', `/v1/invitations/${inv.id}/resend`);
      if (compose && viaGmail) {
        setBusy(null); setToast(x.sending);
        const sent = await deliver(inv.id, email({ email: r.email, role: r.role, nodeId: r.nodeId, acceptUrl: r.acceptUrl, locale: r.locale }));
        if (sent.ok) setToast(sent.unconfirmed ? x.handedOff(inv.email) : x.sentOk(inv.email)); else { setToast(''); setErr(sent.error ?? 'Not sent'); setLinkBox({ email: inv.email, url: r.acceptUrl, id: inv.id }); }
      } else { setLinkBox({ email: inv.email, url: r.acceptUrl, id: inv.id }); setToast(compose ? x.linkReady : x.openGmail); }
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); await load(); }
  };
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr((e as Error).message); } };

  const shown = (list: { attn: boolean; wait: boolean; act: boolean }) => filter === 'all' || (filter === 'attention' && list.attn) || (filter === 'waiting' && list.wait) || (filter === 'active' && list.act);
  const invRows = pending.filter((i) => matches(i.email) && shown({ attn: needs(i), wait: !needs(i), act: false })).sort((a, b) => Number(needs(b)) - Number(needs(a)) || b.createdAt.localeCompare(a.createdAt));
  const peopleRows = people.filter((p) => matches(p.name + ' ' + p.email) && shown({ attn: p.off, wait: false, act: !p.off }));

  const statusChip = (s: string, id?: string) => id && flight.has(id) ? <span class="pill s-sending"><i />{x.sendingNow}</span> :  <span class={`pill s-${s}`}><i />{x.status[s]}</span>;

  return (
    <div>
      <div class="ph-bar">
        <input class="ph-search" type="search" placeholder={x.search} aria-label={x.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
        <span class="spacer" />
        <button class="btn big" onClick={() => setAdding(true)}>＋ {x.add}</button>
      </div>
      <div class="ph-stats">
        {([['all', x.all, counts.all], ['active', x.active, counts.active], ['waiting', x.waiting, counts.waiting], ['attention', x.attention, counts.attention]] as const).map(([k, label, n]) => (
          <button class={`stat ${k}`} aria-pressed={filter === k} onClick={() => setFilter(k)}><b>{n}</b><span>{label}</span></button>
        ))}
      </div>
      {err && <p class="err" role="alert">{err}</p>}
      {linkBox && (
        <div class="linkbox"><div><b>{linkBox.email}</b><p class="muted">{x.linkReady}</p></div>
          <div class="erow"><input readOnly value={linkBox.url} aria-label={x.copy} onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button class="btn" onClick={() => { void navigator.clipboard?.writeText(linkBox.url).then(() => { setToast(x.copied); void report(linkBox.id, 'link', true).then(load); }, () => undefined); }}>{x.copy}</button>
            <button class="link" onClick={() => setLinkBox(null)}>×</button></div>
        </div>
      )}
      {counts.all === 0 && <div class="empty"><div class="empty-ic">👋</div><h3>{x.emptyT}</h3><p>{x.emptyB}</p><button class="btn big" onClick={() => setAdding(true)}>＋ {x.add}</button></div>}
      <div class="plist">
        {invRows.map((i) => (
          <div class={`prow ${needs(i) ? 'attn' : ''}`} key={i.id}>
            <Avatar name={i.email} />
            <div class="pmain">
              <div class="pname">{i.email} {statusChip(i.status, i.id)}</div>
              <div class="psub">
                {flight.has(i.id) ? <span>{x.sendingHint}</span> : i.status === 'not_sent' && i.deliveryError ? <span class="why">{i.deliveryError}</span> : <span>{x.hint[i.status]}</span>}
                <span> · {roleLabel(i.role, i.nodeId)} · {placeName(i.nodeId)}</span>
                <span> · {x.invitedBy} {i.invitedBy ?? '—'}, {ago(i.createdAt, locale)}{i.sentAt && i.deliveryMethod ? ` · ${x.status.sent} ${x.via[i.deliveryMethod]}` : ''}</span>
                {i.gmailThreadId && i.sentAt && <span> · <a class="link" href={`https://mail.google.com/mail/u/0/#all/${i.gmailThreadId}`} target="_blank" rel="noreferrer">{x.openSent}</a></span>}
                {i.status === 'sent' && i.deliveryMethod === 'gmail' && <div class="why soft">{x.notThere}</div>}
              </div>
            </div>
            <div class="pact">
              <button class="btn quiet" disabled={busy === i.id || flight.has(i.id)} onClick={() => void resend(i)}>{busy === i.id ? '…' : flight.has(i.id) ? x.sendingNow : compose ? x.resend : x.newLink}</button>
              <button class="more" aria-label="…" onClick={() => setMenu(menu === i.id ? null : i.id)}>⋯</button>
              {menu === i.id && <div class="menu"><button onClick={() => { setMenu(null); void resend(i, false); }}>{x.newLink}</button><button class="danger" onClick={() => { setMenu(null); void act(() => call('DELETE', `/v1/invitations/${i.id}`)); }}>{x.withdraw}</button></div>}
            </div>
          </div>
        ))}
        {peopleRows.map((p) => (
          <div class={`prow ${p.off ? 'off' : ''}`} key={p.userId}>
            <Avatar name={p.name} />
            <div class="pmain">
              <div class="pname">{p.name} {statusChip(p.off ? 'off' : 'accepted')}{p.userId === me?.id && <span class="you"> (you)</span>}</div>
              <div class="psub">{p.name !== p.email ? p.email : ''}</div>
              <div class="roles">
                {p.roles.map((r) => (
                  <span class="rolechip" key={r.nodeId + r.role}>{roleLabel(r.role, r.nodeId)} · {placeName(r.nodeId)}
                    <button aria-label={x.removeRole} title={x.removeRole} onClick={() => void act(() => call('DELETE', `/v1/org/members?userId=${p.userId}&nodeId=${r.nodeId}&role=${r.role}`))}>×</button></span>
                ))}
              </div>
            </div>
            <div class="pact">
              <button class="btn quiet" onClick={() => setRoleFor(p.userId)}>{x.giveRole}</button>
              {p.userId !== me?.id && <button class="more" aria-label="…" onClick={() => setMenu(menu === p.userId ? null : p.userId)}>⋯</button>}
              {menu === p.userId && <div class="menu"><button class={p.off ? '' : 'danger'} onClick={() => { setMenu(null); void act(() => call('PATCH', `/v1/users/${p.userId}`, { status: p.off ? 'active' : 'disabled' })); }}>{p.off ? x.switchOn : x.switchOff}</button></div>}
            </div>
          </div>
        ))}
        {counts.all > 0 && invRows.length + peopleRows.length === 0 && <p class="muted pad">—</p>}
      </div>
      {toast && <div class="toast2" role="status">{toast}</div>}
      {adding && <AddPerson x={x} locale={locale} places={places} members={members} isTenantAdmin={isTenantAdmin} compose={compose} call={call} email={email} report={report} deliver={deliver} review={review} setReview={setReview} onClose={() => { setAdding(false); void load(); }} reload={load} />}
      {roleFor && <RoleDialog x={x} places={places} person={people.find((p) => p.userId === roleFor)!} isTenantAdmin={isTenantAdmin} roleLabel={(role, t) => (role === 'admin' ? x.roleName.admin[t] : x.roleName[role])} onClose={() => setRoleFor(null)} onSave={async (nodeId, role) => { await act(() => call('POST', '/v1/org/members', { userId: roleFor, nodeId, role })); setRoleFor(null); }} />}
    </div>
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function RoleDialog({ x, places, person, isTenantAdmin, roleLabel, onClose, onSave }: { x: Strs; places: ReturnType<typeof placeList>; person: { name: string }; isTenantAdmin: boolean; roleLabel: (r: string, t: string) => string; onClose: () => void; onSave: (nodeId: string, role: string) => Promise<void> }) {
  const [nodeId, setNodeId] = useState(places.find((p) => p.node.type !== 'tenant')?.node.id ?? places[0]?.node.id ?? '');
  const [role, setRole] = useState('member');
  const t = places.find((p) => p.node.id === nodeId)?.node.type ?? 'partner';
  const locked = role === 'admin' && !isTenantAdmin && t !== 'partner';
  return (
    <div class="mdl-back" onClick={onClose}><div class="mdl small" role="dialog" aria-modal="true" aria-label={x.addRoleT} onClick={(e) => e.stopPropagation()}>
      <h3>{x.addRoleT}: {person.name}</h3>
      <label class="fl">{x.place}<select value={nodeId} onChange={(e) => setNodeId((e.target as HTMLSelectElement).value)}>{places.map((p) => <option value={p.node.id}>{' '.repeat(p.depth * 2)}{p.node.name}</option>)}</select></label>
      <label class="fl">{x.role}<select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value)}>{ROLES.map((r) => <option value={r}>{roleLabel(r, t)}</option>)}</select></label>
      {locked && <p class="why">{x.adminLocked}</p>}
      <div class="mdl-foot"><button class="link" onClick={onClose}>{x.cancel}</button><span class="spacer" /><button class="btn" disabled={!nodeId || locked} onClick={() => void onSave(nodeId, role)}>{x.save}</button></div>
    </div></div>
  );
}

interface Outcome { pending?: boolean; unconfirmed?: boolean; email: string; ok: boolean; via?: 'gmail' | 'link'; error?: string; url?: string; id?: string; skipped?: string }

function AddPerson({ x, locale, places, members, isTenantAdmin, compose, call, email, report, deliver, review, setReview, onClose, reload }: {
  x: Strs; locale: Locale; places: ReturnType<typeof placeList>; members: Member[]; isTenantAdmin: boolean; compose?: ComposeApi; call: Call;
  email: (i: { email: string; role: string; nodeId: string; acceptUrl: string; note?: string; locale?: string }) => { to: string; subject: string; html: string; review?: boolean };
  report: (id: string, method: 'gmail' | 'link', ok: boolean, error?: string, threadId?: string) => Promise<unknown>;
  review: boolean; setReview: (v: boolean) => void;
  deliver: (id: string, mail: { to: string; subject: string; html: string; review?: boolean }) => Promise<{ ok: boolean; error?: string; unconfirmed?: boolean }>;
  onClose: () => void; reload: () => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const [text, setText] = useState('');
  const [nodeId, setNodeId] = useState('');
  const [role, setRole] = useState('member');
  const [viaGmail, setViaGmail] = useState(Boolean(compose));
  const [note, setNote] = useState('');
  const [find, setFind] = useState('');
  const [newPartner, setNewPartner] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const [running, setRunning] = useState(false);
  const [out, setOut] = useState<Outcome[] | null>(null);
  const [placeList2, setPlaces] = useState(places);

  const known = new Set(members.map((m) => m.email.toLowerCase()));
  const parsed = [...new Set((text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []).map((e) => e.toLowerCase()))];
  const dupes = parsed.filter((e) => known.has(e));
  const fresh = parsed.filter((e) => !known.has(e));
  const choice = placeList2.find((p) => p.node.id === nodeId);
  const type = choice?.node.type ?? 'partner';
  const adminLocked = role === 'admin' && !isTenantAdmin && type !== 'partner';
  const roleText = role === 'admin' ? x.roleName.admin[type] : x.roleName[role];
  const visible = placeList2.filter((p) => (p.node.type !== 'tenant' || isTenantAdmin) && (!find.trim() || p.path.toLowerCase().includes(find.trim().toLowerCase())));

  const canNext = step === 0 ? fresh.length > 0 : step === 1 ? Boolean(nodeId) : step === 2 ? !adminLocked : true;

  const createPartner = async () => {
    setErr('');
    try {
      const r = await call('POST', '/v1/org/partners', { name: (newPartner ?? '').trim(), parentId: nodeId });
      const nodes = await call('GET', '/v1/org/nodes'); const links = await call('GET', '/v1/org/links');
      setPlaces(placeList(nodes.nodes, links.links)); setNodeId(r.id); setNewPartner(null);
    } catch (e) { setErr((e as Error).message); }
  };

  const run = async (only?: string[]) => {
    setRunning(true); setErr('');
    const results: Outcome[] = (out ?? []).filter((o) => only && !only.includes(o.email));
    const publish = () => setOut([...results]);
    const todo: { em: string; inv: { id: string; acceptUrl: string } }[] = [];
    // 1. Create every invitation first, so each one is on the list straight away whatever happens to the emails.
    for (const em of only ?? fresh) {
      try {
        const inv = await call('POST', '/v1/invitations', { email: em, nodeId, role, locale });
        if (compose && viaGmail) { results.push({ email: em, ok: true, via: 'gmail', id: inv.id, url: inv.acceptUrl, pending: true }); todo.push({ em, inv }); }
        else results.push({ email: em, ok: true, via: 'link', url: inv.acceptUrl, id: inv.id });
      } catch (e) { results.push({ email: em, ok: false, error: (e as Error).message }); }
      publish();
    }
    void reload();
    // 2. Send them one after another from the person's Gmail, updating each line as it finishes.
    const started = todo.map(({ em, inv }) => ({ em, inv, sent: deliver(inv.id, email({ email: em, role, nodeId, acceptUrl: inv.acceptUrl, note: note.trim() || undefined })) })); // queued at once, sent one at a time
    for (const { em, inv, sent: p } of started) {
      const sent = await p;
      const at = results.findIndex((o) => o.email === em);
      results[at] = sent.ok ? { email: em, ok: true, via: 'gmail', id: inv.id, unconfirmed: sent.unconfirmed } : { email: em, ok: false, error: sent.error ?? 'Not sent', url: inv.acceptUrl, id: inv.id };
      publish();
    }
    setRunning(false); await reload();
  };

  const body = () => {
    if (out) return (
      <div>
        <h3>{x.doneT}</h3>
        {out.map((o) => (
          <div class={`res ${o.pending ? 'info' : o.ok ? (o.via === 'link' ? 'info' : 'ok') : 'bad'}`} key={o.email}>
            <span class="resi">{o.pending ? <i class="spin" /> : o.ok ? (o.via === 'link' ? '🔗' : '✓') : '!'}</span>
            <div><b>{o.email}</b><div class="psub">{o.pending ? x.queued : o.ok ? (o.via === 'gmail' ? (o.unconfirmed ? x.handedOff(o.email) : x.sentOk(o.email)) : x.linkReady) : o.error}</div>
              {o.url && !o.pending && <div class="erow"><input readOnly value={o.url} onFocus={(e) => (e.target as HTMLInputElement).select()} aria-label={x.copy} /><button class="btn quiet" onClick={() => { void navigator.clipboard?.writeText(o.url!).then(() => report(o.id!, 'link', true), () => undefined); }}>{x.copy}</button></div>}
            </div>
          </div>
        ))}
        {!compose && viaGmail && <p class="why">{x.oldExt}</p>}
        {out.some((o) => !o.ok) && <p class="muted">{x.fixLater}</p>}
      </div>
    );
    if (step === 0) return (
      <div><h3>{x.whoT}</h3><p class="muted">{x.whoHelp}</p>
        <textarea class="big-ta" rows={6} placeholder={x.whoPh} value={text} onInput={(e) => setText((e.target as HTMLTextAreaElement).value)} aria-label={x.whoT} />
        <div class="chips">{fresh.map((e) => <span class="rolechip" key={e}>{e}</span>)}</div>
        {dupes.map((e) => <p class="why" key={e}>{x.already(e)}</p>)}
        {text.trim() && parsed.length === 0 && <p class="why">{x.bad}</p>}
      </div>
    );
    if (step === 1) return (
      <div><h3>{x.whereT}</h3><p class="muted">{x.whereHelp}</p>
        <input class="ph-search wide" type="search" placeholder={x.searchPlace} value={find} onInput={(e) => setFind((e.target as HTMLInputElement).value)} aria-label={x.searchPlace} />
        <div class="places" role="radiogroup">
          {visible.map((p) => (
            <button role="radio" aria-checked={nodeId === p.node.id} class={`place ${nodeId === p.node.id ? 'sel' : ''}`} style={{ paddingLeft: `${12 + p.depth * 18}px` }} onClick={() => setNodeId(p.node.id)}>
              <span class="pi">{p.node.type === 'tenant' ? '🏢' : p.node.type === 'location' ? '📍' : '🤝'}</span><span><b>{p.node.type === 'tenant' ? x.company : p.node.name}</b>{p.depth > 1 && !find ? '' : <small>{p.path}</small>}</span>
            </button>
          ))}
        </div>
        {nodeId && choice?.node.type !== 'tenant' && (newPartner === null
          ? <button class="link" onClick={() => setNewPartner('')}>＋ {x.notListed} ({choice?.node.name})</button>
          : <div class="erow"><input placeholder={x.partnerName} value={newPartner} onInput={(e) => setNewPartner((e.target as HTMLInputElement).value)} aria-label={x.partnerName} /><button class="btn" disabled={!newPartner.trim()} onClick={() => void createPartner()}>{x.create}</button><button class="link" onClick={() => setNewPartner(null)}>{x.cancel}</button></div>)}
      </div>
    );
    if (step === 2) return (
      <div><h3>{x.roleT}</h3><p class="muted">{x.roleHelp}</p>
        <div class="rolegrid" role="radiogroup">
          {ROLES.map((r) => {
            const locked = r === 'admin' && !isTenantAdmin && type !== 'partner';
            return <button role="radio" aria-checked={role === r} disabled={locked} class={`rolecard ${role === r ? 'sel' : ''}`} onClick={() => setRole(r)}><b>{r === 'admin' ? x.roleName.admin[type] : x.roleName[r]}</b><small>{locked ? x.adminLocked : x.roleDesc[r]}</small></button>;
          })}
        </div>
      </div>
    );
    return (
      <div><h3>{x.sendT}</h3>
        <div class="rolegrid two" role="radiogroup">
          <button role="radio" aria-checked={viaGmail} class={`rolecard ${viaGmail ? 'sel' : ''}`} onClick={() => setViaGmail(true)}><b>✉️ {x.viaGmail}</b><small>{compose ? x.viaGmailD : x.oldExt}</small></button>
          <button role="radio" aria-checked={!viaGmail} class={`rolecard ${!viaGmail ? 'sel' : ''}`} onClick={() => setViaGmail(false)}><b>🔗 {x.viaLink}</b><small>{x.viaLinkD}</small></button>
        </div>
        {viaGmail && compose && <label class="chk"><input type="checkbox" checked={review} onChange={(e) => setReview((e.target as HTMLInputElement).checked)} /><span><b>{x.reviewL}</b><small>{x.reviewD}</small></span></label>}
        {viaGmail && <label class="fl">{x.noteL}<textarea rows={2} placeholder={x.notePh} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></label>}
        <div class="review">{x.review(fresh.length, choice?.node.type === 'tenant' ? x.company : choice?.node.name ?? '', roleText, viaGmail && Boolean(compose))}</div>
      </div>
    );
  };

  return (
    <div class="mdl-back" onClick={() => (!running || out) && onClose()}>
      <div class="mdl" role="dialog" aria-modal="true" aria-label={x.add} onClick={(e) => e.stopPropagation()}>
        <div class="mdl-top"><b>{x.add}</b><button class="x" aria-label={x.close} onClick={() => (!running || out) && onClose()}>×</button></div>
        {!out && <ol class="steps">{x.step.map((s, i) => <li class={i === step ? 'cur' : i < step ? 'done' : ''}><span>{i < step ? '✓' : i + 1}</span>{s}</li>)}</ol>}
        <div class="mdl-body">{body()}</div>
        {err && <p class="err" role="alert">{err}</p>}
        <div class="mdl-foot">
          {out ? (<>{out.some((o) => !o.ok) && <button class="btn quiet" disabled={running} onClick={() => void run(out.filter((o) => !o.ok).map((o) => o.email))}>{x.retry}</button>}<span class="spacer" /><button class="btn" onClick={onClose}>{running ? x.closeKeep : x.close}</button></>) : (<>
            {step > 0 ? <button class="link" onClick={() => setStep(step - 1)}>{x.back}</button> : <button class="link" onClick={onClose}>{x.cancel}</button>}
            <span class="spacer" />
            {step < 3 ? <button class="btn" disabled={!canNext} onClick={() => setStep(step + 1)}>{x.next}</button> : <button class="btn big" disabled={running || fresh.length === 0 || !nodeId} onClick={() => void run()}>{running ? x.creating : x.send(fresh.length)}</button>}
          </>)}
        </div>
      </div>
    </div>
  );
}
