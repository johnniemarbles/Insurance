import { useEffect, useState } from 'preact/hooks';
import type { ComposeApi, Locale } from './types.ts';

// The one Structure page (plan v7, section 1). Every role sees the same tree; the buttons on each place are the ones the
// signed-in person may use there. The server enforces every rule; this page only hides what is not allowed.

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Node { id: string; type: 'tenant' | 'location' | 'partner'; name: string; isActive: boolean }
interface Link { parentId: string; childId: string }
interface Member { nodeId: string; role: string; userId: string; email: string; displayName: string | null; status: string }
interface Inv { id: string; email: string; nodeId: string; role: string; expiresAt: string; acceptedAt: string | null }
interface Role { nodeId: string; role: string }

const X = {
  'en': {
    intro: 'Set up your company, its branches and the brokers under them. Each broker only sees its own people and records; the branch above sees everything below it.',
    company: 'Company', rename: 'Rename', save: 'Save', cancel: 'Cancel', addBranch: 'Add a branch', branchName: 'Branch name', add: 'Add',
    addPerson: 'Add person', addBroker: 'Add broker', off: 'Switch off', on: 'Switch back on', offChip: 'Off',
    people: 'People', nobody: 'Nobody yet.', remove: 'Remove role', disable: 'Switch person off', enable: 'Switch person on',
    none: 'Nothing set up yet. Start by adding a branch.', branch: 'Branch', partner: 'Broker', tenant: 'Company',
    roles: { admin: 'Admin', manager: 'Manager', trainer: 'Trainer', partner: 'Partner', learner: 'Learner', compliance: 'Compliance', auditor: 'Auditor', staff: 'Staff' } as Record<string, string>,
    searchPeople: 'Search people by name or email', found: 'Found', notFound: 'Not in the company yet. Invite them.', chooseRole: 'Role', giveRole: 'Give role',
    done: 'Done', email: 'Email', sendInvite: 'Create invitation', copy: 'Copy link', copied: 'Copied',
    inviteHint: 'Copy this link and send it to the person; it works once and expires in 7 days.',
    searchBrokers: 'Search brokers by name or administrator email', brokerFound: 'Already in the company', startFile: 'Start its file', inOnboarding: 'In onboarding',
    newBroker: 'Not in the company yet? Add it as a new broker', brokerName: 'Broker name (not an email)', type: 'Type', individual: 'Individual', corporate: 'Corporation',
    adminEmail: 'Email of the broker’s administrator', createBroker: 'Add broker and start its file',
    brokerAdded: (e: string) => `Broker added. The administrator is invited at ${e}.`, invitedNotSent: 'The invitation was not sent. Copy the link from the Compliance page.',
    needName: 'Enter the broker’s business name.', needEmail: 'Enter a valid email address.', tryAgain: 'Try again',
  },
  'fr-CA': {
    intro: 'Configurez votre entreprise, ses succursales et les courtiers qui en relèvent. Chaque courtier ne voit que ses gens et ses dossiers; la succursale au-dessus voit tout ce qui est en dessous.',
    company: 'Entreprise', rename: 'Renommer', save: 'Enregistrer', cancel: 'Annuler', addBranch: 'Ajouter une succursale', branchName: 'Nom de la succursale', add: 'Ajouter',
    addPerson: 'Ajouter une personne', addBroker: 'Ajouter un courtier', off: 'Désactiver', on: 'Réactiver', offChip: 'Inactif',
    people: 'Personnes', nobody: 'Personne pour l’instant.', remove: 'Retirer le rôle', disable: 'Désactiver la personne', enable: 'Réactiver la personne',
    none: 'Rien n’est configuré. Commencez par ajouter une succursale.', branch: 'Succursale', partner: 'Courtier', tenant: 'Entreprise',
    roles: { admin: 'Administrateur', manager: 'Gestionnaire', trainer: 'Formateur', partner: 'Partenaire', learner: 'Apprenant', compliance: 'Conformité', auditor: 'Auditeur', staff: 'Personnel' } as Record<string, string>,
    searchPeople: 'Rechercher une personne par nom ou courriel', found: 'Trouvé', notFound: 'Pas encore dans l’entreprise. Invitez-la.', chooseRole: 'Rôle', giveRole: 'Donner le rôle',
    done: 'Terminé', email: 'Courriel', sendInvite: 'Créer l’invitation', copy: 'Copier le lien', copied: 'Copié',
    inviteHint: 'Copiez ce lien et transmettez-le à la personne; il sert une fois et expire dans 7 jours.',
    searchBrokers: 'Rechercher un courtier par nom ou courriel de l’administrateur', brokerFound: 'Déjà dans l’entreprise', startFile: 'Démarrer son dossier', inOnboarding: 'En intégration',
    newBroker: 'Pas encore dans l’entreprise? Ajoutez-le comme nouveau courtier', brokerName: 'Nom du courtier (pas un courriel)', type: 'Type', individual: 'Particulier', corporate: 'Société',
    adminEmail: 'Courriel de l’administrateur du courtier', createBroker: 'Ajouter le courtier et démarrer son dossier',
    brokerAdded: (e: string) => `Courtier ajouté. L’administrateur est invité à ${e}.`, invitedNotSent: 'L’invitation n’a pas été envoyée. Copiez le lien depuis la page Conformité.',
    needName: 'Saisissez le nom d’affaires du courtier.', needEmail: 'Saisissez un courriel valide.', tryAgain: 'Réessayer',
  },
};
type Strs = (typeof X)['en'];
const msg = (e: unknown) => (e as Error).message;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Walks up the tree: is `id` this node or somewhere beneath it? */
function within(id: string, ancestor: string, parentOf: Map<string, string>): boolean {
  let cur: string | undefined = id;
  for (let i = 0; cur && i < 20; i++) {
    if (cur === ancestor) return true;
    cur = parentOf.get(cur);
  }
  return false;
}

export function OrgTab({ call, locale, isTenantAdmin }: { call: Call; locale: Locale; isTenantAdmin: boolean; compose?: ComposeApi }) {
  const x = X[locale];
  const [nodes, setNodes] = useState<Node[]>([]);
  const [links, setLinks] = useState<Link[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [invs, setInvs] = useState<Inv[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<{ id: string; mode: 'rename' | 'person' | 'broker' } | null>(null);
  const [text, setText] = useState('');
  const [branch, setBranch] = useState('');

  const load = async () => {
    try {
      const [n, l, m, i, me] = await Promise.all([call('GET', '/v1/org/nodes'), call('GET', '/v1/org/links'), call('GET', '/v1/org/members'), call('GET', '/v1/invitations'), call('GET', '/v1/me')]);
      setNodes(n.nodes); setLinks(l.links); setMembers(m.members); setInvs((i.invitations as Inv[]).filter((v) => !v.acceptedAt));
      setRoles((me.roles ?? []) as Role[]);
    } catch (e) { setErr(msg(e)); }
  };
  useEffect(() => { void load(); }, []);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); setOpen(null); setText(''); await load(); } catch (e) { setErr(msg(e)); } };

  const root = nodes.find((n) => n.type === 'tenant');
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parentOf = new Map(links.map((l) => [l.childId, l.parentId]));
  const kids = (id: string) => links.filter((l) => l.parentId === id && byId.has(l.childId)).map((l) => byId.get(l.childId)!).sort((a, b) => a.name.localeCompare(b.name));
  const hasParent = new Set(links.filter((l) => byId.has(l.parentId) && byId.get(l.parentId)!.type !== 'tenant').map((l) => l.childId));
  const tops = nodes.filter((n) => n.type !== 'tenant' && !hasParent.has(n.id)).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'location' ? -1 : 1));

  // The buttons a person sees on a place. The server still checks each action.
  const canAddPerson = (n: Node) => n.type === 'location' && (isTenantAdmin || roles.some((r) => r.role === 'manager' && within(n.id, r.nodeId, parentOf)));
  const canAddBroker = (n: Node) => n.type === 'location' && roles.some((r) => r.role === 'compliance' && within(n.id, r.nodeId, parentOf));

  const renameForm = (n: Node) => (
    <div class="erow"><input aria-label={x.rename} value={text} onInput={(e) => setText((e.target as HTMLInputElement).value)} /><button class="primary" disabled={!text.trim()} onClick={() => void act(() => call('PATCH', `/v1/org/nodes/${n.id}`, { name: text.trim() }))}>{x.save}</button><button class="link" onClick={() => setOpen(null)}>{x.cancel}</button></div>
  );

  const nodeRow = (n: Node, depth: number): any => {
    const here = members.filter((m) => m.nodeId === n.id);
    const label = n.type === 'location' ? x.branch : n.type === 'partner' ? x.partner : x.company;
    const go = (mode: 'rename' | 'person' | 'broker') => { setText(mode === 'rename' ? n.name : ''); setOpen({ id: n.id, mode }); };
    const panelOpen = open && open.id === n.id;
    return (
      <div key={n.id} class="orgnode" style={{ marginLeft: `${depth * 18}px` }}>
        <div class="erow wrap2">
          <strong>{n.name}</strong> <span class="chip">{label}</span>{!n.isActive && <span class="chip warn">{x.offChip}</span>}
          <span class="spacer" />
          <button class="link" onClick={() => go('rename')}>{x.rename}</button>
          {canAddPerson(n) && <button class="link" onClick={() => go('person')}>{x.addPerson}</button>}
          {canAddBroker(n) && <button class="link" onClick={() => go('broker')}>{x.addBroker}</button>}
          {n.type !== 'tenant' && <button class="link" onClick={() => void act(() => call('PATCH', `/v1/org/nodes/${n.id}`, { isActive: !n.isActive }))}>{n.isActive ? x.off : x.on}</button>}
        </div>
        {panelOpen && open.mode === 'rename' && renameForm(n)}
        {panelOpen && open.mode === 'person' && <AddPersonPanel call={call} x={x} locale={locale} node={n} onDone={() => { setOpen(null); void load(); }} onCancel={() => setOpen(null)} />}
        {panelOpen && open.mode === 'broker' && <AddBrokerPanel call={call} x={x} node={n} onDone={() => { setOpen(null); void load(); }} onCancel={() => setOpen(null)} />}
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
      {invs.length > 0 && <p class="muted">{invs.length} {invs.length === 1 ? 'invitation waiting' : 'invitations waiting'}</p>}
    </div>
  );
}

/** Add person (plan v7, section 4). Search first: a person found gets a role here; someone new is invited. One form. */
function AddPersonPanel({ call, x, locale, node, onDone, onCancel }: { call: Call; x: Strs; locale: Locale; node: Node; onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; email: string; displayName: string | null }[]>([]);
  const [picked, setPicked] = useState<{ id: string; email: string; displayName: string | null } | null>(null);
  const [offered, setOffered] = useState<string[]>([]);
  const [role, setRole] = useState('');
  const [email, setEmail] = useState('');
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void call('GET', `/v1/org/places/${node.id}/roles`).then((r) => { setOffered(r.roles ?? []); setRole((r.roles ?? [])[0] ?? ''); }, (e) => setErr(msg(e)));
  }, [node.id]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setFound([]); return; }
      void call('GET', `/v1/users?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.users ?? []), () => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const giveRole = async () => {
    if (!picked) return;
    setBusy(true); setErr('');
    try { await call('POST', '/v1/org/members', { userId: picked.id, nodeId: node.id, role }); onDone(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const invite = async () => {
    setBusy(true); setErr('');
    try {
      const r = await call('POST', '/v1/invitations', { email: email.trim().toLowerCase(), nodeId: node.id, role, locale });
      setLink(r.acceptUrl ?? '');
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const copy = () => { void navigator.clipboard?.writeText(link); };

  return (
    <div class="obinvite" role="group" aria-label={x.addPerson}>
      <b>{x.addPerson} · {node.name}</b>
      {err && <div class="err" role="alert">{err}</div>}
      <label class="fl">{x.searchPeople}
        <input type="search" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setPicked(null); setLink(''); }} />
      </label>
      {!picked && found.map((u) => (
        <button key={u.id} class="link" onClick={() => setPicked(u)}>{x.found}: {u.displayName || u.email} <small class="muted">{u.email}</small></button>
      ))}
      {picked && (
        <div class="erow">
          <span>{picked.displayName || picked.email}</span>
          <label class="fl">{x.chooseRole}
            <select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value)}>
              {offered.map((r) => <option key={r} value={r}>{x.roles[r] ?? r}</option>)}
            </select>
          </label>
          <button class="primary" disabled={busy || !role} onClick={() => void giveRole()}>{x.giveRole}</button>
        </div>
      )}
      {!picked && q.trim().length >= 2 && found.length === 0 && !link && (
        <div>
          <p class="muted">{x.notFound}</p>
          <label class="fl">{x.email}<input type="email" value={email || (q.includes('@') ? q.trim() : '')} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} /></label>
          <label class="fl">{x.chooseRole}
            <select value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value)}>
              {offered.map((r) => <option key={r} value={r}>{x.roles[r] ?? r}</option>)}
            </select>
          </label>
          <button class="primary" disabled={busy || !role || !EMAIL.test((email || (q.includes('@') ? q.trim() : '')).trim())} onClick={() => void invite()}>{x.sendInvite}</button>
        </div>
      )}
      {link && (
        <div class="banner" role="status">
          <p>{x.inviteHint}</p>
          <input readOnly value={link} aria-label={x.inviteHint} onFocus={(e) => (e.target as HTMLInputElement).select()} />
          <button class="link" onClick={copy}>{x.copy}</button>
          <button class="primary" onClick={onDone}>{x.done}</button>
        </div>
      )}
      <button class="link" onClick={onCancel}>{x.cancel}</button>
    </div>
  );
}

/** Add broker (plan v7, section 5). Search first; a broker found is started, a new one is added with its file in one call. */
function AddBrokerPanel({ call, x, node, onDone, onCancel }: { call: Call; x: Strs; node: Node; onDone: () => void; onCancel: () => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<{ id: string; name: string; caseId: string | null }[]>([]);
  const [name, setName] = useState('');
  const [type, setType] = useState<'individual' | 'corporate'>('individual');
  const [adminEmail, setAdminEmail] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (q.trim().length < 2) { setFound([]); return; }
      void call('GET', `/v1/onboarding/brokers/search?q=${encodeURIComponent(q.trim())}`).then((r) => setFound(r.brokers ?? []), () => setFound([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const start = async (id: string) => {
    setBusy(true); setErr('');
    try { await call('POST', '/v1/onboarding/cases', { nodeId: id }); onDone(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };
  const add = async () => {
    setErr('');
    if (name.trim().length < 2) return setErr(x.needName);
    if (name.includes('@')) return setErr(x.needName);
    if (!EMAIL.test(adminEmail.trim())) return setErr(x.needEmail);
    setBusy(true);
    try {
      const r = await call('POST', '/v1/onboarding/brokers', { name: name.trim(), parentId: node.id, type, adminEmail: adminEmail.trim().toLowerCase() });
      const sent = r.invitation?.status === 'sent';
      setNote(sent ? x.brokerAdded(r.invitation.email) : x.invitedNotSent);
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };

  return (
    <div class="obinvite" role="group" aria-label={x.addBroker}>
      <b>{x.addBroker} · {node.name}</b>
      {err && <div class="err" role="alert">{err}</div>}
      <label class="fl">{x.searchBrokers}
        <input type="search" value={q} onInput={(e) => { setQ((e.target as HTMLInputElement).value); setNote(''); }} />
      </label>
      {found.map((b) => (
        <div class="erow" key={b.id}>
          <span>{b.name}</span>
          {b.caseId ? <span class="chip">{x.inOnboarding}</span> : <button class="link" disabled={busy} onClick={() => void start(b.id)}>{x.startFile}</button>}
        </div>
      ))}
      {q.trim().length >= 2 && found.length === 0 && !note && (
        <div>
          <p class="muted">{x.newBroker}</p>
          <label class="fl">{x.brokerName}<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
          <label class="fl">{x.type}
            <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as 'individual' | 'corporate')}>
              <option value="individual">{x.individual}</option>
              <option value="corporate">{x.corporate}</option>
            </select>
          </label>
          <label class="fl">{x.adminEmail}<input type="email" value={adminEmail} onInput={(e) => setAdminEmail((e.target as HTMLInputElement).value)} /></label>
          <button class="primary" disabled={busy} onClick={() => void add()}>{x.createBroker}</button>
        </div>
      )}
      {note && <div class="banner" role="status">{note} <button class="primary" onClick={onDone}>OK</button></div>}
      <button class="link" onClick={onCancel}>{x.cancel}</button>
    </div>
  );
}
