import { docLabel } from './doctypes.ts';
import { VendorPanel } from './vendors.tsx';
import { VaultPanel } from './vault.tsx';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ErrorBar } from './errorbar.tsx';
import type { HostOptions, Locale } from './types.ts';
import { ExpiryBars, Funnel, needsOf, NeedsYou, titles, Trend, Widgets, type Insights, type NeedTab } from './hoinsights.tsx';

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
    connectL: (l: string) => `Connect ${l}`, noticeL: (l: string) => `Accept the ${l} privacy notice`, noticeT: 'Privacy notice', noticeOk: 'I accept', noticeErr: 'Could not load the notice. Try again.',
    jumpN: (n: number) => `${n} ${n === 1 ? 'result' : 'results'}`, jump: 'Jump to a company or partner', jumpNone: 'No match', jCo: 'Company', jPa: 'Partner',
    title: 'Compliance', sub: 'Licences, E&O insurance and paperwork for each partner. PII keeps the status and copies of documents, never SIN, SSN or bank details.',
    headTitle: 'Compliance review', headSub: 'Files from every company in this country. You see compliance information only, never CRM records.',
    allC: 'All countries', allCos: 'All companies', headSubC: (c: string) => `Compliance files for ${c}. You see compliance only, never CRM records.`, chooseSub: 'Choose a country or a company to open its files.', calmReview: 'All caught up', calmReviewSub: 'No files are waiting for review.', calmAll: 'No partners yet', calmAllSub: 'Partners appear here once a company adds them.', calmExp: 'Nothing expiring soon', calmExpSub: 'No licence or E&O policy runs out in the next 60 days.', hPartners: 'Partners', hWaiting: 'Waiting for review', hExpiring: 'Expiring in 60 days', hCompanies: 'Companies', cTot: (c: number, split: string) => `${c} compan${c === 1 ? 'y' : 'ies'} ${split}`, cCo: (n: number) => `${n} compan${n === 1 ? 'y' : 'ies'}`, cWait: (n: number) => `${n} waiting`, cExp: (n: number) => `${n} expiring`, cPart: (n: number) => `${n} partner${n === 1 ? '' : 's'}`, addTo: 'Country', coIn: (c: string) => `Companies in ${c}`, showing: 'Showing', clear: 'Show all',
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
    connectL: (l: string) => `Se connecter : ${l}`, noticeL: (l: string) => `Accepter l’avis de confidentialité : ${l}`, noticeT: 'Avis de confidentialité', noticeOk: 'J’accepte', noticeErr: 'Impossible de charger l’avis. Réessayez.',
    jumpN: (n: number) => `${n} ${n === 1 ? 'résultat' : 'résultats'}`, jump: 'Aller à une entreprise ou un partenaire', jumpNone: 'Aucun résultat', jCo: 'Entreprise', jPa: 'Partenaire',
    title: 'Conformité', sub: 'Permis, assurance E&O et documents de chaque partenaire. PII conserve l’état et les copies des documents, jamais le NAS, le SSN ni les données bancaires.',
    headTitle: 'Examen de conformité', headSub: 'Dossiers de toutes les entreprises de ce pays. Vous voyez la conformité seulement, jamais les dossiers du CRM.',
    allC: 'Tous les pays', allCos: 'Toutes les entreprises', headSubC: (c: string) => `Dossiers de conformité : ${c}. Vous voyez la conformité seulement, jamais les dossiers du CRM.`, chooseSub: 'Choisissez un pays ou une entreprise pour ouvrir ses dossiers.', calmReview: 'Tout est à jour', calmReviewSub: 'Aucun dossier n’attend d’examen.', calmAll: 'Aucun partenaire pour l’instant', calmAllSub: 'Les partenaires apparaissent ici dès qu’une entreprise les ajoute.', calmExp: 'Aucune échéance proche', calmExpSub: 'Aucun permis ni aucune police E&O n’expire d’ici 60 jours.', hPartners: 'Partenaires', hWaiting: 'En attente d’examen', hExpiring: 'À échéance dans 60 jours', hCompanies: 'Entreprises', cTot: (c: number, split: string) => `${c} entreprise${c === 1 ? '' : 's'} ${split}`, cCo: (n: number) => `${n} entreprise${n === 1 ? '' : 's'}`, cWait: (n: number) => `${n} en attente`, cExp: (n: number) => `${n} à échéance`, cPart: (n: number) => `${n} partenaire${n === 1 ? '' : 's'}`, addTo: 'Pays', coIn: (c: string) => `Entreprises : ${c}`, showing: 'Affichage', clear: 'Tout afficher',
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
  return open ? <FileView call={call} locale={locale} nodeId={open} ho={isHeadOffice} back={() => setOpen(null)} /> : <><ListView call={call} locale={locale} ho={isHeadOffice} openFile={setOpen} host={host} />{!isHeadOffice && <><Overview call={call} locale={locale} /><NotCleared call={call} locale={locale} /><FilesAtRisk call={call} locale={locale} go={go} /><RetentionPanel call={call} locale={locale} /><VendorPanel call={call} locale={locale} /><VaultPanel call={call} locale={locale} /></>}</>;
}

const OV = {
  'en': { h: 'Today at a glance', expiring90: 'Expiring in 90 days', expired: 'Expired', waivers90d: 'Waivers (90 days)', withdrawals30d: 'Consent withdrawals (30 days)', openHolds: 'Open legal holds', cashReportsDue: 'Cash reports due', openScreeningHits: 'Open screening hits', note: 'Records on file, not a finding that anyone is compliant.' },
  'fr-CA': { h: 'Aujourd’hui en un coup d’œil', expiring90: 'Expirent dans 90 jours', expired: 'Expirés', waivers90d: 'Dérogations (90 jours)', withdrawals30d: 'Retraits de consentement (30 jours)', openHolds: 'Gels juridiques ouverts', cashReportsDue: 'Déclarations d’espèces à produire', openScreeningHits: 'Correspondances ouvertes', note: 'Documents au dossier, et non une constatation de conformité.' },
};
/** The Principal Broker's counts. */
function Overview({ call, locale }: { call: Call; locale: Locale }) {
  const x = OV[locale] as Record<string, string>;
  const [d, setD] = useState<Record<string, number> | null>(null);
  useEffect(() => { void call('GET', '/v1/compliance/overview').then(setD, () => undefined); }, []);
  if (!d) return null;
  return (
    <section class="rec-form" aria-label={x.h} style={{ marginTop: '16px' }}>
      <h3>{x.h}</h3>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
        {Object.keys(d).map((k) => <div key={k} class="hcard" style={{ minWidth: '120px', padding: '8px 12px' }}><div style={{ fontSize: '1.6em', fontWeight: 700, color: d[k]! > 0 && k !== 'expiring90' ? '#b3261e' : undefined }}>{d[k]}</div><small class="muted">{x[k]}</small></div>)}
      </div>
      <p class="muted">{x.note}</p>
    </section>
  );
}

const RT = {
  'en': { h: 'Retention', help: 'How long closed client files are kept. You may lengthen a period, never shorten it below the minimum. This reports only: nothing is deleted automatically.', years: 'years', min: 'minimum', save: 'Save', due: 'Past retention (review)', held: 'Under legal hold', soon: 'Reaching the end within 12 months', holds: 'Legal holds', none: 'Nothing is past its retention period.', state: { due: 'Due for review', held: 'Held', retained: 'Retained', active: 'Active' } as Record<string, string> },
  'fr-CA': { h: 'Conservation', help: 'Durée de conservation des dossiers clients fermés. Vous pouvez allonger une période, jamais la réduire sous le minimum. Rapport seulement : rien n’est supprimé automatiquement.', years: 'ans', min: 'minimum', save: 'Enregistrer', due: 'Période de conservation échue (à examiner)', held: 'Sous gel juridique', soon: 'Échéance dans les 12 mois', holds: 'Gels juridiques', none: 'Aucun dossier n’a dépassé sa période de conservation.', state: { due: 'À examiner', held: 'Gelé', retained: 'Conservé', active: 'Actif' } as Record<string, string> },
};
interface Ret { policies: { kind: string; label: Record<Locale, string>; years: number; min: number; max: number }[]; holds: { id: string; boxId: string; name: string; reason: string }[]; summary: { due: number; held: number; dueWithin12Months: number }; files: { boxId: string; name: string; kind: string; records: number; closedAt: string; retainUntil: string | null; state: string }[] }
/** Retention periods, holds and what is due. Visible to administrators and the compliance role. */
function RetentionPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = RT[locale];
  const [d, setD] = useState<Ret | null>(null);
  const [yrs, setYrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/compliance/retention').then(setD, () => undefined);
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const label = (k: string) => d.policies.find((p) => p.kind === k)?.label[locale] ?? k;
  return (
    <section class="rec-form" aria-label={x.h} style={{ marginTop: '16px' }}>
      <h3>{x.h}</h3><p class="muted">{x.help}</p>
      {err && <p class="err" role="alert">{err}</p>}
      {d.policies.map((p) => (
        <div class="ev" key={p.kind}>{p.label[locale]}: <input type="number" min={p.min} max={p.max} style={{ width: '70px' }} aria-label={p.label[locale]} value={yrs[p.kind] ?? String(p.years)} onInput={(e) => setYrs({ ...yrs, [p.kind]: (e.target as HTMLInputElement).value })} /> {x.years} <small class="muted">({x.min} {p.min})</small>{' '}
          <button class="btn quiet" disabled={(yrs[p.kind] ?? String(p.years)) === String(p.years)} onClick={() => { setErr(''); void call('PUT', `/v1/compliance/retention/${p.kind}`, { years: Number(yrs[p.kind]) }).then(() => { setYrs({ ...yrs, [p.kind]: undefined as unknown as string }); return load(); }, (e) => setErr((e as Error).message)); }}>{x.save}</button></div>
      ))}
      <p><strong>{d.summary.due}</strong> {x.due} · <strong>{d.summary.held}</strong> {x.held} · <strong>{d.summary.dueWithin12Months}</strong> {x.soon}</p>
      {d.files.length === 0 && <p class="muted">{x.none}</p>}
      {d.files.map((f, i) => <div class="ev" key={f.boxId + f.kind + i}><strong>{f.name}</strong> <small>{label(f.kind)} · {f.records} · {f.closedAt} → {f.retainUntil ?? '—'} · {x.state[f.state]}</small></div>)}
    </section>
  );
}

const CL: Record<string, { en: string; 'fr-CA': string }> = {
  not_approved: { en: 'File not approved', 'fr-CA': 'Dossier non approuvé' }, no_licence: { en: 'No licence on file', 'fr-CA': 'Aucun permis au dossier' },
  licence_expired: { en: 'Licence expired', 'fr-CA': 'Permis expiré' }, no_eo: { en: 'No E&O policy on file', 'fr-CA': 'Aucune police E&O au dossier' },
  eo_expired: { en: 'E&O policy expired', 'fr-CA': 'Police E&O expirée' }, eo_limit_low: { en: 'E&O limit below the minimum', 'fr-CA': 'Limite E&O sous le minimum' },
};
const NC = {
  'en': { h: 'Not cleared to transact', all: 'All partners are cleared to transact.', of: 'cleared' },
  'fr-CA': { h: 'Non autorisés à transiger', all: 'Tous les partenaires sont autorisés à transiger.', of: 'autorisés' },
};
/** Partners who may not sell today: file not approved, no licence in force, or E&O missing, expired or too low. */
function NotCleared({ call, locale }: { call: Call; locale: Locale }) {
  const x = NC[locale];
  const [d, setD] = useState<{ total: number; cleared: number; notCleared: { nodeId: string; name: string; reasons: string[] }[] } | null>(null);
  useEffect(() => { void call('GET', '/v1/compliance/clearance').then(setD, () => undefined); }, []);
  if (!d || d.total === 0) return null;
  return (
    <section class="rec-form" aria-label={x.h} style={{ marginTop: '16px' }}>
      <h3>{x.h} ({d.notCleared.length})</h3>
      <p class="muted">{d.cleared}/{d.total} {x.of}</p>
      {d.notCleared.length === 0 && <p class="muted">{x.all}</p>}
      {d.notCleared.map((p) => (
        <div class="ev" key={p.nodeId}><strong>{p.name}</strong><div style={{ color: '#b3261e' }}>{p.reasons.map((r) => CL[r]?.[locale] ?? r).join(' · ')}</div></div>
      ))}
    </section>
  );
}

const FR = {
  'en': { h: 'Files at risk', none: 'No records are past a paperwork gate without the required documents.', waivers: 'waivers in the last 90 days', at: 'now in', gate: 'gate', missing: 'missing', open: 'Open' },
  'fr-CA': { h: 'Dossiers à risque', none: 'Aucun dossier n’a franchi une étape sans les documents requis.', waivers: 'dérogations au cours des 90 derniers jours', at: 'maintenant à', gate: 'étape', missing: 'manque', open: 'Ouvrir' },
};
/** Records that sit in or past a stage whose required paperwork is not on file and not waived. */
function FilesAtRisk({ call, locale }: { call: Call; locale: Locale; go: (page: string, id?: string) => void }) {
  const x = FR[locale];
  const [d, setD] = useState<{ files: { id: string; name: string; pipeline: string; stage: string; gateStage: string; missing: string[]; owner: string | null }[]; waivers90d: number } | null>(null);
  useEffect(() => { void call('GET', '/v1/compliance/files-at-risk').then(setD, () => setD({ files: [], waivers90d: 0 })); }, []);
  if (!d) return null;
  return (
    <section class="rec-form" aria-label={x.h} style={{ marginTop: '16px' }}>
      <h3>{x.h} ({d.files.length})</h3>
      <p class="muted">{d.waivers90d} {x.waivers}</p>
      {d.files.length === 0 && <p class="muted">{x.none}</p>}
      {d.files.map((f, i) => (
        <div class="ev" key={f.id + i}>
          <strong>{f.name}</strong> <small>{f.pipeline} · {x.at} {f.stage} · {x.gate} {f.gateStage} · {f.owner ?? '—'}</small>
          <div style={{ color: '#b3261e' }}>{x.missing}: {f.missing.map((k) => docLabel(k, locale)).join(', ')}</div>
        </div>
      ))}
    </section>
  );
}

function ListView({ call, locale, ho, openFile, host }: { call: Call; locale: Locale; ho: boolean; openFile: (id: string) => void; host?: HostOptions }) {
  const x = X[locale];
  const base = ho ? '/v1/ho' : '/v1/compliance';
  const [rows, setRows] = useState<any[] | null>(null);
  const [exp, setExp] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [tab, setTab] = useState<'review' | 'all' | 'expiring' | 'companies'>(ho ? 'review' : 'all');
  const [cos, setCos] = useState<any[]>([]);
  const [coName, setCoName] = useState(''); const [coMail, setCoMail] = useState(''); const [coErr, setCoErr] = useState('');
  const loadCos = () => call('GET', '/v1/ho/companies').then((r) => setCos(r.companies), () => undefined);
  const [q, setQ] = useState('');
  const [ins, setIns] = useState<Insights | null>(null);
  const [needAll, setNeedAll] = useState(false);
  const regions = host?.regions ?? [];
  const multi = ho && regions.length > 1;
  const here = host?.region ?? regions[0]?.id;
  const hereLabel = regions.find((r) => r.id === here)?.label ?? '';
  // A global admin starts on All countries. Coming from a click there (a country or a company) skips straight to that country.
  const [scope, setScope] = useState<'all' | 'country'>(() => {
    if (!multi) return 'country';
    try { if (localStorage.getItem('pii.focus')) return 'country'; return localStorage.getItem('pii.scope') === 'country' ? 'country' : 'all'; } catch { /* private window */ }
    return 'all';
  });
  useEffect(() => {
    try {
      const raw = localStorage.getItem('pii.focus'); if (!raw) return;
      localStorage.removeItem('pii.focus');
      const f = JSON.parse(raw) as { tab?: typeof tab; company?: string; node?: string };
      if (f.tab) setTab(f.tab); if (f.company) setQ(f.company); if (f.node) openFile(f.node);
    } catch { /* ignore */ }
  }, []);
  useEffect(() => { if (multi) try { localStorage.setItem('pii.scope', scope); } catch { /* private window */ } }, [scope, multi]);
  const openCountry = (id: string, f?: { tab?: typeof tab; company?: string; node?: string }) => {
    if (id === here) { setScope('country'); setTab(f?.tab ?? 'review'); setQ(f?.company ?? ''); if (f?.node) openFile(f.node); return; }
    try { localStorage.setItem('pii.focus', JSON.stringify(f ?? { tab: 'review' })); } catch { /* private window */ }
    host?.switchRegion?.(id);
  };
  const scopeBar = multi ? (
    <div class="scopebar">
      <div class="seg" role="tablist" aria-label={x.allC}>
        <button role="tab" aria-selected={scope === 'all'} onClick={() => setScope('all')}>{x.allC}</button>
        {regions.map((r) => <button role="tab" aria-selected={scope === 'country' && r.id === here} onClick={() => openCountry(r.id)}>{r.label}</button>)}
      </div>
      {scope === 'country' && cos.length > 0 && <><span class="sep" aria-hidden="true">›</span>
        <select aria-label={x.companies} value={cos.some((c) => c.name === q) ? q : ''} onChange={(e) => { setQ((e.target as HTMLSelectElement).value); setTab((t) => (t === 'companies' ? 'all' : t)); }}>
          <option value="">{x.allCos}</option>{cos.map((c) => <option value={c.name}>{c.name}</option>)}
        </select></>}
      <span class="spacer" />
      <JumpTo host={host!} locale={locale} open={openCountry} />
    </div>
  ) : null;
  const strip = multi && host ? <ConnectStrip host={host} locale={locale} /> : null;
  useEffect(() => {
    call('GET', `${base}/partners`).then((r) => setRows(r.partners), (e) => setErr((e as Error).message));
    if (ho) { call('GET', '/v1/ho/expiring?days=60').then((r) => setExp(r.items), () => undefined); call('GET', '/v1/ho/insights').then((r) => setIns(r as Insights), () => undefined); void loadCos(); }
  }, [call]);
  const shown = useMemo(() => (rows ?? []).filter((r) => (tab !== 'review' || r.status === 'submitted') && `${r.name} ${r.company ?? ''}`.toLowerCase().includes(q.trim().toLowerCase())), [rows, tab, q]);
  if (multi && scope === 'all' && host) return <div class="home"><div class="hwelcome"><div><h2 style={{ margin: 0 }}>{x.headTitle}</h2><span class="muted">{x.chooseSub}</span></div></div>{scopeBar}{strip}<AllCountries host={host} locale={locale} open={openCountry} /></div>;
  if (err) return <ErrorBar msg={err} retry={x.retry} />;
  if (!rows) return <div class="msg">…</div>;
  const waiting = rows.filter((r) => r.status === 'submitted').length;
  return (
    <div class="home">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{ho ? x.headTitle : x.title}</h2><span class="muted">{ho ? (multi ? x.headSubC(hereLabel) : x.headSub) : x.sub}</span></div></div>
      {scopeBar}
      {strip}
      {!ho && <ComingUp call={call} locale={locale} />}
      {ho && ins && <NeedsYou locale={locale} openAll={needAll} setOpenAll={setNeedAll}
        needs={needsOf(ins, locale).map((need) => ({ need, go: () => { if (need.tab) setTab(need.tab); } }))} />}
      {ho && <>
        <div class="hstats">
          <div class={`hstat ${waiting ? 'warn' : ''}`}><b>{waiting}</b><span>{x.hWaiting}</span>{ins && <Trend now={waiting} before={ins.prev?.data.waiting} since={ins.prev?.day} locale={locale} />}</div>
          <div class={`hstat ${exp.length ? 'warn' : ''}`}><b>{exp.length}</b><span>{x.hExpiring}</span></div>
          <div class="hstat"><b>{rows.length}</b><span>{x.hPartners}</span>{ins && <Trend now={rows.length} before={ins.prev?.data.partners} since={ins.prev?.day} locale={locale} />}</div>
          <div class="hstat"><b>{cos.length}</b><span>{x.hCompanies}</span>{ins && <Trend now={cos.length} before={ins.prev?.data.companies} since={ins.prev?.day} locale={locale} />}</div>
        </div>
        {ins && <>
          <div class="charts">
            <section class="hcard chartcard"><h4>{titles(locale).funnel}</h4><Funnel f={ins.funnel} locale={locale} /></section>
            <section class="hcard chartcard"><h4>{titles(locale).expiry}</h4><ExpiryBars e={ins.expiry} locale={locale} /></section>
          </div>
          <Widgets i={ins} locale={locale} />
        </>}
        <div class="seg" role="tablist" aria-label={x.title} style={{ margin: '8px 0' }}>
          {([['review', x.review], ['all', x.all], ['expiring', x.expiring], ...(multi ? [] : [['companies', x.companies] as const])] as const).map(([k, l]) => <button role="tab" aria-selected={tab === k} onClick={() => setTab(k as typeof tab)}>{l}</button>)}
        </div>
      </>}
      {tab === 'companies' ? (
        <section class="hcard">
          <h3>{multi ? x.coIn(hereLabel) : x.newCo}</h3>
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
        <section class="hcard">{exp.length === 0 && <div class="calm"><b>{x.calmExp}</b>{x.calmExpSub}</div>}
          {exp.map((i) => <button class="hrow" key={i.itemId} onClick={() => openFile(i.nodeId)}><span class="rname">{i.name} <small class="muted">· {i.company}</small></span><small class="muted">{i.label}</small><span class={`due ${tone(i.daysLeft)}`}>{i.expiresOn} · {x.left(i.daysLeft)}</span></button>)}
        </section>
      ) : (
        <section class="hcard">
          {q && rows.some((r) => r.company === q) && <p class="muted">{x.showing}: <b>{q}</b> <button class="lk" onClick={() => setQ('')}>{x.clear}</button></p>}
          <input type="search" placeholder={x.search} value={q} aria-label={x.search} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style={{ width: '100%', marginBottom: '8px' }} />
          {shown.length === 0 && (tab === 'review' && !q ? <div class="calm"><b>{x.calmReview}</b>{x.calmReviewSub}</div> : rows.length === 0 ? <div class="calm"><b>{x.calmAll}</b>{x.calmAllSub}</div> : <div class="calm">{x.none}</div>)}
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
      <div class="erow"><button class="link" onClick={back}>← {x.back}</button>{!ho && <button class="btn quiet" onClick={() => void act(async () => { const r = await call('GET', `/v1/compliance/partners/${nodeId}/audit-package`); save(r.filename, r.mime, r.dataBase64); })}>{locale === 'fr-CA' ? 'Exporter le dossier d’audit' : 'Export audit package'}</button>}</div>
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

interface RegionData { state: 'loading' | 'out' | 'no' | 'consent' | 'err' | 'ok'; companies: any[]; expiring: any[]; ins?: Insights }
const EMPTY: RegionData = { state: 'loading', companies: [], expiring: [] };

/** Global admin home: every country and its companies at once. Each country is its own server and login, so each is asked separately. */
function AllCountries({ host, locale, open }: { host: HostOptions; locale: Locale; open: (region: string, f?: { tab?: 'review' | 'all' | 'expiring' | 'companies'; company?: string; node?: string }) => void }) {
  const x = X[locale];
  const regions = host.regions ?? [];
  const [d, setD] = useState<Record<string, RegionData>>({});
  const [adding, setAdding] = useState(false);
  const [needAll, setNeedAll] = useState(false);
  const [aReg, setAReg] = useState(host.region ?? regions[0]?.id ?? '');
  const [aName, setAName] = useState(''); const [aMail, setAMail] = useState(''); const [aErr, setAErr] = useState('');
  const set = (id: string, v: RegionData) => setD((o) => ({ ...o, [id]: v }));
  const load = () => regions.forEach(async (r) => {
    const ask = (path: string) => host.transport('GET', path, undefined, r.id);
    set(r.id, EMPTY);
    const me = await ask('/v1/me');
    if (me.status === 401 || me.status === 0 || me.status === -1) return set(r.id, { ...EMPTY, state: 'out' });
    if (me.status === 200 && me.json?.needsConsent) return set(r.id, { ...EMPTY, state: 'consent' });
    if (me.status !== 200 || !me.json?.isHeadOffice) return set(r.id, { ...EMPTY, state: 'no' });
    const [co, ex, ig] = await Promise.all([ask('/v1/ho/companies'), ask('/v1/ho/expiring?days=60'), ask('/v1/ho/insights')]);
    if (co.status !== 200 || ex.status !== 200) return set(r.id, { ...EMPTY, state: 'err' });
    set(r.id, { state: 'ok', companies: co.json?.companies ?? [], expiring: ex.json?.items ?? [], ins: ig.status === 200 ? (ig.json as Insights) : undefined });
  });
  useEffect(() => { load(); }, []);
  useEffect(() => { const f = () => { if (document.visibilityState !== 'hidden') load(); }; window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);
  const ok = regions.map((r) => ({ r, v: d[r.id] })).filter((e) => e.v?.state === 'ok');
  const sum = (f: (v: RegionData) => number) => ok.reduce((a, e) => a + f(e.v!), 0);
  const waiting = (v: RegionData) => v.companies.reduce((a, c) => a + c.submitted, 0);
  const split = (f: (v: RegionData) => number) => `(${ok.map((e) => `${e.r.id.toUpperCase()} ${f(e.v!)}`).join(' · ')})`;
  const tiles: [string, number, (v: RegionData) => number, string][] = [
    [x.review, sum(waiting), waiting, 'review'], [x.expiring, sum((v) => v.expiring.length), (v) => v.expiring.length, 'expiring'], [x.companies, sum((v) => v.companies.length), (v) => v.companies.length, 'companies']];
  return (
    <>
      <NeedsYou locale={locale} openAll={needAll} setOpenAll={setNeedAll}
        needs={ok.flatMap((e) => (e.v!.ins ? needsOf(e.v!.ins, locale, e.r.label).map((need) => ({ need, go: () => open(e.r.id, { tab: need.tab as NeedTab }) })) : []))} />
      <div class="hstats">{tiles.map(([l, n, f, tab]) => <div class={`hstat ${tab === 'expiring' && n ? 'warn' : ''}`}><b>{n}</b><span>{l}</span>{ok.length > 1 && <small>{split(f)}</small>}</div>)}</div>
      {regions.map((r) => {
        const v = d[r.id] ?? EMPTY;
        return (
          <section class="hcard" key={r.id}>
            <div class="erow">
              <button class="lk" onClick={() => open(r.id)}><b>{r.label}</b></button>
              <span class="spacer" />
              {v.state === 'ok' && <small class="muted">{x.cCo(v.companies.length)} · {x.cWait(waiting(v))}</small>}
            </div>
            {v.state === 'loading' && <p class="muted">…</p>}
            {v.state === 'out' && <p><span class="chip warn">{x.cOff}</span> <button class="btn" onClick={() => host.onSignIn(r.id, true)}>{x.cSign}</button></p>}
            {v.state === 'consent' && <Notice host={host} locale={locale} region={r.id} done={load} />}
            {v.state === 'no' && <p class="muted">{x.cNo}</p>}
            {v.state === 'err' && <p class="muted">{x.cErr}</p>}
            {v.state === 'ok' && v.ins && v.ins.funnel.partners > 0 && <div style={{ margin: '8px 0 4px' }}><Funnel f={v.ins.funnel} locale={locale} compact /></div>}
            {v.state === 'ok' && v.companies.length === 0 && <p class="muted">{x.coNone}</p>}
            {v.state === 'ok' && v.companies.map((c) => {
              const ex = v.expiring.filter((i) => i.company === c.name).length;
              return (
                <button class="hrow" key={c.id} onClick={() => open(r.id, { tab: c.submitted ? 'review' : ex ? 'expiring' : 'all', company: c.name })}>
                  <span class="rname">{c.name} <small class="muted">· {c.adminEmail}</small></span>
                  <small class="muted">{x.cPart(c.partners)}{c.submitted ? ` · ${x.cWait(c.submitted)}` : ''}{ex ? ` · ${x.cExp(ex)}` : ''}</small>
                  <span class={`chip ${c.adminStatus === 'invited' ? 'warn' : 'ok'}`}>{c.adminStatus === 'invited' ? x.invited : x.active}</span>
                </button>
              );
            })}
          </section>
        );
      })}
      <section class="hcard">
        {!adding ? <button class="btn" onClick={() => setAdding(true)}>+ {x.newCo}</button> : (
          <form class="cform" onSubmit={async (e) => {
            e.preventDefault(); setAErr('');
            const r = await host.transport('POST', '/v1/ho/companies', { name: aName, adminEmail: aMail, locale }, aReg);
            if (r.status >= 200 && r.status < 300) { setAName(''); setAMail(''); setAdding(false); load(); } else setAErr(r.json?.error?.message ?? `Error ${r.status}`);
          }}>
            <label class="fl">{x.addTo}<select value={aReg} onChange={(e) => setAReg((e.target as HTMLSelectElement).value)}>{regions.map((r) => <option value={r.id}>{r.label}</option>)}</select></label>
            <label class="fl">{x.coName}<input required minLength={2} maxLength={120} value={aName} onInput={(e) => setAName((e.target as HTMLInputElement).value)} /></label>
            <label class="fl">{x.coAdmin}<input required type="email" value={aMail} onInput={(e) => setAMail((e.target as HTMLInputElement).value)} /></label>
            <button class="btn" type="submit">{x.coAdd}</button> <button class="lk" type="button" onClick={() => setAdding(false)}>{x.cancel}</button>
            {aErr && <p class="err" role="alert">{aErr}</p>}
          </form>
        )}
      </section>
    </>
  );
}


/** The privacy notice of one country, read and accepted without leaving the page. */
function Notice({ host, locale, region, done }: { host: HostOptions; locale: Locale; region: string; done: () => void }) {
  const x = X[locale];
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const read = async () => { const r = await host.transport('GET', '/v1/consent/first-login', undefined, region); if (r.status === 200) { setText(String(r.json?.text ?? '')); setErr(false); } else setErr(true); };
  return (
    <div>
      <small class="muted">{x.cConsent}</small>{' '}
      {text === null ? <button class="btn" onClick={() => void read()}>{x.noticeT}</button> : (
        <>
          <p style={{ whiteSpace: 'pre-wrap', overflow: 'auto', maxHeight: '220px', fontSize: '13px' }}>{text}</p>
          <button class="btn" onClick={async () => { await host.transport('POST', '/v1/consent/first-login', undefined, region); setText(null); done(); }}>{x.noticeOk}</button>
        </>
      )}
      {err && <p class="err" role="alert">{x.noticeErr}</p>}
    </div>
  );
}

/** One line under the scope bar when another country needs a sign-in or the privacy notice. Nothing shows when all is well. */
function ConnectStrip({ host, locale }: { host: HostOptions; locale: Locale }) {
  const x = X[locale];
  const regions = host.regions ?? [];
  const [st, setSt] = useState<Record<string, 'ok' | 'out' | 'consent' | 'no'>>({});
  const [openR, setOpenR] = useState('');
  const check = () => regions.forEach(async (r) => {
    const me = await host.transport('GET', '/v1/me', undefined, r.id);
    const v = me.status === 200 ? (me.json?.needsConsent ? 'consent' : me.json?.isHeadOffice ? 'ok' : 'no') : me.status === 401 ? 'out' : 'no';
    setSt((o) => ({ ...o, [r.id]: v }));
  });
  useEffect(() => { check(); const f = () => check(); window.addEventListener('focus', f); return () => window.removeEventListener('focus', f); }, []);
  const need = regions.filter((r) => st[r.id] === 'out' || st[r.id] === 'consent');
  if (need.length === 0) return null;
  return (
    <div class="connect">
      {need.map((r) => st[r.id] === 'out'
        ? <button class="chip warn" key={r.id} onClick={() => host.onSignIn(r.id, true)}>{x.connectL(r.label)}</button>
        : <button class="chip warn" key={r.id} onClick={() => setOpenR(openR === r.id ? '' : r.id)}>{x.noticeL(r.label)}</button>)}
      {openR && st[openR] === 'consent' && <section class="hcard"><Notice host={host} locale={locale} region={openR} done={() => { setOpenR(''); check(); }} /></section>}
    </div>
  );
}

/** Type two letters, see matching company and partner names from every country you are signed in to. Names only. */
function JumpTo({ host, locale, open }: { host: HostOptions; locale: Locale; open: (region: string, f?: { tab?: NeedTab; company?: string; node?: string }) => void }) {
  const x = X[locale];
  const regions = host.regions ?? [];
  const inp = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ region: string; label: string; kind: 'co' | 'pa'; name: string; sub?: string; node?: string }[] | null>(null);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    let live = true;
    const id = setTimeout(async () => {
      const out: NonNullable<typeof hits> = [];
      await Promise.all(regions.map(async (r) => {
        const res = await host.transport('GET', `/v1/ho/search?q=${encodeURIComponent(term)}`, undefined, r.id);
        if (res.status !== 200) return;
        for (const c of res.json.companies ?? []) out.push({ region: r.id, label: r.label, kind: 'co', name: c.name });
        for (const p of res.json.partners ?? []) out.push({ region: r.id, label: r.label, kind: 'pa', name: p.name, sub: p.company, node: p.nodeId });
      }));
      if (live) setHits(out);
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [q]);
  const pick = (h: NonNullable<typeof hits>[number]) => { setQ(''); setHits(null); open(h.region, h.kind === 'co' ? { tab: 'all', company: h.name } : { tab: 'all', node: h.node }); };
  return (
    <div class="jump">
      <input ref={inp} type="search" role="combobox" aria-expanded={Boolean(hits)} aria-controls="pii-jump" aria-autocomplete="list" value={q} placeholder={x.jump} aria-label={x.jump} onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { setQ(''); setHits(null); } else if (e.key === 'ArrowDown') { e.preventDefault(); (e.currentTarget.parentElement?.querySelector('.jumplist button') as HTMLElement | null)?.focus(); } }} />
      <span class="sr" role="status" aria-live="polite">{hits ? (hits.length ? x.jumpN(hits.length) : x.jumpNone) : ''}</span>
      {hits && (
        <div class="jumplist" id="pii-jump" role="listbox" onKeyDown={(e) => {
          const bs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button')); const i = bs.indexOf(e.target as HTMLElement);
          if (e.key === 'ArrowDown') { e.preventDefault(); bs[Math.min(bs.length - 1, i + 1)]?.focus(); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); if (i <= 0) inp.current?.focus(); else bs[i - 1]?.focus(); }
          else if (e.key === 'Escape') { setQ(''); setHits(null); inp.current?.focus(); }
        }}>
          {hits.length === 0 && <div class="calm">{x.jumpNone}</div>}
          {hits.map((h) => <button role="option" class="hrow" key={h.region + h.kind + (h.node ?? h.name)} onClick={() => pick(h)}><span class="rname">{h.name}{h.sub ? <small class="muted"> · {h.sub}</small> : null}</span><small class="muted">{h.kind === 'co' ? x.jCo : x.jPa} · {h.label}</small></button>)}
        </div>
      )}
    </div>
  );
}

const UP = {
  'en': { title: 'Coming up', sub: 'Licences, E&O, continuing education and course due dates.', overdue: 'Overdue', d30: 'Next 30 days', d60: '31 to 60 days', d90: '61 to 90 days', none: 'Nothing due in the next 90 days.', empty: 'None',
    kind: { licence: 'Licence', eo: 'E&O', ce: 'Continuing education', course: 'Course' } as Record<string, string>, day: (n: number) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} late` : n === 0 ? 'today' : `in ${n} day${n === 1 ? '' : 's'}`) },
  'fr-CA': { title: 'À venir', sub: 'Permis, E&O, formation continue et échéances de formations.', overdue: 'En retard', d30: '30 prochains jours', d60: '31 à 60 jours', d90: '61 à 90 jours', none: 'Rien à échéance dans les 90 prochains jours.', empty: 'Aucun',
    kind: { licence: 'Permis', eo: 'E&O', ce: 'Formation continue', course: 'Formation' } as Record<string, string>, day: (n: number) => (n < 0 ? `${-n} jour${n === -1 ? '' : 's'} de retard` : n === 0 ? 'aujourd’hui' : `dans ${n} jour${n === 1 ? '' : 's'}`) },
};
interface Due { kind: string; id: string; label: string; who: string | null; dueOn: string; daysLeft: number }

/** The 30/60/90-day calendar: everything with a date the person can see, soonest first. Hidden when nothing is coming. */
function ComingUp({ call, locale }: { call: Call; locale: Locale }) {
  const u = UP[locale];
  const [g, setG] = useState<Record<string, Due[]> | null>(null);
  useEffect(() => { call('GET', '/v1/compliance/calendar').then((r) => setG(r.groups), () => setG(null)); }, []);
  if (!g) return null;
  const cols = (['overdue', 'd30', 'd60', 'd90'] as const).map((k) => [k, g[k] ?? []] as const);
  if (cols.every(([, l]) => l.length === 0)) return <section class="hcard"><h3 style={{ marginTop: 0 }}>{u.title}</h3><span class="muted">{u.none}</span></section>;
  return (
    <section class="hcard" aria-label={u.title}>
      <h3 style={{ marginTop: 0 }}>{u.title}</h3><div class="muted" style={{ marginBottom: 8 }}>{u.sub}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }}>
        {cols.map(([k, list]) => (
          <div>
            <b style={k === 'overdue' && list.length ? { color: 'var(--bad, #b3261e)' } : undefined}>{u[k]} · {list.length}</b>
            {list.length === 0 ? <div class="muted">{u.empty}</div> : <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0' }}>
              {list.slice(0, 8).map((d) => <li style={{ padding: '4px 0' }}><span class="muted">{u.kind[d.kind] ?? d.kind}</span> {d.label}{d.who ? ` · ${d.who}` : ''}<br /><span class="muted">{d.dueOn} · {u.day(d.daysLeft)}</span></li>)}
              {list.length > 8 && <li class="muted">+{list.length - 8}</li>}
            </ul>}
          </div>
        ))}
      </div>
    </section>
  );
}
