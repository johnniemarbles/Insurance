// Families, Gate C screens: a person's consents, legal authority, ID checks, life events and reviews; the family
// summary; which consents a deal can reuse; and the review and verification queues.
// Shown only when the server has FAMILIES_COMPLIANCE_ENABLED on: a 404 from the first call hides everything here.
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { ClientPicker, type Call } from './families.tsx';

const PURPOSES = ['collection_use', 'carrier_sharing', 'electronic_comms', 'pink_slip_optin', 'marketing'] as const;
const AUTH_PURPOSES = [...PURPOSES, 'policy_changes'] as const;
const AUTH_KINDS = ['guardian_of_minor', 'poa_property', 'poa_personal_care', 'court_appointed', 'other_representative'] as const;
const END_REASONS = ['expired', 'revoked', 'subject_came_of_age', 'subject_deceased', 'holder_deceased', 'entered_in_error', 'replaced'] as const;
const EVENTS = ['separation', 'death', 'guardianship_change', 'move', 'marriage_partnership', 'birth_adoption', 'other'] as const;
const CHANNELS = ['in_person', 'phone', 'email', 'esign'] as const;
const DOCS = ['passport', 'drivers_licence', 'provincial_id', 'permanent_resident_card', 'citizenship_card', 'birth_certificate', 'credit_file', 'utility_bill', 'bank_statement', 'government_letter', 'other'] as const;
const JURS = ['CA-AB', 'CA-BC', 'CA-MB', 'CA-NB', 'CA-NL', 'CA-NS', 'CA-NT', 'CA-NU', 'CA-ON', 'CA-PE', 'CA-QC', 'CA-SK', 'CA-YT'];

const L = {
  en: {
    compliance: 'Consent and authority', loading: 'Loading…', save: 'Save', cancel: 'Cancel', close: 'Close', add: 'Add', none: 'None recorded.',
    residence: 'Province of residence', notSet: 'Not set',
    majority: (age: number, j: string, ok: boolean) => `Age of majority in ${j}: ${age} (${ok ? 'confirmed by counsel' : 'not yet confirmed by counsel'}).`,
    minor: (on: string) => `Under the age of majority until ${on}.`, adult: 'Of age.', noRule: 'No age rule set for this province.', noDob: 'Date of birth not on file.',
    leap: 'Born on 29 February: counsel confirms which day the age is reached.',
    consents: 'Consents', record: 'Record consent', purpose: 'Purpose', channel: 'How it was given', given: 'Given on', givenBy: 'Given by', self: 'The client', underAuth: 'Someone with authority',
    authority: 'Authority', capNote: 'Why their own consent was accepted (review note)', capHelp: 'This person is under the age of majority. Record the consent from a verified guardian, or explain the review.',
    inForce: 'In force', withdrawn: 'Withdrawn', withdraw: 'Record withdrawal', withdrawnOn: 'Withdrawn on', usedBy: 'Used by', allDealings: 'All dealings', oneDeal: 'One deal', notice: 'Notice',
    authorities: 'Legal authority', about: 'Over this person', held: 'Held by this person', recordAuth: 'Record authority', holder: 'Holder', holderClient: 'A client', holderOutside: 'Someone not on file (name)',
    kind: 'Kind', scope: 'May act for', starts: 'Starts', ends: 'Ends (optional)', evidence: 'Evidence seen (no document numbers)',
    pending: 'Waiting for compliance', verified: 'Verified', rejected: 'Rejected', ended: 'Ended', notInEffect: 'not in effect', verify: 'Verify', reject: 'Reject', decision: 'Decision note', end: 'End', endWhy: 'Why it ended',
    selfRecorded: 'You recorded this, so someone else in compliance verifies it.',
    ids: 'ID checks', recordId: 'Record ID check', method: 'Method', result: 'Result', checked: 'Checked on', seen: 'Documents seen', idNote: 'Note (no document numbers)', older: 'Recorded on a deal before person-level checks',
    events: 'Life events', recordEvent: 'Record life event', occurred: 'Occurred on', eventHelp: 'Recording an event changes nothing else. It opens a review listing what to look at.',
    opened: (n: number) => `Review opened: ${n} ${n === 1 ? 'record' : 'records'} to look at.`,
    reviews: 'Reviews', due: 'Due', resolve: 'Resolve', resolution: 'What was decided', overdue: 'Overdue', resolved: 'Resolved',
    queue: 'Compliance reviews', toVerify: 'Authorities to verify', open: 'Open', noneOpen: 'Nothing waiting.', verifyHelp: 'Check the evidence described. You cannot verify an authority you recorded.',
    family: 'Consent and authority', member: 'Member', idCol: 'ID', reviewsCol: 'Reviews', turns: (age: number, on: string) => `Turns ${age} on ${on}`, minorTag: 'Minor', guardianTag: (n: number) => `${n} verified authority`, pendingTag: (n: number) => `${n} awaiting verification`,
    dealPeople: 'Consent and ID by person', dealHelp: 'A consent is reused only when purpose, scope, notice version and any authority still match.', use: 'Use for this deal', cannot: 'Cannot be used', needNew: 'Record a new consent on the client.',
    noRules: 'No ID rules set yet; ask compliance.',
    idStatus: { current: 'ID current', expired: 'ID expired', missing: 'ID needed', failed: 'ID check failed', not_required: 'ID not required', no_rule: 'No ID rule' } as Record<string, string>,
    purposes: { collection_use: 'Collection and use', carrier_sharing: 'Sharing with insurers', electronic_comms: 'Electronic messages', pink_slip_optin: 'Electronic proof of insurance', marketing: 'Marketing', policy_changes: 'Policy and deal changes' } as Record<string, string>,
    kinds: { guardian_of_minor: 'Guardian of a minor', poa_property: 'Power of attorney (property)', poa_personal_care: 'Power of attorney (personal care)', court_appointed: 'Court-appointed', other_representative: 'Other representative' } as Record<string, string>,
    endReasons: { expired: 'Expired', revoked: 'Revoked', subject_came_of_age: 'Came of age', subject_deceased: 'Person died', holder_deceased: 'Holder died', entered_in_error: 'Entered in error', replaced: 'Replaced' } as Record<string, string>,
    eventKinds: { separation: 'Separation', death: 'Death', guardianship_change: 'Guardianship change', move: 'Move', marriage_partnership: 'Marriage or partnership', birth_adoption: 'Birth or adoption', other: 'Other' } as Record<string, string>,
    channels: { in_person: 'In person', phone: 'Phone', email: 'Email', esign: 'E-signature', letter: 'Letter' } as Record<string, string>,
    methods: { in_person: 'In person', credit_file: 'Credit file', dual_process: 'Dual process' } as Record<string, string>,
    results: { verified: 'Verified', failed: 'Failed', referred: 'Referred' } as Record<string, string>,
    docs: { passport: 'Passport', drivers_licence: 'Driver’s licence', provincial_id: 'Provincial ID', permanent_resident_card: 'PR card', citizenship_card: 'Citizenship card', birth_certificate: 'Birth certificate', credit_file: 'Credit file', utility_bill: 'Utility bill', bank_statement: 'Bank statement', government_letter: 'Government letter', other: 'Other' } as Record<string, string>,
    reviewKinds: { coming_of_age: 'Coming of age', life_event: 'Life event', consent_withdrawn: 'Consent withdrawn', authority_ending: 'Authority ending' } as Record<string, string>,
    policyRoles: { owner: 'owner', joint_owner: 'joint owner', insured: 'insured', joint_insured: 'joint insured', payor: 'payor', beneficiary: 'beneficiary', trustee: 'trustee' } as Record<string, string>,
    ruleUnconfirmed: (age: number, j: string) => `Age ${age} for ${j} is not yet confirmed by counsel`,
    endsOn: (h: string, on: string) => `Authority held by ${h} ends on ${on}`,
  },
  'fr-CA': {
    compliance: 'Consentement et autorité', loading: 'Chargement…', save: 'Enregistrer', cancel: 'Annuler', close: 'Fermer', add: 'Ajouter', none: 'Rien d’inscrit.',
    residence: 'Province de résidence', notSet: 'Non indiquée',
    majority: (age: number, j: string, ok: boolean) => `Âge de la majorité en ${j} : ${age} (${ok ? 'confirmé par le conseiller juridique' : 'pas encore confirmé par le conseiller juridique'}).`,
    minor: (on: string) => `Mineur jusqu’au ${on}.`, adult: 'Majeur.', noRule: 'Aucune règle d’âge pour cette province.', noDob: 'Date de naissance non inscrite.',
    leap: 'Né un 29 février : le conseiller juridique confirme le jour où l’âge est atteint.',
    consents: 'Consentements', record: 'Inscrire un consentement', purpose: 'Objet', channel: 'Mode d’obtention', given: 'Donné le', givenBy: 'Donné par', self: 'Le client', underAuth: 'Une personne ayant autorité',
    authority: 'Autorité', capNote: 'Pourquoi son propre consentement a été accepté (note d’examen)', capHelp: 'Cette personne n’a pas l’âge de la majorité. Inscrivez le consentement d’un tuteur vérifié, ou expliquez l’examen.',
    inForce: 'En vigueur', withdrawn: 'Retiré', withdraw: 'Inscrire le retrait', withdrawnOn: 'Retiré le', usedBy: 'Utilisé par', allDealings: 'Toutes les affaires', oneDeal: 'Une affaire', notice: 'Avis',
    authorities: 'Autorité légale', about: 'Sur cette personne', held: 'Détenue par cette personne', recordAuth: 'Inscrire une autorité', holder: 'Titulaire', holderClient: 'Un client', holderOutside: 'Personne hors dossier (nom)',
    kind: 'Type', scope: 'Peut agir pour', starts: 'Début', ends: 'Fin (facultatif)', evidence: 'Preuve vue (sans numéros de document)',
    pending: 'En attente de la conformité', verified: 'Vérifiée', rejected: 'Refusée', ended: 'Terminée', notInEffect: 'pas en vigueur', verify: 'Vérifier', reject: 'Refuser', decision: 'Note de décision', end: 'Terminer', endWhy: 'Motif de fin',
    selfRecorded: 'Vous l’avez inscrite : une autre personne de la conformité la vérifie.',
    ids: 'Vérifications d’identité', recordId: 'Inscrire une vérification', method: 'Méthode', result: 'Résultat', checked: 'Vérifiée le', seen: 'Documents vus', idNote: 'Note (sans numéros de document)', older: 'Inscrite sur une affaire avant les vérifications par personne',
    events: 'Événements de vie', recordEvent: 'Inscrire un événement', occurred: 'Survenu le', eventHelp: 'Inscrire un événement ne change rien d’autre. Un examen s’ouvre avec la liste des dossiers à revoir.',
    opened: (n: number) => `Examen ouvert : ${n} ${n === 1 ? 'dossier' : 'dossiers'} à revoir.`,
    reviews: 'Examens', due: 'Échéance', resolve: 'Clore', resolution: 'Décision prise', overdue: 'En retard', resolved: 'Clos',
    queue: 'Examens de conformité', toVerify: 'Autorités à vérifier', open: 'Ouvrir', noneOpen: 'Rien en attente.', verifyHelp: 'Vérifiez la preuve décrite. Vous ne pouvez pas vérifier une autorité que vous avez inscrite.',
    family: 'Consentement et autorité', member: 'Membre', idCol: 'Identité', reviewsCol: 'Examens', turns: (age: number, on: string) => `Aura ${age} ans le ${on}`, minorTag: 'Mineur', guardianTag: (n: number) => `${n} autorité vérifiée`, pendingTag: (n: number) => `${n} en attente`,
    dealPeople: 'Consentement et identité par personne', dealHelp: 'Un consentement n’est réutilisé que si l’objet, la portée, la version de l’avis et toute autorité correspondent encore.', use: 'Utiliser pour cette affaire', cannot: 'Ne peut pas être utilisé', needNew: 'Inscrivez un nouveau consentement sur le client.',
    noRules: 'Aucune règle d’identité pour l’instant; voyez la conformité.',
    idStatus: { current: 'Identité à jour', expired: 'Identité échue', missing: 'Identité requise', failed: 'Vérification échouée', not_required: 'Identité non requise', no_rule: 'Aucune règle' } as Record<string, string>,
    purposes: { collection_use: 'Collecte et utilisation', carrier_sharing: 'Communication aux assureurs', electronic_comms: 'Messages électroniques', pink_slip_optin: 'Preuve d’assurance électronique', marketing: 'Marketing', policy_changes: 'Changements aux polices et affaires' } as Record<string, string>,
    kinds: { guardian_of_minor: 'Tuteur d’un mineur', poa_property: 'Procuration (biens)', poa_personal_care: 'Procuration (soins personnels)', court_appointed: 'Nommé par le tribunal', other_representative: 'Autre représentant' } as Record<string, string>,
    endReasons: { expired: 'Expirée', revoked: 'Révoquée', subject_came_of_age: 'Majorité atteinte', subject_deceased: 'Décès de la personne', holder_deceased: 'Décès du titulaire', entered_in_error: 'Inscrite par erreur', replaced: 'Remplacée' } as Record<string, string>,
    eventKinds: { separation: 'Séparation', death: 'Décès', guardianship_change: 'Changement de tutelle', move: 'Déménagement', marriage_partnership: 'Mariage ou union', birth_adoption: 'Naissance ou adoption', other: 'Autre' } as Record<string, string>,
    channels: { in_person: 'En personne', phone: 'Téléphone', email: 'Courriel', esign: 'Signature électronique', letter: 'Lettre' } as Record<string, string>,
    methods: { in_person: 'En personne', credit_file: 'Dossier de crédit', dual_process: 'Double processus' } as Record<string, string>,
    results: { verified: 'Vérifiée', failed: 'Échouée', referred: 'Transmise' } as Record<string, string>,
    docs: { passport: 'Passeport', drivers_licence: 'Permis de conduire', provincial_id: 'Carte d’identité provinciale', permanent_resident_card: 'Carte de RP', citizenship_card: 'Carte de citoyenneté', birth_certificate: 'Acte de naissance', credit_file: 'Dossier de crédit', utility_bill: 'Facture de services', bank_statement: 'Relevé bancaire', government_letter: 'Lettre gouvernementale', other: 'Autre' } as Record<string, string>,
    reviewKinds: { coming_of_age: 'Majorité', life_event: 'Événement de vie', consent_withdrawn: 'Consentement retiré', authority_ending: 'Fin d’autorité' } as Record<string, string>,
    policyRoles: { owner: 'titulaire', joint_owner: 'cotitulaire', insured: 'assuré', joint_insured: 'coassuré', payor: 'payeur', beneficiary: 'bénéficiaire', trustee: 'fiduciaire' } as Record<string, string>,
    ruleUnconfirmed: (age: number, j: string) => `L’âge de ${age} ans pour ${j} n’est pas encore confirmé par le conseiller juridique`,
    endsOn: (h: string, on: string) => `L’autorité détenue par ${h} prend fin le ${on}`,
  },
};
const S = (l: Locale) => L[l] ?? L.en;
type X = ReturnType<typeof S>;
const day = (iso: string | null | undefined, l: Locale) => (iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString(l, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const today = () => new Date().toISOString().slice(0, 10);
const msg = (e: unknown) => (e as Error).message;
const H = ({ children }: { children: preact.ComponentChildren }) => <h4 style={{ margin: '14px 0 4px', fontSize: '13.5px' }}>{children}</h4>;
const Chip = ({ tone, children }: { tone: 'ok' | 'warn' | 'mute'; children: preact.ComponentChildren }) => (
  <span style={{ display: 'inline-block', padding: '1px 8px', borderRadius: '10px', fontSize: '12px', marginRight: '4px',
    background: tone === 'ok' ? 'var(--ok-soft)' : tone === 'warn' ? 'var(--warn-soft)' : 'var(--tint)', color: tone === 'ok' ? 'var(--ok)' : tone === 'warn' ? 'var(--warn)' : 'var(--mute)' }}>{children}</span>
);

interface Auth { id: string; subjectId: string; subjectName: string | null; holderName: string | null; kind: string; purposes: string[]; startsOn: string; endsOn: string | null; evidenceDescription: string; status: string; recordedById: string; recordedBy: string; decidedBy: string | null; decisionNote: string | null; endedAt: string | null; endReason: string | null; inEffect: boolean }
interface Consent { id: string; purpose: string; scope: string; boxName: string | null; noticeVersion: string; channel: string; grantedOn: string; givenBy: string; authorityHolder: string | null; authorityInEffect: boolean; capacityReviewed: boolean; recordedBy: string; withdrawnAt: string | null; withdrawnOn: string | null; uses: { boxId: string; boxName: string }[] }
interface Item { type: string; id: string | null; label: string; roles?: string[]; code?: string; params?: Record<string, string | number> }
/** A review item in the reader's language; the stored label is the fallback. */
function itemText(i: Item, x: X, locale: Locale): string {
  if (i.code === 'rule_unconfirmed') return x.ruleUnconfirmed(Number(i.params?.age), String(i.params?.jurisdiction));
  if (i.code === 'leap_day') return x.leap;
  if (i.code === 'ends_on') return x.endsOn(String(i.params?.holder), day(String(i.params?.on), locale));
  if (i.type === 'authority' && i.code) return `${x.kinds[i.code] ?? i.code}: ${i.label}`;
  if (i.type === 'policy') return `${i.label}${i.roles?.length ? ` (${i.roles.map((r) => x.policyRoles[r] ?? r).join(', ')})` : ''}`;
  return i.label;
}
interface Review { id: string; kind: string; contactId?: string; fullName?: string; items: Item[]; dueOn: string; milestoneOn: string | null; lifeEventKind?: string | null; consentPurpose?: string | null; resolvedAt: string | null; resolvedBy: string | null; resolutionNote: string | null; overdue?: boolean }
interface View {
  person: { id: string; fullName: string | null; dateOfBirth: string | null; age: number | null; deceasedOn: string | null; residenceJurisdiction: string | null };
  capacity: { jurisdiction: string | null; rule: { minAge: number; counselConfirmed: boolean } | null; minor: boolean | null; reachesOn: string | null; leapDay: boolean };
  noticeVersion: string; consents: Consent[]; authorities: { about: Auth[]; held: Auth[] };
  idReferences: { id: string; method: string; documentsSeen: string[]; result: string; checkedOn: string; checkedBy: string; note: string | null }[];
  dealIdRecords: { id: string; method: string; result: string; checkedOn: string; checkedBy: string; boxName: string }[];
  lifeEvents: { id: string; kind: string; occurredOn: string; note: string | null; recordedBy: string }[];
  reviews: Review[]; canEdit: boolean; canVerify: boolean; viewerId: string;
}

/** Whether Gate C is on. */
export function useFamilyComplianceOn(call: Call): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { call('GET', '/v1/compliance-reviews').then(() => setOn(true), () => setOn(false)); }, [call]);
  return on;
}

function Sel({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return <><label>{label}</label><select aria-label={label} value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>{opts.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></>;
}
function DateIn({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <><label>{label}</label><input aria-label={label} type="date" value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} /></>;
}
function Txt({ label, value, onChange, max = 500 }: { label: string; value: string; onChange: (v: string) => void; max?: number }) {
  return <><label>{label}</label><input aria-label={label} maxLength={max} value={value} onInput={(e) => onChange((e.target as HTMLInputElement).value)} /></>;
}

/** The person's consents, authority, ID checks, life events and reviews (client panel). */
export function PersonCompliance({ call, locale, contactId }: { call: Call; locale: Locale; contactId: string }) {
  const x = S(locale);
  const [v, setV] = useState<View | null>(null);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const [form, setForm] = useState<'' | 'consent' | 'auth' | 'id' | 'event'>('');
  const [note, setNote] = useState('');
  const load = useCallback(async () => {
    try { setV(await call('GET', `/v1/people/${contactId}/compliance`)); } catch (e) { if ((e as { status?: number }).status === 404) setOff(true); else setErr(msg(e)); }
  }, [call, contactId]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, after?: (r: any) => void) => { setErr(''); setNote(''); try { const r = await fn(); setForm(''); after?.(r); await load(); } catch (e) { setErr(msg(e)); } };
  if (off) return null;
  if (!v) return <p class="muted">{err || x.loading}</p>;
  const cap = v.capacity;
  const verifiedAuth = v.authorities.about.filter((a) => a.inEffect);
  return (
    <section aria-label={x.compliance} style={{ marginTop: '16px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '14px' }}>{x.compliance}</h3>
      {err && !form && <p class="err" role="alert">{err}</p>}
      {note && <p role="status" class="hcard" style={{ borderColor: 'var(--ok)' }}>{note}</p>}
      <div class="hcard">
        {v.canEdit
          ? <Sel label={x.residence} value={v.person.residenceJurisdiction ?? ''} onChange={(j) => act(() => call('PATCH', `/v1/people/${contactId}/residence`, { jurisdiction: j || null }))} opts={[['', x.notSet], ...JURS.map((j) => [j, j] as [string, string])]} />
          : <p style={{ margin: 0 }}>{x.residence}: {v.person.residenceJurisdiction ?? x.notSet}</p>}
        <p class="muted" style={{ margin: '6px 0 0', fontSize: '12.5px' }}>
          {cap.rule ? x.majority(cap.rule.minAge, cap.jurisdiction!, cap.rule.counselConfirmed) : cap.jurisdiction ? x.noRule : ''}{' '}
          {cap.rule && (v.person.dateOfBirth ? (cap.minor ? x.minor(day(cap.reachesOn, locale)) : x.adult) : x.noDob)}{cap.leapDay ? ` ${x.leap}` : ''}
        </p>
      </div>

      <H>{x.consents}</H>
      {v.consents.length === 0 ? <p class="muted">{x.none}</p> : <ul class="maplist">{v.consents.map((c) => <ConsentRow key={c.id} c={c} x={x} locale={locale} canEdit={v.canEdit && !c.withdrawnAt}
        onWithdraw={(on, ch) => act(() => call('POST', `/v1/people/${contactId}/consents/${c.id}/withdraw`, { withdrawnOn: on, channel: ch }))} />)}</ul>}
      {err && form === 'consent' && <p class="err" role="alert">{err}</p>}
      {v.canEdit && !v.person.deceasedOn && (form === 'consent'
        ? <ConsentForm x={x} minor={cap.minor === true} authorities={verifiedAuth} onCancel={() => setForm('')} onSave={(b) => act(() => call('POST', `/v1/people/${contactId}/consents`, b))} />
        : <button type="button" class="btn quiet" onClick={() => setForm('consent')}>{x.record}</button>)}

      <H>{x.authorities}</H>
      {[['about', v.authorities.about], ['held', v.authorities.held]].map(([k, list]) => (list as Auth[]).length > 0 && (
        <div key={k as string}><p class="muted" style={{ margin: '4px 0 0', fontSize: '12.5px' }}>{k === 'about' ? x.about : x.held}</p>
          <ul class="maplist">{(list as Auth[]).map((a) => <AuthRow key={a.id} a={a} x={x} locale={locale} canVerify={v.canVerify && a.recordedById !== v.viewerId} mine={a.recordedById === v.viewerId} canEnd={v.canEdit || v.canVerify}
            onDecide={(d, n) => act(() => call('POST', `/v1/authorities/${a.id}/decide`, { decision: d, note: n }))}
            onEnd={(r) => act(() => call('POST', `/v1/authorities/${a.id}/end`, { reason: r }))} />)}</ul></div>
      ))}
      {v.authorities.about.length + v.authorities.held.length === 0 && <p class="muted">{x.none}</p>}
      {err && form === 'auth' && <p class="err" role="alert">{err}</p>}
      {v.canEdit && (form === 'auth'
        ? <AuthForm call={call} locale={locale} x={x} self={contactId} onCancel={() => setForm('')} onSave={(b) => act(() => call('POST', `/v1/people/${contactId}/authorities`, b))} />
        : <button type="button" class="btn quiet" onClick={() => setForm('auth')}>{x.recordAuth}</button>)}

      <H>{x.ids}</H>
      {v.idReferences.length + v.dealIdRecords.length === 0 ? <p class="muted">{x.none}</p> : (
        <ul class="maplist">
          {v.idReferences.map((r) => <li key={r.id}><Chip tone={r.result === 'verified' ? 'ok' : 'warn'}>{x.results[r.result]}</Chip>{x.methods[r.method]} · {day(r.checkedOn, locale)} · {r.documentsSeen.map((d) => x.docs[d]).join(', ') || '—'} <span class="muted">· {r.checkedBy}</span></li>)}
          {v.dealIdRecords.map((r) => <li key={r.id} class="muted"><Chip tone="mute">{x.results[r.result] ?? r.result}</Chip>{x.methods[r.method] ?? r.method} · {day(r.checkedOn, locale)} · {r.boxName} <span style={{ fontSize: '12px' }}>({x.older})</span></li>)}
        </ul>
      )}
      {err && form === 'id' && <p class="err" role="alert">{err}</p>}
      {v.canEdit && (form === 'id'
        ? <IdForm x={x} onCancel={() => setForm('')} onSave={(b) => act(() => call('POST', `/v1/people/${contactId}/id-references`, b))} />
        : <button type="button" class="btn quiet" onClick={() => setForm('id')}>{x.recordId}</button>)}

      <H>{x.events}</H>
      {v.lifeEvents.length === 0 ? <p class="muted">{x.none}</p> : <ul class="maplist">{v.lifeEvents.map((e) => <li key={e.id}>{x.eventKinds[e.kind]} · {day(e.occurredOn, locale)} <span class="muted">· {e.recordedBy}</span></li>)}</ul>}
      {err && form === 'event' && <p class="err" role="alert">{err}</p>}
      {v.canEdit && (form === 'event'
        ? <EventForm x={x} onCancel={() => setForm('')} onSave={(b) => act(() => call('POST', `/v1/people/${contactId}/life-events`, b), (r) => setNote(x.opened(r.items.length)))} />
        : <button type="button" class="btn quiet" onClick={() => setForm('event')}>{x.recordEvent}</button>)}

      {v.reviews.length > 0 && <><H>{x.reviews}</H><ReviewList reviews={v.reviews} x={x} locale={locale} canResolve={v.canEdit || v.canVerify} onResolve={(id, n) => act(() => call('POST', `/v1/compliance-reviews/${id}/resolve`, { note: n }))} /></>}
    </section>
  );
}

function ConsentRow({ c, x, locale, canEdit, onWithdraw }: { c: Consent; x: X; locale: Locale; canEdit: boolean; onWithdraw: (on: string, ch: string) => void }) {
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(today());
  const [ch, setCh] = useState('email');
  const live = !c.withdrawnAt && c.authorityInEffect;
  return (
    <li>
      <Chip tone={live ? 'ok' : 'mute'}>{c.withdrawnAt ? x.withdrawn : live ? x.inForce : x.notInEffect}</Chip>
      <strong>{x.purposes[c.purpose]}</strong> <span class="muted">· {c.scope === 'deal' ? `${x.oneDeal}: ${c.boxName ?? '—'}` : x.allDealings} · {day(c.grantedOn, locale)} · {x.channels[c.channel]} · {c.givenBy === 'self' ? x.self : `${x.underAuth}: ${c.authorityHolder}`} · {x.notice} {c.noticeVersion}</span>
      {c.withdrawnOn && <span class="muted"> · {x.withdrawnOn} {day(c.withdrawnOn, locale)}</span>}
      {c.uses.length > 0 && <div class="muted" style={{ fontSize: '12px' }}>{x.usedBy}: {c.uses.map((u) => u.boxName).join(', ')}</div>}
      {canEdit && (open
        ? <div class="hcard" style={{ marginTop: '4px' }}><DateIn label={x.withdrawnOn} value={on} onChange={setOn} /><Sel label={x.channel} value={ch} onChange={setCh} opts={[...CHANNELS, 'letter'].map((k) => [k, x.channels[k]!] as [string, string])} />
          <div class="actions"><button type="button" class="btn" onClick={() => onWithdraw(on, ch)}>{x.withdraw}</button><button type="button" class="btn quiet" onClick={() => setOpen(false)}>{x.cancel}</button></div></div>
        : <button type="button" class="linkbtn" style={{ fontSize: '12.5px', marginLeft: '6px' }} onClick={() => setOpen(true)}>{x.withdraw}</button>)}
    </li>
  );
}

function ConsentForm({ x, minor, authorities, onSave, onCancel }: { x: X; minor: boolean; authorities: Auth[]; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [purpose, setPurpose] = useState('collection_use');
  const [channel, setChannel] = useState('in_person');
  const [on, setOn] = useState(today());
  const [by, setBy] = useState(minor && authorities.length ? 'authority' : 'self');
  const [auth, setAuth] = useState(authorities[0]?.id ?? '');
  const [cap, setCap] = useState('');
  const usable = authorities.filter((a) => a.purposes.includes(purpose));
  return (
    <div class="hcard" style={{ marginTop: '6px' }}>
      <Sel label={x.purpose} value={purpose} onChange={setPurpose} opts={PURPOSES.map((p) => [p, x.purposes[p]!])} />
      <Sel label={x.channel} value={channel} onChange={setChannel} opts={CHANNELS.map((c) => [c, x.channels[c]!])} />
      <DateIn label={x.given} value={on} onChange={setOn} />
      <Sel label={x.givenBy} value={by} onChange={setBy} opts={[['self', x.self], ['authority', x.underAuth]]} />
      {by === 'authority' && <Sel label={x.authority} value={auth} onChange={setAuth} opts={usable.length ? usable.map((a) => [a.id, `${a.holderName} · ${x.kinds[a.kind]}`]) : [['', '—']]} />}
      {by === 'self' && minor && <><p class="muted" style={{ fontSize: '12.5px', margin: '6px 0 0' }}>{x.capHelp}</p><Txt label={x.capNote} value={cap} onChange={setCap} /></>}
      <div class="actions"><button type="button" class="btn" onClick={() => onSave({ purpose, scope: 'all_dealings', channel, grantedOn: on, givenBy: by,
        ...(by === 'authority' ? { authorityId: (usable.find((a) => a.id === auth) ?? usable[0])?.id } : {}), ...(by === 'self' && cap.trim() ? { capacityReviewedNote: cap.trim() } : {}) })}>{x.save}</button>
        <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button></div>
    </div>
  );
}

function AuthRow({ a, x, locale, canVerify, mine, canEnd, onDecide, onEnd }: { a: Auth; x: X; locale: Locale; canVerify: boolean; mine: boolean; canEnd: boolean; onDecide: (d: string, n: string) => void; onEnd: (r: string) => void }) {
  const [n, setN] = useState('');
  const [why, setWhy] = useState('');
  const status = a.endedAt ? x.ended : a.status === 'pending' ? x.pending : a.status === 'verified' ? (a.inEffect ? x.verified : `${x.verified}, ${x.notInEffect}`) : x.rejected;
  return (
    <li>
      <Chip tone={a.inEffect ? 'ok' : a.status === 'pending' && !a.endedAt ? 'warn' : 'mute'}>{status}</Chip>
      <strong>{x.kinds[a.kind]}</strong> <span class="muted">· {a.holderName} → {a.subjectName} · {a.purposes.map((p) => x.purposes[p]).join(', ')} · {day(a.startsOn, locale)}{a.endsOn ? ` – ${day(a.endsOn, locale)}` : ''}</span>
      <div class="muted" style={{ fontSize: '12px' }}>{a.evidenceDescription} · {a.recordedBy}{a.decidedBy ? ` · ${a.decidedBy}: ${a.decisionNote}` : ''}{a.endReason ? ` · ${x.endReasons[a.endReason]}` : ''}</div>
      {a.status === 'pending' && !a.endedAt && mine && <div class="muted" style={{ fontSize: '12px' }}>{x.selfRecorded}</div>}
      {a.status === 'pending' && !a.endedAt && canVerify && (
        <div class="hcard" style={{ marginTop: '4px' }}><Txt label={x.decision} value={n} onChange={setN} />
          <div class="actions"><button type="button" class="btn" disabled={n.trim().length < 5} onClick={() => onDecide('verified', n)}>{x.verify}</button><button type="button" class="btn quiet" disabled={n.trim().length < 5} onClick={() => onDecide('rejected', n)}>{x.reject}</button></div></div>
      )}
      {!a.endedAt && a.status !== 'rejected' && canEnd && (
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginTop: '4px' }}>
          <select aria-label={x.endWhy} value={why} onChange={(e) => setWhy((e.target as HTMLSelectElement).value)}><option value="">{x.endWhy}</option>{END_REASONS.map((r) => <option key={r} value={r}>{x.endReasons[r]}</option>)}</select>
          <button type="button" class="btn quiet" disabled={!why} onClick={() => onEnd(why)}>{x.end}</button>
        </div>
      )}
    </li>
  );
}

function AuthForm({ call, locale, x, self, onSave, onCancel }: { call: Call; locale: Locale; x: X; self: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [kind, setKind] = useState<string>('guardian_of_minor');
  const [holderType, setHolderType] = useState('client');
  const [holder, setHolder] = useState<{ id: string; label: string } | null>(null);
  const [name, setName] = useState('');
  const [purposes, setPurposes] = useState<string[]>(['collection_use', 'carrier_sharing']);
  const [starts, setStarts] = useState(today());
  const [ends, setEnds] = useState('');
  const [ev, setEv] = useState('');
  const toggle = (p: string) => setPurposes(purposes.includes(p) ? purposes.filter((q) => q !== p) : [...purposes, p]);
  return (
    <div class="hcard" style={{ marginTop: '6px' }}>
      <Sel label={x.kind} value={kind} onChange={setKind} opts={AUTH_KINDS.map((k) => [k, x.kinds[k]!])} />
      <Sel label={x.holder} value={holderType} onChange={setHolderType} opts={[['client', x.holderClient], ['outside', x.holderOutside]]} />
      {holderType === 'client'
        ? (holder ? <p style={{ margin: '6px 0 0' }}><strong>{holder.label}</strong> <button type="button" class="linkbtn" onClick={() => setHolder(null)}>×</button></p>
          : <ClientPicker call={call} locale={locale} exclude={[self]} onPick={(c) => setHolder({ id: c.id, label: c.fullName || c.email || '—' })} />)
        : <Txt label={x.holderOutside} value={name} onChange={setName} max={200} />}
      <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }}><legend style={{ fontSize: '13px' }}>{x.scope}</legend>
        {AUTH_PURPOSES.map((p) => <label key={p} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400, margin: '2px 0' }}><input style={{ width: 'auto', margin: 0, minHeight: 0 }} type="checkbox" checked={purposes.includes(p)} onChange={() => toggle(p)} /> {x.purposes[p]}</label>)}
      </fieldset>
      <DateIn label={x.starts} value={starts} onChange={setStarts} />
      <DateIn label={x.ends} value={ends} onChange={setEnds} />
      <Txt label={x.evidence} value={ev} onChange={setEv} />
      <div class="actions"><button type="button" class="btn" disabled={!purposes.length || ev.trim().length < 10 || (holderType === 'client' ? !holder : name.trim().length < 2)}
        onClick={() => onSave({ kind, purposes, startsOn: starts, ...(ends ? { endsOn: ends } : {}), evidenceDescription: ev.trim(), ...(holderType === 'client' ? { holderContactId: holder!.id } : { holderName: name.trim() }) })}>{x.save}</button>
        <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button></div>
    </div>
  );
}

function IdForm({ x, onSave, onCancel }: { x: X; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [method, setMethod] = useState('in_person');
  const [result, setResult] = useState('verified');
  const [on, setOn] = useState(today());
  const [docs, setDocs] = useState<string[]>([]);
  const [note, setNote] = useState('');
  return (
    <div class="hcard" style={{ marginTop: '6px' }}>
      <Sel label={x.method} value={method} onChange={setMethod} opts={Object.entries(x.methods)} />
      <Sel label={x.result} value={result} onChange={setResult} opts={Object.entries(x.results)} />
      <DateIn label={x.checked} value={on} onChange={setOn} />
      <fieldset style={{ border: 0, padding: 0, margin: '8px 0 0' }}><legend style={{ fontSize: '13px' }}>{x.seen}</legend>
        {DOCS.map((d) => <label key={d} style={{ display: 'inline-flex', gap: '6px', alignItems: 'center', fontWeight: 400, marginRight: '12px' }}><input style={{ width: 'auto', margin: 0, minHeight: 0 }} type="checkbox" checked={docs.includes(d)} disabled={!docs.includes(d) && docs.length >= 5} onChange={() => setDocs(docs.includes(d) ? docs.filter((q) => q !== d) : [...docs, d])} /> {x.docs[d]}</label>)}
      </fieldset>
      <Txt label={x.idNote} value={note} onChange={setNote} max={300} />
      <div class="actions"><button type="button" class="btn" onClick={() => onSave({ method, result, checkedOn: on, documentsSeen: docs, ...(note.trim() ? { note: note.trim() } : {}) })}>{x.save}</button>
        <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button></div>
    </div>
  );
}

function EventForm({ x, onSave, onCancel }: { x: X; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [kind, setKind] = useState('move');
  const [on, setOn] = useState(today());
  const [note, setNote] = useState('');
  return (
    <div class="hcard" style={{ marginTop: '6px' }}>
      <p class="muted" style={{ margin: 0, fontSize: '12.5px' }}>{x.eventHelp}</p>
      <Sel label={x.kind} value={kind} onChange={setKind} opts={EVENTS.map((k) => [k, x.eventKinds[k]!])} />
      <DateIn label={x.occurred} value={on} onChange={setOn} />
      <Txt label={x.idNote.split(' (')[0]!} value={note} onChange={setNote} />
      <div class="actions"><button type="button" class="btn" onClick={() => onSave({ kind, occurredOn: on, ...(note.trim() ? { note: note.trim() } : {}) })}>{x.save}</button>
        <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button></div>
    </div>
  );
}

function ReviewList({ reviews, x, locale, canResolve, onResolve, showName }: { reviews: Review[]; x: X; locale: Locale; canResolve: boolean; onResolve: (id: string, note: string) => void; showName?: boolean }) {
  const [notes, setNotes] = useState<Record<string, string>>({});
  return (
    <ul class="maplist">{reviews.map((r) => (
      <li key={r.id}>
        <Chip tone={r.resolvedAt ? 'mute' : r.overdue ? 'warn' : 'ok'}>{r.resolvedAt ? x.resolved : r.overdue ? x.overdue : `${x.due} ${day(r.dueOn, locale)}`}</Chip>
        <strong>{showName && r.fullName ? `${r.fullName} · ` : ''}{x.reviewKinds[r.kind]}{r.lifeEventKind ? `: ${x.eventKinds[r.lifeEventKind]}` : ''}{r.consentPurpose ? `: ${x.purposes[r.consentPurpose]}` : ''}{r.milestoneOn ? ` · ${day(r.milestoneOn, locale)}` : ''}</strong>
        {r.items.length > 0 && <ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontSize: '12.5px' }}>{r.items.map((i, k) => <li key={k}>{itemText(i, x, locale)}</li>)}</ul>}
        {r.resolvedAt && <div class="muted" style={{ fontSize: '12px' }}>{r.resolvedBy}: {r.resolutionNote}</div>}
        {!r.resolvedAt && canResolve && (
          <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
            <input aria-label={x.resolution} placeholder={x.resolution} maxLength={500} value={notes[r.id] ?? ''} onInput={(e) => setNotes({ ...notes, [r.id]: (e.target as HTMLInputElement).value })} style={{ flex: 1 }} />
            <button type="button" class="btn quiet" disabled={(notes[r.id] ?? '').trim().length < 5} onClick={() => onResolve(r.id, notes[r.id]!.trim())}>{x.resolve}</button>
          </div>
        )}
      </li>
    ))}</ul>
  );
}

/** Family panel: each member's consents, authority, ID and reviews at a glance. */
export function FamilyCompliance({ call, locale, familyId, onOpenPerson }: { call: Call; locale: Locale; familyId: string; onOpenPerson?: (id: string) => void }) {
  const x = S(locale);
  const [rows, setRows] = useState<any[] | null>(null);
  const [off, setOff] = useState(false);
  useEffect(() => { call('GET', `/v1/families/${familyId}/compliance`).then((r) => setRows(r.members), (e) => { if ((e as { status?: number }).status === 404) setOff(true); else setRows([]); }); }, [call, familyId]);
  if (off || !rows) return null;
  return (
    <section aria-label={x.family} style={{ marginTop: '16px' }}>
      <h3 style={{ margin: '0 0 4px', fontSize: '14px' }}>{x.family}</h3>
      <ul class="maplist">{rows.map((m) => (
        <li key={m.contactId} style={{ whiteSpace: 'normal' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'baseline' }}>
            {onOpenPerson ? <button type="button" class="linkbtn" style={{ fontWeight: 600 }} onClick={() => onOpenPerson(m.contactId)}>{m.fullName ?? '—'}</button> : <strong>{m.fullName}</strong>}
            {m.minor && <Chip tone="warn">{x.minorTag}</Chip>}
            {m.minor && m.reachesMajorityOn && <span class="muted" style={{ fontSize: '12px' }}>{x.turns(m.majorityAge, day(m.reachesMajorityOn, locale))}</span>}
            {m.verifiedAuthorities > 0 && <Chip tone="ok">{x.guardianTag(m.verifiedAuthorities)}</Chip>}
            {m.pendingAuthorities > 0 && <Chip tone="warn">{x.pendingTag(m.pendingAuthorities)}</Chip>}
            {m.openReviews > 0 && <Chip tone="warn">{x.reviewsCol}: {m.openReviews}</Chip>}
          </div>
          <div style={{ fontSize: '12.5px', marginTop: '3px' }}>
            <span class="muted">{x.consents}: </span>{m.consentsInForce.length ? m.consentsInForce.map((p: string) => <Chip key={p} tone="ok">{x.purposes[p]}</Chip>) : <span class="muted">—</span>}
            <span class="muted" style={{ marginLeft: '8px' }}>{x.idCol}: </span>{m.latestId ? <Chip tone={m.latestId.result === 'verified' ? 'ok' : 'warn'}>{x.results[m.latestId.result]} {day(m.latestId.checkedOn, locale)}</Chip> : <span class="muted">—</span>}
          </div>
        </li>
      ))}</ul>
    </section>
  );
}

/** Deal record: who on the deal is covered, which existing consents can be reused, and ID status by role. */
export function DealPeopleCompliance({ call, locale, boxId }: { call: Call; locale: Locale; boxId: string }) {
  const x = S(locale);
  const [d, setD] = useState<any | null>(null);
  const [off, setOff] = useState(false);
  const [err, setErr] = useState('');
  const load = useCallback(() => call('GET', `/v1/boxes/${boxId}/person-compliance`).then(setD, (e) => { if ((e as { status?: number }).status === 404) setOff(true); else setErr(msg(e)); }), [call, boxId]);
  useEffect(() => { void load(); }, [load]);
  if (off || !d) return null;
  return (
    <div class="rec-form" style={{ marginTop: '14px' }}>
      <h3>{x.dealPeople}</h3>
      <p class="muted">{x.dealHelp}{d.idRulesSet ? '' : ` ${x.noRules}`}</p>
      {err && <p class="err" role="alert">{err}</p>}
      {d.people.map((p: any) => (
        <div key={p.contactId} class="ev">
          <strong>{p.fullName}</strong> <Chip tone={p.id.status === 'current' || p.id.status === 'not_required' ? 'ok' : p.id.status === 'no_rule' ? 'mute' : 'warn'}>{x.idStatus[p.id.status]}</Chip>
          <ul style={{ margin: '4px 0 0', paddingLeft: '18px' }}>{p.purposes.filter((q: any) => q.inForce || q.candidates.length).map((q: any) => (
            <li key={q.purpose}>{x.purposes[q.purpose]}: {q.inForce ? <Chip tone="ok">{x.inForce}</Chip> : q.candidates.map((c: any) => c.ok
              ? <span key={c.id}>{d.canEdit && <button type="button" class="btn quiet" onClick={async () => { setErr(''); try { await call('POST', `/v1/boxes/${boxId}/consent-uses`, { consentId: c.id }); await load(); } catch (e) { setErr(msg(e)); } }}>{x.use}</button>} <span class="muted">{day(c.grantedOn, locale)}</span></span>
              : <span key={c.id} class="muted"> {x.cannot}: {c.reasons.join('; ')}. {x.needNew}</span>)}</li>
          ))}</ul>
        </div>
      ))}
    </div>
  );
}

/** Contacts page: open reviews, and for compliance, authorities waiting for verification. */
export function ReviewsQueue({ call, locale, onClose }: { call: Call; locale: Locale; onClose: () => void }) {
  const x = S(locale);
  const [reviews, setReviews] = useState<Review[] | null>(null);
  const [auths, setAuths] = useState<Auth[]>([]);
  const [err, setErr] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try { setReviews((await call('GET', '/v1/compliance-reviews')).reviews); setAuths((await call('GET', '/v1/authorities/pending')).authorities); } catch (e) { setErr(msg(e)); }
  }, [call]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); await load(); } catch (e) { setErr(msg(e)); } };
  return (
    <aside tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.queue} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <h2>{x.queue}</h2>
      {err && <p class="err" role="alert">{err}</p>}
      {auths.length > 0 && (
        <section aria-label={x.toVerify}>
          <h3 style={{ fontSize: '14px', margin: '8px 0 2px' }}>{x.toVerify}</h3>
          <p class="muted" style={{ fontSize: '12.5px', margin: 0 }}>{x.verifyHelp}</p>
          <ul class="maplist">{auths.map((a) => (
            <li key={a.id}>
              <strong>{x.kinds[a.kind]}</strong> <span class="muted">· {a.holderName} → {a.subjectName} · {a.purposes.map((p) => x.purposes[p]).join(', ')}</span>
              <div class="muted" style={{ fontSize: '12px' }}>{a.evidenceDescription} · {a.recordedBy}</div>
              <div style={{ display: 'flex', gap: '6px', marginTop: '4px', alignItems: 'center' }}>
                <input aria-label={x.decision} placeholder={x.decision} maxLength={500} value={notes[a.id] ?? ''} onInput={(e) => setNotes({ ...notes, [a.id]: (e.target as HTMLInputElement).value })} style={{ flex: 1 }} />
                <button type="button" class="btn" disabled={(notes[a.id] ?? '').trim().length < 5} onClick={() => act(() => call('POST', `/v1/authorities/${a.id}/decide`, { decision: 'verified', note: notes[a.id] }))}>{x.verify}</button>
                <button type="button" class="btn quiet" disabled={(notes[a.id] ?? '').trim().length < 5} onClick={() => act(() => call('POST', `/v1/authorities/${a.id}/decide`, { decision: 'rejected', note: notes[a.id] }))}>{x.reject}</button>
              </div>
            </li>
          ))}</ul>
        </section>
      )}
      <h3 style={{ fontSize: '14px', margin: '12px 0 2px' }}>{x.reviews}</h3>
      {!reviews ? <p class="muted">{x.loading}</p> : reviews.length === 0 ? <p class="muted">{x.noneOpen}</p>
        : <ReviewList reviews={reviews} x={x} locale={locale} canResolve showName onResolve={(id, n) => act(() => call('POST', `/v1/compliance-reviews/${id}/resolve`, { note: n }))} />}
      <div class="actions"><button type="button" class="btn quiet" onClick={onClose}>{x.close}</button></div>
    </aside>
  );
}
