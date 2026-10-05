import { useEffect, useState } from 'preact/hooks';
import type { ComposeApi, Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Node { id: string; type: 'tenant' | 'location' | 'partner'; name: string; isActive: boolean }
interface Link { parentId: string; childId: string }
interface Member { nodeId: string; role: string; userId: string; email: string; displayName: string | null; status: string }
interface Inv { id: string; email: string; nodeId: string; role: string; expiresAt: string; acceptedAt: string | null }
import { LMS } from './features.ts';
const ROLES = (['admin', 'manager', 'trainer', 'partner', 'learner'] as const).filter((r) => r !== 'learner' && (LMS || r !== 'trainer'));

const X = {
  'en': {
    intro: 'Set up your company, its branches and the partners under them. Each partner only sees its own people and records; the branch above sees everything below it.',
    company: 'Company', rename: 'Rename', save: 'Save', cancel: 'Cancel', addBranch: 'Add a branch', branchName: 'Branch name', add: 'Add',
    addPartner: 'Add a partner here', partnerName: 'Partner name', invite: 'Invite a person', email: 'Email', role: 'Role', sendInvite: 'Create invitation',
    inviteHint: 'Copy this link and send it to the person; it works once and expires in 7 days.', copy: 'Copy link', copied: 'Copied',
    people: 'People', nobody: 'Nobody yet.', off: 'Switch off', on: 'Switch back on', offChip: 'Off', pending: 'Invitations waiting', withdraw: 'Withdraw', remove: 'Remove role',
    disable: 'Switch person off', enable: 'Switch person on', none: 'Nothing set up yet. Start by adding a branch.', branch: 'Branch', partner: 'Partner', tenant: 'Company',
    roles: { admin: 'Admin', manager: 'Manager', trainer: 'Trainer', partner: 'Partner', learner: 'Learner' } as Record<string, string>, expires: 'expires',
    addRole: 'Add role to someone here', person: 'Person', makeRole: 'Give role',
    viaGmail: 'Send it from my Gmail', gmailSent: (e: string) => `Invitation sent to ${e} from your Gmail.`, gmailFailed: 'Gmail did not send it. Copy the link below and send it yourself.',
    subject: (c: string) => `You are invited to ${c} on PII`,
    body: (c: string, who: string, url: string) => `<p>Hello,</p><p>${who} invited you to join <b>${c}</b> on PII by Punjab Insurance.</p><p><a href="${url}">Accept your invitation</a></p><p>This link works once and expires in 7 days.</p>`,
  },
  'fr-CA': {
    intro: 'Configurez votre entreprise, ses succursales et les partenaires qui en relèvent. Chaque partenaire ne voit que ses gens et ses dossiers; la succursale au-dessus voit tout ce qui est en dessous.',
    company: 'Entreprise', rename: 'Renommer', save: 'Enregistrer', cancel: 'Annuler', addBranch: 'Ajouter une succursale', branchName: 'Nom de la succursale', add: 'Ajouter',
    addPartner: 'Ajouter un partenaire ici', partnerName: 'Nom du partenaire', invite: 'Inviter une personne', email: 'Courriel', role: 'Rôle', sendInvite: 'Créer l’invitation',
    inviteHint: 'Copiez ce lien et transmettez-le à la personne; il sert une fois et expire dans 7 jours.', copy: 'Copier le lien', copied: 'Copié',
    people: 'Personnes', nobody: 'Personne pour l’instant.', off: 'Désactiver', on: 'Réactiver', offChip: 'Inactif', pending: 'Invitations en attente', withdraw: 'Retirer', remove: 'Retirer le rôle',
    disable: 'Désactiver la personne', enable: 'Réactiver la personne', none: 'Rien n’est configuré. Commencez par ajouter une succursale.', branch: 'Succursale', partner: 'Partenaire', tenant: 'Entreprise',
    roles: { admin: 'Administrateur', manager: 'Gestionnaire', trainer: 'Formateur', partner: 'Partenaire', learner: 'Apprenant' } as Record<string, string>, expires: 'expire le',
    addRole: 'Donner un rôle à quelqu’un ici', person: 'Personne', makeRole: 'Donner le rôle',
    viaGmail: 'L’envoyer depuis mon Gmail', gmailSent: (e: string) => `Invitation envoyée à ${e} depuis votre Gmail.`, gmailFailed: 'Gmail n’a pas envoyé le message. Copiez le lien ci-dessous et transmettez-le vous-même.',
    subject: (c: string) => `Vous êtes invité à ${c} sur PII`,
    body: (c: string, who: string, url: string) => `<p>Bonjour,</p><p>${who} vous invite à joindre <b>${c}</b> sur PII par Punjab Insurance.</p><p><a href="${url}">Accepter l’invitation</a></p><p>Ce lien sert une seule fois et expire dans 7 jours.</p>`,
  },
};
type Strs = (typeof X)['en'];

export function OrgTab({ call, locale, isTenantAdmin, compose }: { call: Call; locale: Locale; isTenantAdmin: boolean; compose?: ComposeApi }) {
  const x = X[locale];
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<{ id: string; mode: 'rename' | 'partner' } | null>(null);
  const [text, setText] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('partner');
  const [who, setWho] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [branch, setBranch] = useState('');
  const [viaGmail, setViaGmail] = useState(true);
  const [info, setInfo] = useState('');

  const load = async () => {
    try {
      const [n, l, m, i] = await Promise.all([call('GET', '/v1/org/nodes'), call('GET', '/v1/org/links'), call('GET', '/v1/org/members'), call('GET', '/v1/invitations')]);
      setNodes(n.nodes); setLinks(l.links); setMembers(m.members); setInvs((i.invitations as Inv[]).filter((v) => !v.acceptedAt));
    } catch (e) { setErr((e as Error).message); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); setOpen(null); setText(''); setEmail(''); await load(); } catch (e) { setErr((e as Error).message); } };

  const root = nodes.find((n) => n.type === 'tenant');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = (id: string) => links.filter((l) => l.parentId === id && byId.has(l.childId)).map((l) => byId.get(l.childId)!).sort((a, b) => a.name.localeCompare(b.name));
  const hasParent = new Set(links.filter((l) => byId.has(l.parentId) && byId.get(l.parentId)!.type !== 'tenant').map((l) => l.childId));
  const tops = nodes.filter((n) => n.type !== 'tenant' && !hasParent.has(n.id)).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'location' ? -1 : 1));
  const people = [...new Map(members.map((m) => [m.userId, m])).values()];

  const form = (n: Node) => {
    if (!open || open.id !== n.id) return null;
    if (open.mode === 'rename') return <div class="erow"><input aria-label={x.rename} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} /><button class="primary" disabled={!text.trim()} onClick={() => void act(() => call('PATCH', `/v1/org/nodes/${n.id}`, { name: text.trim() }))}>{x.save}</button><button class="link" onClick={() => setOpen(null)}>{x.cancel}</button></div>;
    if (open.mode === 'partner') return <div class="erow"><input placeholder={x.partnerName} aria-label={x.partnerName} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} /><button class="primary" disabled={!text.trim()} onClick={() => void act(() => call('POST', '/v1/org/partners', { name: text.trim(), parentId: n.id }))}>{x.add}</button><button class="link" onClick={() => setOpen(null)}>{x.cancel}</button></div>;
    return null;
  };

  const nodeRow = (n: Node, depth: number): any => {
    const here = members.filter((m) => m.nodeId === n.id);
    const label = n.type === 'location' ? x.branch : n.type === 'partner' ? x.partner : x.company;
    const go = (mode: 'rename' | 'partner') => { setText(mode === 'rename' ? n.name : ''); setOpen({ id: n.id, mode }); };
    return (
      <div key={n.id} class="orgnode" style={{ marginLeft: `${depth * 18}px` }}>
        <div class="erow wrap2">
          <strong>{n.name}</strong> <span class="chip">{label}</span>{!n.isActive && <span class="chip warn">{x.offChip}</span>}
          <span class="spacer" />
          <button class="link" onClick={() => go('rename')}>{x.rename}</button>
          {n.type !== 'tenant' && <button class="link" onClick={() => go('partner')}>{x.addPartner}</button>}
          {n.type !== 'tenant' && <button class="link" onClick={() => void act(() => call('PATCH', `/v1/org/nodes/${n.id}`, { isActive: !n.isActive }))}>{n.isActive ? x.off : x.on}</button>}
        </div>
        {form(n)}
        <details><summary>{x.people} ({here.length})</summary>
          {here.length === 0 && <p class="muted">{x.nobody}</p>}
          {here.map((m) => (
            <div class="erow" key={m.userId + m.role}>
              <span>{m.displayName || m.email} <small class="muted">{m.displayName ? m.email : ''}</small></span><span class="chip">{x.roles[m.role] ?? m.role}</span>{m.status === 'disabled' && <span class="chip warn">{x.offChip}</span>}
              <span class="spacer" />
              <button class="link" onClick={() => void act(() => call('DELETE', `/v1/org/members?userId=${m.userId}&nodeId=${n.id}&role=${m.role}`))}>{x.remove}</button>
              {m.status !== 'invited' && <button class="link" onClick={() => void act(() => call('PATCH', `/v1/users/${m.userId}`, { status: m.status === 'disabled' ? 'active' : 'disabled' }))}>{m.status === 'disabled' ? x.enable : x.disable}</button>}
            </div>
          ))}
        </details>
        {kids(n.id).map((c) => nodeRow(c, depth + 1))}
      </div>
    );
  };

  return (
    <div class="orgtab">
      <p class="muted">{x.intro}</p>
      {err && <p class="err" role="alert">{err}</p>}
      {root && nodeRow(root, 0)}
      {isTenantAdmin && (
        <div class="erow"><input placeholder={x.branchName} aria-label={x.branchName} value={branch} onInput={(e) => setBranch((e.target as HTMLInputElement).value)} /><button class="primary" disabled={!branch.trim()} onClick={() => void act(async () => { await call('POST', '/v1/org/locations', { name: branch.trim() }); setBranch(''); })}>{x.addBranch}</button></div>
      )}
      {tops.length === 0 && <p class="muted">{x.none}</p>}
      {tops.map((n) => nodeRow(n, 1))}
    </div>
  );
}
