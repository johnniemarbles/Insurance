import { useEffect, useMemo, useState } from 'preact/hooks';
import { ErrorBar } from './errorbar.tsx';
import type { HostOptions, Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Step { id: string; done: boolean; hint?: string }
interface Check { steps: Step[]; percent: number; complete: boolean }
interface Item { id: string; kind: 'licence' | 'eo'; label: string; number: string | null; jurisdiction: string | null; lines: string[]; limitAmount: number | null; expiresOn: string | null; notes: string | null; daysLeft: number | null }
interface Doc { id: string; itemId: string | null; kind: string; filename: string; mime: string; sizeBytes: number; createdAt: string }
interface Appt { id: string; carrier: string; status: string; note: string | null }
interface Field { key: string; label: Record<Locale, string>; maxLength: number; options?: string[] }
interface File {
  node: { id: string; name: string }; company?: string; country: 'CA' | 'US'; eoMin: number; checklist: Check; items: Item[]; documents: Doc[]; appointments: Appt[]; canManage?: boolean;
  profile: { entityType: string | null; legalName: string | null; businessNumber: string | null; fields: Record<string, string>; agreementStatus: string; agreementSignedOn: string | null; attestedAt: string | null; status: string; reviewedByName: string | null; reviewNote: string | null } | null;
  options: { entityTypes: string[]; lines: string[]; fields: Field[] };
}

const X = {
  'en': {
    title: 'Compliance', sub: 'Licences, E&O insurance and paperwork for each partner. PII keeps the status and copies of documents, never SIN, SSN or bank details.',
    headTitle: 'Compliance review', headSub: 'Files from every company in this country. You see compliance information only, never CRM records.',
    countries: 'Countries', cTitle: 'All countries', cSub: 'Totals only. Each country is its own server, so you sign in to each once. Partner files stay inside their country.', cSign: 'Sign in', cOff: 'Not signed in', cNo: 'No head-office access in this account', cTotals: (c: number, p: number, w: number, e: number) => `${c} compan${c === 1 ? 'y' : 'ies'} · ${p} partner${p === 1 ? '' : 's'} · ${w} waiting · ${e} expiring`, cOpen: 'Open this country', cRefresh: 'Refresh', cHere: 'You are here', cGo: 'Open this country', cConsent: 'Accept the privacy notice once in this country, then come back.', cSwitch: 'Switch to this country', cErr: 'This country refused the request. Try again, or ask support.',
    companies: 'Companies', newCo: 'Add a company', coName: 'Company name', coAdmin: 'Administrator email', coHelp: 'The administrator is invited by email. They sign in with Google, then set up their branches and partners.', coAdd: 'Create company', coNone: 'No companies yet.', coStat: (p: number, s: number, a: number) => `${p} partner${p === 1 ? '' : 's'} · ${s} waiting · ${a} approved`, invited: 'Not signed in yet', active: 'Active',
    review: 'To review', expiring: 'Expiring', all: 'All partners', search: 'Search partners or companies', none: 'Nothing here.', retry: 'Try again', back: 'All partners',
    status: { incomplete: 'Incomplete', submitted: 'Waiting for review', approved: 'Approved', rejected: 'Sent back' } as Record<string, string>,
    steps: { profile: 'Business profile', licence: 'Licence', eo: 'E&O insurance', attestation: 'Confirm it is true', agreement: 'Partner agreement' } as Record<string, string>,
    limitLow: (n: string) => `Coverage is below the minimum of ${n}`,
    entity: { sole_proprietor: 'Sole proprietor', partnership: 'Partnership', corporation: 'Corporation', llc: 'LLC', s_corp: 'S corporation', other: 'Other' } as Record<string, string>,
    lines: { life: 'Life', accident_sickness: 'Accident and sickness', property_casualty: 'Property and casualty', accident_health: 'Accident and health', property: 'Property', casualty: 'Casualty', variable: 'Variable' } as Record<string, string>,
    kind: 'Kind of business', legal: 'Legal name', bn: { CA: 'Business Number (BN)', US: 'Employer Identification Number (EIN)' }, save: 'Save', saved: 'Saved',
    licences: 'Licences', eoT: 'E&O insurance', add: 'Add', addLicence: 'Add a licence', addEo: 'Add E&O policy', cancel: 'Cancel',
    lType: 'Licence type', lNumber: 'Licence number', place: 'Province or state', lLines: 'Lines of authority', expires: 'Expires', carrier: 'Insurer', policy: 'Policy number', limit: 'Coverage limit', notes: 'Notes',
    docs: 'Documents', upload: 'Upload a PDF, PNG or JPEG (up to 5 MB)', dKind: { eo_certificate: 'E&O certificate', licence: 'Licence', agreement: 'Signed agreement', other: 'Other' } as Record<string, string>, download: 'Open', remove: 'Remove',
    attest: 'I confirm the information and documents here are true and current.', attestBtn: 'I confirm', attestedOn: (d: string) => `Confirmed on ${d}`,
    agreement: 'Partner agreement', agr: { not_sent: 'Not sent', sent: 'Sent for signing', signed: 'Signed' } as Record<string, string>, agrNote: 'Sign it outside PII, then upload the signed copy above and mark it signed.',
    submit: 'Send for review', submitted: 'Sent. Head office will review it.', approve: 'Approve', reject: 'Send back', reason: 'What needs to change?', reviewedBy: (n: string) => `Reviewed by ${n}`,
    appts: 'Carrier appointments', apptHelp: 'Once approved, ask head office to appoint this partner with an insurer.', request: 'Request appointment', apptStatus: { requested: 'Requested', in_progress: 'In progress', appointed: 'Appointed', declined: 'Declined' } as Record<string, string>,
    left: (n: number | null) => (n === null ? '' : n < 0 ? `expired ${-n} d ago` : n === 0 ? 'expires today' : `${n} d left`), next: 'Next expiry', company: 'Company', agreementOpen: 'Agreement not signed', sub1: 'Producer',
    min: (n: string) => `Minimum E&O limit: ${n}`,
  },
  'fr-CA': {
    title: 'Conformité', sub: 'Permis, assurance E&O et documents de chaque partenaire. PII conserve l’état et les copies des documents, jamais le NAS, le SSN ni les données bancaires.',
    headTitle: 'Examen de conformité', headSub: 'Dossiers de toutes les entreprises de ce pays. Vous voyez la conformité seulement, jamais les dossiers du CRM.',
    countries: 'Pays', cTitle: 'Tous les pays', cSub: 'Totaux seulement. Chaque pays est un serveur distinct : connectez-vous à chacun une fois. Les dossiers des partenaires restent dans leur pays.', cSign: 'Se connecter', cOff: 'Non connecté', cNo: 'Aucun accès au siège social avec ce compte', cTotals: (c: number, p: number, w: number, e: number) => `${c} entreprise${c === 1 ? '' : 's'} · ${p} partenaire${p === 1 ? '' : 's'} · ${w} en attente · ${e} à échéance`, cOpen: 'Ouvrir ce pays', cRefresh: 'Actualiser', cHere: 'Vous êtes ici', cGo: 'Ouvrir ce pays', cConsent: 'Acceptez l’avis de confidentialité une fois dans ce pays, puis revenez.', cSwitch: 'Passer à ce pays', cErr: 'Ce pays a refusé la demande. Réessayez ou contactez le soutien.',
    companies: 'Entreprises', newCo: 'Ajouter une entreprise', coName: 'Nom de l’entreprise', coAdmin: 'Courriel de l’administrateur', coHelp: 'L’administrateur est invité par courriel. Il se connecte avec Google, puis configure ses succursales et ses partenaires.', coAdd: 'Créer l’entreprise', coNone: 'Aucune entreprise pour l’instant.', coStat: (p: number, s: number, a: number) => `${p} partenaire${p === 1 ? '' : 's'} · ${s} en attente · ${a} approuvé${a === 1 ? '' : 's'}`, invited: 'Pas encore connecté', active: 'Actif',
    review: 'À examiner', expiring: 'Échéances', all: 'Tous les partenaires', search: 'Chercher un partenaire ou une entreprise', none: 'Rien ici.', retry: 'Réessayer', back: 'Tous les partenaires',
    status: { incomplete: 'Incomplet', submitted: 'En attente d’examen', approved: 'Approuvé', rejected: 'Renvoyé' } as Record<string, string>,
    steps: { profile: 'Profil de l’entreprise', licence: 'Permis', eo: 'Assurance E&O', attestation: 'Confirmer l’exactitude', agreement: 'Entente de partenariat' } as Record<string, string>,
    limitLow: (n: string) => `La garantie est inférieure au minimum de ${n}`,
    entity: { sole_proprietor: 'Travailleur autonome', partnership: 'Société en nom collectif', corporation: 'Société par actions', llc: 'LLC', s_corp: 'S corporation', other: 'Autre' } as Record<string, string>,
    lines: { life: 'Vie', accident_sickness: 'Accidents et maladie', property_casualty: 'Dommages', accident_health: 'Accidents et santé', property: 'Biens', casualty: 'Responsabilité', variable: 'Variable' } as Record<string, string>,
    kind: 'Type d’entreprise', legal: 'Nom légal', bn: { CA: 'Numéro d’entreprise (NE)', US: 'Numéro d’identification d’employeur (EIN)' }, save: 'Enregistrer', saved: 'Enregistré',
    licences: 'Permis', eoT: 'Assurance E&O', add: 'Ajouter', addLicence: 'Ajouter un permis', addEo: 'Ajouter une police E&O', cancel: 'Annuler',
    lType: 'Type de permis', lNumber: 'Numéro de permis', place: 'Province ou État', lLines: 'Catégories d’autorisation', expires: 'Expire le', carrier: 'Assureur', policy: 'Numéro de police', limit: 'Limite de garantie', notes: 'Notes',
    docs: 'Documents', upload: 'Téléverser un PDF, PNG ou JPEG (5 Mo max.)', dKind: { eo_certificate: 'Certificat E&O', licence: 'Permis', agreement: 'Entente signée', other: 'Autre' } as Record<string, string>, download: 'Ouvrir', remove: 'Retirer',
    attest: 'Je confirme que les renseignements et documents ci-joints sont exacts et à jour.', attestBtn: 'Je confirme', attestedOn: (d: string) => `Confirmé le ${d}`,
    agreement: 'Entente de partenariat', agr: { not_sent: 'Non envoyée', sent: 'Envoyée pour signature', signed: 'Signée' } as Record<string, string>, agrNote: 'Signez-la hors de PII, puis téléversez la copie signée ci-dessus et marquez-la signée.',
    submit: 'Envoyer pour examen', submitted: 'Envoyé. Le siège social l’examinera.', approve: 'Approuver', reject: 'Renvoyer', reason: 'Qu’y a-t-il à corriger?', reviewedBy: (n: string) => `Examiné par ${n}`,
    appts: 'Nominations auprès des assureurs', apptHelp: 'Une fois approuvé, demandez au siège social de nommer ce partenaire auprès d’un assureur.', request: 'Demander une nomination', apptStatus: { requested: 'Demandée', in_progress: 'En cours', appointed: 'Nommé', declined: 'Refusée' } as Record<string, string>,
    left: (n: number | null) => (n === null ? '' : n < 0 ? `expiré il y a ${-n} j` : n === 0 ? 'expire aujourd’hui' : `${n} j restants`), next: 'Prochaine échéance', company: 'Entreprise', agreementOpen: 'Entente non signée', sub1: 'Producteur',
    min: (n: string) => `Limite E&O minimale : ${n}`,
  },
};

const tone = (n: number | null) => (n === null ? 'ok' : n < 0 ? 'bad' : n <= 30 ? 'warn' : 'ok');
const money = (n: number, locale: Locale) => new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n);
const b64 = (buf: ArrayBuffer) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
function save(name: string, mime: string, base64: string) {
  const bin = atob(base64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Bar({ pct }: { pct: number }) { return <span class="cbar" role="img" aria-label={`${pct}%`}><i style={{ width: `${pct}%` }} /></span>; }

export function CompliancePage({ call, locale, isHeadOffice, go, host }: { call: Call; locale: Locale; isHeadOffice: boolean; go: (page: string, id?: string) => void; host?: HostOptions }) {
  const [open, setOpen] = useState<string | null>(null);
  return open ? <FileView call={call} locale={locale} nodeId={open} ho={isHeadOffice} back={() => setOpen(null)} /> : <ListView call={call} locale={locale} ho={isHeadOffice} openFile={setOpen} host={host} />;
}

function ListView({ call, locale, ho, openFile, host }: { call: Call; locale: Locale; ho: boolean; openFile: (id: string) => void; host?: HostOptions }) {
  const x = X[locale];
  const base = ho ? '/v1/ho' : '/v1/compliance';
  const [rows, setRows] = useState<any[] | null>(null);
  const [exp, setExp] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'review' | 'all' | 'expiring' | 'companies' | 'countries'>(ho ? 'review' : 'all');
  const [cos, setCos] = useState<any[]>([]);
  const [coName, setCoName] = useState(''); const [coMail, setCoMail] = useState(''); const [coErr, setCoErr] = useState('');
  const loadCos = () => call('GET', '/v1/ho/companies').then((r) => setCos(r.companies), () => undefined);
  const [q, setQ] = useState('');
  const regions = host?.regions ?? [];
  const multi = ho && regions.length > 1;
  useEffect(() => {
    call('GET', `${base}/partners`).then((r) => setRows(r.partners), (e) => setErr((e as Error).message));
    if (ho) { call('GET', '/v1/ho/expiring?days=60').then((r) => setExp(r.items), () => undefined); void loadCos(); }
  }, [call]);
  const shown = useMemo(() => (rows ?? []).filter((r) => (tab !== 'review' || r.status === 'submitted') && `${r.name} ${r.company ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, tab, q]);
  if (err) return <ErrorBar msg={err} retry={x.retry} />;
  if (!rows) return <div class="msg">…</div>;
  const waiting = rows.filter((r) => r.status === 'submitted').length;
  return (
    <div class="home">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{ho ? x.headTitle : x.title}</h2><span class="muted">{ho ? x.headSub : x.sub}</span></div></div>
      {ho && <div class="rstats" role="tablist">
        {([['review', x.review, waiting], ['all', x.all, rows.length], ['expiring', x.expiring, exp.length], ['companies', x.companies, cos.length], ...(multi ? [['countries', x.countries, regions.length] as const] : [])] as const).map(([k, l, n]) => <button role="tab" aria-selected={tab === k} class={`rstat ${k === 'expiring' && n ? 'warn' : ''}`} onClick={() => setTab(k)}><b>{n}</b><span>{l}</span></button>)}
      </div>}
      {tab === 'countries' && host ? <Countries host={host} locale={locale} /> : tab === 'companies' ? (
        <section class="hcard">
          <h3>{x.newCo}</h3>
          <form class="cform" onSubmit={async (e) => { e.preventDefault(); setCoErr(''); try { await call('POST', '/v1/ho/companies', { name: coName, adminEmail: coMail, locale }); setCoName(''); setCoMail(''); await loadCos(); } catch (er) { setCoErr((er as Error).message); } }}>
            <label class="fl">{x.coName}<input required minLength={2} maxLength={120} value={coName} onInput={(e) => setCoName((e.target as HTMLInputElement).value)} /></label>
            <label class="fl">{x.coAdmin}<input required type="email" value={coMail} onInput={(e) => setCoMail((e.target as HTMLInputElement).value)} /></label>
            <button class="btn" type="submit">{x.coAdd}</button>
          </form>
          <p class="muted">{x.coHelp}</p>{coErr && <p class="err" role="alert">{coErr}</p>}
          {cos.length === 0 && <p class="muted">{x.coNone}</p>}
          {cos.map((c) => <div class="erow" key={c.id}><span><b>{c.name}</b> <small class="muted">· {c.adminEmail}</small></span><span class="spacer" /><small class="muted">{x.coStat(c.partners, c.submitted, c.approved)}</small><span class={`chip ${c.adminStatus === 'invited' ? 'warn' : 'ok'}`}>{c.adminStatus === 'invited' ? x.invited : x.active}</span></div>)}
        </section>
      ) : tab === 'expiring' ? (
        <section class="hcard">{exp.length === 0 && <p class="muted">{x.none}</p>}
          {exp.map((i) => <button class="hrow" key={i.itemId} onClick={() => openFile(i.nodeId)}><span class="rname">{i.name} <small class="muted">· {i.company}</small></span><small class="muted">{i.label}</small><span class={`due ${tone(i.daysLeft)}`}>{i.expiresOn} · {x.left(i.daysLeft)}</span></button>)}
        </section>
      ) : (
        <section class="hcard">
          <input type="search" placeholder={x.search} value={q} aria-label={x.search} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ width: '100%', marginBottom: '8px' }} />
          {shown.length === 0 && <p class="muted">{x.none}</p>}
          {shown.map((r) => (
            <button class="hrow" key={r.nodeId ?? r.id} onClick={() => openFile(r.nodeId ?? r.id)}>
              <span class="rname">{r.name}{r.isSub || r.parent ? <span class="chip" style={{ marginLeft: '8px' }}>{x.sub1}</span> : null}{ho && <small class="muted"> · {r.company}</small>}</span>
              <span class="cstat"><Bar pct={r.checklist.percent} /><span class={`chip ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'warn' : ''}`}>{x.status[r.status]}</span></span>
              {r.nextExpiry && <small class="muted">{x.next}: {r.nextExpiry}</small>}
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

function FileView({ call, locale, nodeId, ho, back }: { call: Call; locale: Locale; nodeId: string; ho: boolean; back: () => void }) {
  const x = X[locale];
  const base = ho ? `/v1/ho/partners/${nodeId}` : `/v1/compliance/partners/${nodeId}`;
  const [f, setF] = useState<File | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [adding, setAdding] = useState<'licence' | 'eo' | null>(null);
  const [note, setNote] = useState('');
  const load = () => call('GET', base).then(setF, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [nodeId]);
  const act = async (fn: () => Promise<unknown>, ok = '') => { setErr(''); setMsg(''); try { await fn(); setMsg(ok); await load(); } catch (e) { setErr((e as Error).message); } };
  if (!f) return err ? <ErrorBar msg={err} retry={x.retry} /> : <div class="msg">…</div>;
  const p = f.profile;
  const locked = ho; // head office reads and reviews; it does not edit a partner's file
  const stepText = (s: Step) => (s.hint === 'limit_low' ? x.limitLow(money(f.eoMin, locale)) : '');
  const openDoc = (d: Doc) => act(async () => { const r = await call('GET', `${ho ? '/v1/ho' : '/v1/compliance'}/documents/${d.id}`); save(r.filename, r.mime, r.dataBase64); });
  return (
    <div class="home">
      <div class="erow"><button class="link" onClick={back}>← {x.back}</button></div>
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{f.node.name}</h2><span class="muted">{f.company ? `${f.company} · ` : ''}{x.status[p?.status ?? 'incomplete']}{f.eoMin ? ` · ${x.min(money(f.eoMin, locale))}` : ''}</span></div><Bar pct={f.checklist.percent} /></div>
      {err && <p class="err" role="alert">{err}</p>}{msg && <p class="muted" role="status">{msg}</p>}
      {p?.status === 'rejected' && p.reviewNote && <div class="banner warn" role="alert">{p.reviewedByName ? x.reviewedBy(p.reviewedByName) + ': ' : ''}{p.reviewNote}</div>}
      <section class="hcard"><ol class="csteps">{f.checklist.steps.map((s) => <li class={s.done ? 'done' : ''}><span aria-hidden="true">{s.done ? '✓' : '○'}</span> {x.steps[s.id]}{!s.done && stepText(s) ? <small class="muted"> · {stepText(s)}</small> : null}</li>)}</ol></section>

      <section class="hcard"><h3>{x.steps.profile}</h3><Profile f={f} x={x} locale={locale} locked={locked} onSave={(b) => act(() => call('PUT', `/v1/compliance/partners/${nodeId}/profile`, b), x.saved)} /></section>

      {(['licence', 'eo'] as const).map((k) => (
        <section class="hcard" key={k}>
          <div class="hsec-h"><h3>{k === 'licence' ? x.licences : x.eoT}</h3>{!locked && <button class="link" onClick={() => setAdding(adding === k ? null : k)}>{adding === k ? x.cancel : k === 'licence' ? x.addLicence : x.addEo}</button>}</div>
          {adding === k && <ItemForm kind={k} f={f} x={x} onSave={(b) => act(async () => { await call('POST', `/v1/compliance/partners/${nodeId}/items`, b); setAdding(null); })} />}
          {f.items.filter((i) => i.kind === k).map((i) => (
            <div class="erow" key={i.id}>
              <span><b>{i.label}</b>{i.number ? ` · ${i.number}` : ''}{i.jurisdiction ? ` · ${i.jurisdiction}` : ''}{i.limitAmount !== null ? ` · ${money(i.limitAmount, locale)}` : ''}{i.lines.length ? <small class="muted"> · {i.lines.map((l) => x.lines[l] ?? l).join(', ')}</small> : null}</span>
              <span class="spacer" />{i.expiresOn && <span class={`due ${tone(i.daysLeft)}`}>{i.expiresOn} · {x.left(i.daysLeft)}</span>}
              {!locked && <button class="link" onClick={() => void act(() => call('DELETE', `/v1/compliance/items/${i.id}`))}>{x.remove}</button>}
            </div>
          ))}
        </section>
      ))}

      <section class="hcard"><h3>{x.docs}</h3>
        {!locked && <DocUpload x={x} f={f} onPick={(b) => act(() => call('POST', `/v1/compliance/partners/${nodeId}/documents`, b))} />}
        {f.documents.map((d) => (
          <div class="erow" key={d.id}><span>{d.filename} <small class="muted">· {x.dKind[d.kind]} · {Math.max(1, Math.round(d.sizeBytes / 1024))} KB</small></span><span class="spacer" />
            <button class="link" onClick={() => void openDoc(d)}>{x.download}</button>{!locked && <button class="link" onClick={() => void act(() => call('DELETE', `/v1/compliance/documents/${d.id}`))}>{x.remove}</button>}</div>
        ))}
      </section>

      <section class="hcard"><h3>{x.agreement}</h3>
        <div class="erow"><span class="chip">{x.agr[p?.agreementStatus ?? 'not_sent']}{p?.agreementSignedOn ? ` · ${p.agreementSignedOn.slice(0, 10)}` : ''}</span><span class="spacer" />
          {!locked && f.canManage && (['sent', 'signed', 'not_sent'] as const).filter((s) => s !== (p?.agreementStatus ?? 'not_sent')).map((s) => <button class="btn quiet" onClick={() => void act(() => call('PUT', `/v1/compliance/partners/${nodeId}/agreement`, { status: s }))}>{x.agr[s]}</button>)}</div>
        <p class="muted">{x.agrNote}</p>
      </section>

      {!locked && <section class="hcard"><h3>{x.steps.attestation}</h3>
        {p?.attestedAt ? <p class="muted">{x.attestedOn(new Date(p.attestedAt).toLocaleDateString(locale))}</p> : <><p>{x.attest}</p><button class="btn quiet" onClick={() => void act(() => call('POST', `/v1/compliance/partners/${nodeId}/attest`))}>{x.attestBtn}</button></>}
      </section>}

      {!locked && p?.status !== 'submitted' && p?.status !== 'approved' && <button class="btn big" disabled={!f.checklist.complete} onClick={() => void act(() => call('POST', `/v1/compliance/partners/${nodeId}/submit`), x.submitted)}>{x.submit}</button>}

      {ho && p?.status === 'submitted' && (
        <section class="hcard"><h3>{x.review}</h3>
          <textarea placeholder={x.reason} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} rows={3} style={{ width: '100%' }} />
          <div class="erow"><button class="btn" onClick={() => void act(() => call('POST', `/v1/ho/partners/${nodeId}/review`, { decision: 'approved', note }))}>{x.approve}</button>
            <button class="btn quiet danger" disabled={!note.trim()} onClick={() => void act(() => call('POST', `/v1/ho/partners/${nodeId}/review`, { decision: 'rejected', note }))}>{x.reject}</button></div>
        </section>
      )}

      {(p?.status === 'approved' || f.appointments.length > 0) && (
        <section class="hcard"><h3>{x.appts}</h3>
          {!ho && p?.status === 'approved' && <Appointment x={x} onAsk={(carrier) => act(() => call('POST', `/v1/compliance/partners/${nodeId}/appointments`, { carrier }))} />}
          {f.appointments.map((a) => (
            <div class="erow" key={a.id}><span>{a.carrier}</span><span class="spacer" />
              {ho ? <select value={a.status} aria-label={a.carrier} onChange={(e) => void act(() => call('PUT', `/v1/ho/appointments/${a.id}`, { status: (e.target as HTMLSelectElement).value }))}>{Object.entries(x.apptStatus).map(([k, v]) => <option value={k}>{v}</option>)}</select> : <span class="chip">{x.apptStatus[a.status]}</span>}</div>
          ))}
        </section>
      )}
    </div>
  );
}

function Profile({ f, x, locale, locked, onSave }: { f: File; x: typeof X['en']; locale: Locale; locked: boolean; onSave: (b: unknown) => void }) {
  const p = f.profile;
  const [entityType, setE] = useState(p?.entityType ?? '');
  const [legalName, setL] = useState(p?.legalName ?? '');
  const [businessNumber, setB] = useState(p?.businessNumber ?? '');
  const [fields, setF] = useState<Record<string, string>>(p?.fields ?? {});
  return (
    <form class="cform" onSubmit={(e) => { e.preventDefault(); onSave({ entityType: entityType || null, legalName, businessNumber, fields }); }}>
      <label class="fl">{x.kind}<select disabled={locked} value={entityType} onChange={(e) => setE((e.target as HTMLSelectElement).value)}><option value="" />{f.options.entityTypes.map((t) => <option value={t}>{x.entity[t] ?? t}</option>)}</select></label>
      <label class="fl">{x.legal}<input disabled={locked} maxLength={200} value={legalName} onInput={(e) => setL((e.target as HTMLInputElement).value)} /></label>
      <label class="fl">{x.bn[f.country]}<input disabled={locked} maxLength={40} value={businessNumber} onInput={(e) => setB((e.target as HTMLInputElement).value)} /></label>
      {f.options.fields.map((fd) => (
        <label class="fl" key={fd.key}>{fd.label[locale]}
          {fd.options ? <select disabled={locked} value={fields[fd.key] ?? ''} onChange={(e) => setF({ ...fields, [fd.key]: (e.target as HTMLSelectElement).value })}><option value="" />{fd.options.map((o) => <option value={o}>{o}</option>)}</select>
            : <input disabled={locked} maxLength={fd.maxLength} value={fields[fd.key] ?? ''} onInput={(e) => setF({ ...fields, [fd.key]: (e.target as HTMLInputElement).value })} />}
        </label>
      ))}
      {!locked && <button class="btn quiet" type="submit">{x.save}</button>}
    </form>
  );
}

function ItemForm({ kind, f, x, onSave }: { kind: 'licence' | 'eo'; f: File; x: typeof X['en']; onSave: (b: unknown) => void }) {
  const [label, setLabel] = useState(''); const [number, setNumber] = useState(''); const [jurisdiction, setJ] = useState('');
  const [lines, setLines] = useState<string[]>([]); const [limit, setLimit] = useState(''); const [expiresOn, setX] = useState('');
  const ok = label.trim() && (kind === 'licence' || limit !== '');
  return (
    <form class="cform" onSubmit={(e) => { e.preventDefault(); if (ok) onSave({ kind, label, number: number || null, jurisdiction: jurisdiction || null, lines, limitAmount: kind === 'eo' ? Number(limit) : null, expiresOn: expiresOn || null }); }}>
      <label class="fl">{kind === 'licence' ? x.lType : x.carrier}<input required maxLength={120} value={label} onInput={(e) => setLabel((e.target as HTMLInputElement).value)} /></label>
      <label class="fl">{kind === 'licence' ? x.lNumber : x.policy}<input maxLength={60} value={number} onInput={(e) => setNumber((e.target as HTMLInputElement).value)} /></label>
      {kind === 'licence' && <label class="fl">{x.place}<input maxLength={40} value={jurisdiction} onInput={(e) => setJ((e.target as HTMLInputElement).value)} /></label>}
      {kind === 'eo' && <label class="fl">{x.limit}<input required type="number" min={0} value={limit} onInput={(e) => setLimit((e.target as HTMLInputElement).value)} /></label>}
      <label class="fl">{x.expires}<input type="date" value={expiresOn} onInput={(e) => setX((e.target as HTMLInputElement).value)} /></label>
      {kind === 'licence' && <fieldset class="fl"><legend>{x.lLines}</legend>{f.options.lines.map((l) => <label class="chk"><input type="checkbox" checked={lines.includes(l)} onChange={(e) => setLines((e.target as HTMLInputElement).checked ? [...lines, l] : lines.filter((z) => z !== l))} /> {x.lines[l] ?? l}</label>)}</fieldset>}
      <button class="btn" type="submit" disabled={!ok}>{x.add}</button>
    </form>
  );
}

function DocUpload({ x, f, onPick }: { x: typeof X['en']; f: File; onPick: (b: unknown) => void }) {
  const [kind, setKind] = useState('eo_certificate');
  const [big, setBig] = useState(false);
  return (
    <div class="erow">
      <select aria-label={x.docs} value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value)}>{Object.entries(x.dKind).map(([k, v]) => <option value={k}>{v}</option>)}</select>
      <label class="btn quiet" style={{ cursor: 'pointer' }}>{x.upload}
        <input type="file" accept="application/pdf,image/png,image/jpeg" hidden onChange={async (e) => {
          const file = (e.target as HTMLInputElement).files?.[0]; (e.target as HTMLInputElement).value = '';
          if (!file) return; if (file.size > 5 * 1024 * 1024) { setBig(true); return; } setBig(false);
          onPick({ kind, filename: file.name, dataBase64: b64(await file.arrayBuffer()), itemId: null });
        }} /></label>
      {big && <span class="err" role="alert">5 MB</span>}
    </div>
  );
}

function Appointment({ x, onAsk }: { x: typeof X['en']; onAsk: (carrier: string) => void }) {
  const [c, setC] = useState('');
  return (
    <form class="erow" onSubmit={(e) => { e.preventDefault(); if (c.trim()) { onAsk(c.trim()); setC(''); } }}>
      <input placeholder={x.carrier} maxLength={120} value={c} onInput={(e) => setC((e.target as HTMLInputElement).value)} aria-label={x.carrier} />
      <button class="btn quiet" type="submit" disabled={!c.trim()}>{x.request}</button>
      <small class="muted">{x.apptHelp}</small>
    </form>
  );
}

interface Totals { state: 'loading' | 'out' | 'no' | 'consent' | 'err' | 'ok'; companies: number; partners: number; waiting: number; expiring: number }

/** Main Admin view: one row per country with totals only. Each country is its own server and login, so each is asked separately. */
function Countries({ host, locale }: { host: HostOptions; locale: Locale }) {
  const x = X[locale];
  const regions = host.regions ?? [];
  const [t, setT] = useState<Record<string, Totals>>({});
  const load = () => regions.forEach(async (r) => {
    const ask = (path: string) => host.transport('GET', path, undefined, r.id);
    setT((o) => ({ ...o, [r.id]: { state: 'loading', companies: 0, partners: 0, waiting: 0, expiring: 0 } }));
    const me = await ask('/v1/me');
    if (me.status === 401 || me.status === 0 || me.status === -1) return setT((o) => ({ ...o, [r.id]: { state: 'out', companies: 0, partners: 0, waiting: 0, expiring: 0 } }));
    if (me.status === 200 && me.json?.needsConsent) return setT((o) => ({ ...o, [r.id]: { state: 'consent', companies: 0, partners: 0, waiting: 0, expiring: 0 } }));
    if (me.status !== 200 || !me.json?.isHeadOffice) return setT((o) => ({ ...o, [r.id]: { state: 'no', companies: 0, partners: 0, waiting: 0, expiring: 0 } }));
    const [co, ex] = await Promise.all([ask('/v1/ho/companies'), ask('/v1/ho/expiring?days=60')]);
    if (co.status !== 200 || ex.status !== 200) return setT((o) => ({ ...o, [r.id]: { state: 'err', companies: 0, partners: 0, waiting: 0, expiring: 0 } }));
    const list: any[] = co.json?.companies ?? [];
    setT((o) => ({ ...o, [r.id]: { state: 'ok', companies: list.length, partners: list.reduce((a, c) => a + c.partners, 0), waiting: list.reduce((a, c) => a + c.submitted, 0), expiring: (ex.json?.items ?? []).length } }));
  });
  useEffect(() => { load(); }, []);
  return (
    <section class="hcard">
      <h3>{x.cTitle}</h3>
      <p class="muted">{x.cSub}</p>
      {regions.map((r) => {
        const v = t[r.id];
        return (
          <div class="erow" key={r.id}>
            <span><b>{r.label}</b>{r.id === host.region && <span class="chip ok" style={{ marginLeft: '8px' }}>{x.cHere}</span>}</span><span class="spacer" />
            {!v || v.state === 'loading' ? <small class="muted">…</small>
              : v.state === 'ok' ? <><small class="muted">{x.cTotals(v.companies, v.partners, v.waiting, v.expiring)}</small>{r.id !== host.region && host.switchRegion && <button class="btn" onClick={() => host.switchRegion!(r.id)}>{x.cGo}</button>}</>
              : v.state === 'consent' ? <><small class="muted">{x.cConsent}</small><button class="btn" onClick={() => host.onSignIn(r.id)}>{x.cSwitch}</button></>
              : v.state === 'err' ? <small class="muted">{x.cErr}</small>
              : v.state === 'no' ? <small class="muted">{x.cNo}</small>
              : <><span class="chip warn">{x.cOff}</span><button class="btn" onClick={() => host.onSignIn(r.id, true)}>{x.cSign}</button></>}
          </div>
        );
      })}
      <p><button class="btn" onClick={load}>{x.cRefresh}</button></p>
    </section>
  );
}
