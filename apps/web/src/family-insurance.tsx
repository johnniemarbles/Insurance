// Families, Gate B screens: family policy totals (each policy once), the coverage grid (evidence only, unknown by
// default), who is on a policy (with beneficiary groups), and the queue of policies missing people.
// Shown only when the server has FAMILIES_INSURANCE_ENABLED on: a 404 from the first call hides everything here.
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { ClientPicker, type Call } from './families.tsx';

type PartyRole = 'owner' | 'joint_owner' | 'insured' | 'joint_insured' | 'payor' | 'beneficiary' | 'trustee';
const ROLES: PartyRole[] = ['owner', 'joint_owner', 'insured', 'joint_insured', 'payor', 'beneficiary', 'trustee'];
type CovState = 'covered' | 'potential_gap' | 'unknown' | 'declined';
interface Policy { id: string; carrierName: string; policyNumber: string; planName: string; status: string; annualPremiumCents: number; currency: 'CAD' | 'USD' | null; expiryDate: string | null; people?: { contactId: string; fullName: string | null; roles: PartyRole[] }[]; missing?: string[] }
interface Finding { code: string; message: string }
interface Party { id: string; contactId: string | null; fullName: string | null; outsideName: string | null; role: PartyRole; beneficiaryClass: 'primary' | 'contingent' | null; insuredContactId: string | null; allocationMethod: 'percentage' | 'equal' | 'estate' | null; shareBasisPoints: number | null; relationshipToInsured: string | null }

const L = {
  en: {
    insurance: 'Insurance', premium: 'Annual premium', inForce: (n: number) => `${n} in force`, nextRenewal: 'Next renewal', none: 'No policies linked to this family yet.',
    partial: 'These totals are incomplete:', beneficiaryOf: 'Named as beneficiary on', policies: 'Policies', coverage: 'Coverage', unknownHelp: 'Grey means unknown: nothing on file. It is not a gap.',
    people: 'People on this policy', back: 'Back', add: 'Add', addPerson: 'Add a person', role: 'Role', client: 'Client', outside: 'Someone not on file (name)', estate: 'The estate',
    cls: 'Class', primary: 'Primary', contingent: 'Contingent', split: 'Split', pct: 'Percentage', equal: 'Equal shares', share: 'Share (%)', whoseLife: 'On whose life', anyLife: 'Only one insured life',
    relation: 'Relationship to insured', end: 'Remove', ready: 'Ready to submit', notReady: 'Not ready to submit', warnings: 'Notes', check: 'Check',
    unconfirmed: 'Carrier rules not yet confirmed with the carrier.', canView: 'You can see this policy but only the producing partner can change who is on it.',
    setCoverage: 'Record coverage', state: 'State', evidencePolicy: 'Policy on file', outsideCov: 'Outside coverage (describe)', na: 'Signed needs analysis', note: 'Note', reviewBy: 'Review by', save: 'Save', cancel: 'Cancel',
    noEvidence: 'Nothing to point to yet.', fixup: 'Policies missing people', fixupHelp: 'In force or pending, without an owner or an insured. Nothing is filled in automatically.', missing: 'Missing', open: 'Open', close: 'Close', otherClient: 'Another client…', loading: 'Loading…',
    linkPolicy: 'Link a policy', findPolicy: 'Find a policy by number, plan or carrier', noPolicies: 'No matching policies you can see.',
    statuses: { active: 'In force', reinstated: 'In force', pending: 'Pending', lapsed: 'Lapsed', cancelled: 'Cancelled', surrendered: 'Surrendered' } as Record<string, string>,
    roles: { owner: 'Owner', joint_owner: 'Joint owner', insured: 'Insured', joint_insured: 'Joint insured', payor: 'Payor', beneficiary: 'Beneficiary', trustee: 'Trustee' } as Record<PartyRole, string>,
    states: { covered: 'Covered', potential_gap: 'Potential gap', unknown: 'Unknown', declined: 'Declined' } as Record<CovState, string>,
  },
  'fr-CA': {
    insurance: 'Assurances', premium: 'Prime annuelle', inForce: (n: number) => `${n} en vigueur`, nextRenewal: 'Prochain renouvellement', none: 'Aucune police liée à cette famille pour l’instant.',
    partial: 'Ces totaux sont incomplets :', beneficiaryOf: 'Désigné bénéficiaire de', policies: 'Polices', coverage: 'Couverture', unknownHelp: 'Le gris signifie inconnu : rien au dossier. Ce n’est pas une lacune.',
    people: 'Personnes sur cette police', back: 'Retour', add: 'Ajouter', addPerson: 'Ajouter une personne', role: 'Rôle', client: 'Client', outside: 'Personne hors dossier (nom)', estate: 'La succession',
    cls: 'Catégorie', primary: 'Principal', contingent: 'Subsidiaire', split: 'Répartition', pct: 'Pourcentage', equal: 'Parts égales', share: 'Part (%)', whoseLife: 'Sur la vie de', anyLife: 'Une seule vie assurée',
    relation: 'Lien avec l’assuré', end: 'Retirer', ready: 'Prête à soumettre', notReady: 'Pas prête à soumettre', warnings: 'Remarques', check: 'Vérifier',
    unconfirmed: 'Règles de l’assureur pas encore confirmées avec l’assureur.', canView: 'Vous pouvez voir cette police, mais seul le partenaire producteur peut changer qui y figure.',
    setCoverage: 'Inscrire la couverture', state: 'État', evidencePolicy: 'Police au dossier', outsideCov: 'Couverture externe (décrire)', na: 'Analyse des besoins signée', note: 'Note', reviewBy: 'Révision avant le', save: 'Enregistrer', cancel: 'Annuler',
    noEvidence: 'Rien à citer pour l’instant.', fixup: 'Polices sans personnes', fixupHelp: 'En vigueur ou en attente, sans titulaire ou sans assuré. Rien n’est rempli automatiquement.', missing: 'Manque', open: 'Ouvrir', close: 'Fermer', otherClient: 'Un autre client…', loading: 'Chargement…',
    linkPolicy: 'Lier une police', findPolicy: 'Trouver une police par numéro, produit ou assureur', noPolicies: 'Aucune police correspondante que vous pouvez voir.',
    statuses: { active: 'En vigueur', reinstated: 'En vigueur', pending: 'En attente', lapsed: 'Déchue', cancelled: 'Annulée', surrendered: 'Rachetée' } as Record<string, string>,
    roles: { owner: 'Titulaire', joint_owner: 'Cotitulaire', insured: 'Assuré', joint_insured: 'Coassuré', payor: 'Payeur', beneficiary: 'Bénéficiaire', trustee: 'Fiduciaire' } as Record<PartyRole, string>,
    states: { covered: 'Couvert', potential_gap: 'Lacune possible', unknown: 'Inconnu', declined: 'Refusé' } as Record<CovState, string>,
  },
};
const S = (l: Locale) => L[l] ?? L.en;
// Canadian formatting on a Canadian server: CAD shows as "$", USD as "US$" (and the reverse in French: "3 600,00 $").
const money = (cents: number, currency: string | null, l: Locale) => currency
  ? new Intl.NumberFormat(l === 'fr-CA' ? 'fr-CA' : 'en-CA', { style: 'currency', currency }).format(cents / 100)
  : `${(cents / 100).toFixed(2)} ?`;
const day = (iso: string | null, l: Locale) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString(l, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
const statusOf = (e: unknown) => (e as { status?: number }).status;
const STATE_STYLE: Record<CovState, { background: string; color: string }> = {
  covered: { background: 'var(--ok-soft)', color: 'var(--ok)' },
  potential_gap: { background: 'var(--warn-soft)', color: 'var(--warn)' },
  unknown: { background: 'var(--tint)', color: 'var(--mute)' },
  declined: { background: 'var(--tint2)', color: 'var(--ink)' },
};

/** Who is on one policy, with the submission check. */
export function PolicyPeople({ call, locale, policyId, familyMembers, onBack, onChanged }: { call: Call; locale: Locale; policyId: string; familyMembers: { contactId: string; fullName: string | null }[]; onBack: () => void; onChanged?: () => void }) {
  const x = S(locale);
  const [d, setD] = useState<{ policy: Policy; parties: Party[]; check: { ready: boolean; errors: Finding[]; warnings: Finding[] }; canEdit: boolean; profile: { confirmedWithCarrier: boolean } } | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const load = useCallback(async () => { try { setD(await call('GET', `/v1/policies/${policyId}/parties`)); } catch (e) { setErr((e as Error).message); } }, [call, policyId]);
  useEffect(() => { void load(); }, [load]);
  const changed = async () => { await load(); onChanged?.(); };
  if (!d) return <div>{err ? <p class="err" role="alert">{err}</p> : <p class="muted">{x.loading}</p>}<button type="button" class="btn quiet" onClick={onBack}>{x.back}</button></div>;
  const insureds = d.parties.filter((p) => (p.role === 'insured' || p.role === 'joint_insured') && p.contactId);
  const nameOf = (id: string | null) => d.parties.find((p) => p.contactId === id)?.fullName ?? familyMembers.find((m) => m.contactId === id)?.fullName ?? '—';
  const desc = (p: Party) => {
    if (p.role !== 'beneficiary') return x.roles[p.role];
    const split = p.allocationMethod === 'percentage' ? `${(p.shareBasisPoints ?? 0) / 100}%` : p.allocationMethod === 'equal' ? x.equal : '';
    return `${x.roles.beneficiary} · ${p.beneficiaryClass === 'primary' ? x.primary : x.contingent}${split ? ` · ${split}` : ''}${p.insuredContactId ? ` · ${x.whoseLife} ${nameOf(p.insuredContactId)}` : ''}`;
  };
  return (
    <div>
      <button type="button" class="linkbtn" onClick={onBack}>← {x.back}</button>
      <h3 style={{ margin: '10px 0 2px', fontSize: '15px' }}>{d.policy.carrierName} · {d.policy.planName}</h3>
      <p class="muted" style={{ margin: 0 }}>{d.policy.policyNumber} · {x.statuses[d.policy.status] ?? d.policy.status} · {money(d.policy.annualPremiumCents, d.policy.currency, locale)}</p>
      {err && <p class="err" role="alert" style={{ padding: '8px 0 0' }}>{err}</p>}
      <div class="hcard" style={{ marginTop: '10px', borderColor: d.check.ready ? 'var(--ok)' : 'var(--warn)' }} role="status">
        <strong>{d.check.ready ? x.ready : x.notReady}</strong>
        {d.check.errors.length > 0 && <ul style={{ margin: '6px 0 0', paddingLeft: '18px' }}>{d.check.errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>}
        {d.check.warnings.length > 0 && <p class="muted" style={{ margin: '6px 0 0', fontSize: '12.5px' }}>{x.warnings}: {d.check.warnings.map((w) => w.message).join(' · ')}</p>}
      </div>
      <h4 style={{ margin: '14px 0 4px', fontSize: '13.5px' }}>{x.people}</h4>
      <ul class="maplist">
        {d.parties.map((p) => (
          <li key={p.id} style={{ display: 'flex', gap: '8px', alignItems: 'baseline', flexWrap: 'wrap' }}>
            <strong>{p.fullName ?? p.outsideName ?? x.estate}</strong><span class="muted">{desc(p)}</span>
            {d.canEdit && <button type="button" class="linkbtn" style={{ marginLeft: 'auto', fontSize: '12.5px' }} onClick={async () => { setErr(''); try { await call('POST', `/v1/policies/${policyId}/parties/${p.id}/end`); await changed(); } catch (e) { setErr((e as Error).message); } }}>{x.end}</button>}
          </li>
        ))}
      </ul>
      {!d.canEdit && <p class="muted" style={{ fontSize: '12.5px' }}>{x.canView}</p>}
      {d.canEdit && (adding
        ? <AddParty call={call} locale={locale} policyId={policyId} members={familyMembers} insureds={insureds.map((i) => ({ contactId: i.contactId!, fullName: i.fullName }))} onDone={async () => { setAdding(false); await changed(); }} onCancel={() => setAdding(false)} />
        : <div class="actions" style={{ marginTop: '8px' }}><button type="button" class="btn quiet" onClick={() => setAdding(true)}>{x.addPerson}</button></div>)}
    </div>
  );
}

function AddParty({ call, locale, policyId, members, insureds, onDone, onCancel }: { call: Call; locale: Locale; policyId: string; members: { contactId: string; fullName: string | null }[]; insureds: { contactId: string; fullName: string | null }[]; onDone: () => void; onCancel: () => void }) {
  const x = S(locale);
  const [role, setRole] = useState<PartyRole>('owner');
  const [who, setWho] = useState<string>(members[0]?.contactId ?? '__other');
  const [other, setOther] = useState<{ id: string; label: string } | null>(null);
  const [outside, setOutside] = useState('');
  const [cls, setCls] = useState<'primary' | 'contingent'>('primary');
  const [split, setSplit] = useState<'percentage' | 'equal' | 'estate'>('percentage');
  const [share, setShare] = useState('100');
  const [life, setLife] = useState('');
  const [rel, setRel] = useState('');
  const [err, setErr] = useState('');
  const isBen = role === 'beneficiary';
  const canOutside = isBen || role === 'trustee';
  const submit = async () => {
    setErr('');
    const estate = isBen && split === 'estate';
    const body: Record<string, unknown> = { role };
    if (!estate) {
      if (who === '__outside') body.outsideName = outside.trim();
      else if (who === '__other') { if (!other) { setErr(x.client); return; } body.contactId = other.id; }
      else body.contactId = who;
    }
    if (isBen) {
      body.beneficiaryClass = cls; body.allocationMethod = split;
      if (split === 'percentage') body.sharePercent = Number(share);
      if (life) body.insuredContactId = life;
      if (rel.trim()) body.relationshipToInsured = rel.trim();
    }
    try { await call('POST', `/v1/policies/${policyId}/parties`, body); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="hcard" style={{ marginTop: '8px' }}>
      <label>{x.role}</label>
      <select aria-label={x.role} value={role} onChange={(e) => setRole((e.target as HTMLSelectElement).value as PartyRole)}>{ROLES.map((r) => <option key={r} value={r}>{x.roles[r]}</option>)}</select>
      {!(isBen && split === 'estate') && (
        <>
          <label>{x.client}</label>
          <select aria-label={x.client} value={who} onChange={(e) => setWho((e.target as HTMLSelectElement).value)}>
            {members.map((m) => <option key={m.contactId} value={m.contactId}>{m.fullName ?? '—'}</option>)}
            <option value="__other">{x.otherClient}</option>
            {canOutside && <option value="__outside">{x.outside}</option>}
          </select>
          {who === '__other' && (other
            ? <p style={{ margin: '6px 0 0' }}><strong>{other.label}</strong> <button type="button" class="linkbtn" onClick={() => setOther(null)}>×</button></p>
            : <ClientPicker call={call} locale={locale} exclude={[]} onPick={(c) => setOther({ id: c.id, label: c.fullName || c.email || '—' })} />)}
          {who === '__outside' && canOutside && <input aria-label={x.outside} maxLength={200} value={outside} onInput={(e) => setOutside((e.target as HTMLInputElement).value)} />}
        </>
      )}
      {isBen && (
        <>
          <label>{x.cls}</label>
          <select aria-label={x.cls} value={cls} onChange={(e) => setCls((e.target as HTMLSelectElement).value as 'primary' | 'contingent')}><option value="primary">{x.primary}</option><option value="contingent">{x.contingent}</option></select>
          <label>{x.split}</label>
          <select aria-label={x.split} value={split} onChange={(e) => setSplit((e.target as HTMLSelectElement).value as 'percentage' | 'equal' | 'estate')}><option value="percentage">{x.pct}</option><option value="equal">{x.equal}</option><option value="estate">{x.estate}</option></select>
          {split === 'percentage' && <><label>{x.share}</label><input aria-label={x.share} type="number" min={0.01} max={100} step={0.01} value={share} onInput={(e) => setShare((e.target as HTMLInputElement).value)} /></>}
          <label>{x.whoseLife}</label>
          <select aria-label={x.whoseLife} value={life} onChange={(e) => setLife((e.target as HTMLSelectElement).value)}><option value="">{x.anyLife}</option>{insureds.map((i) => <option key={i.contactId} value={i.contactId}>{i.fullName ?? '—'}</option>)}</select>
          <label>{x.relation}</label>
          <input aria-label={x.relation} maxLength={60} value={rel} onInput={(e) => setRel((e.target as HTMLInputElement).value)} />
        </>
      )}
      {err && <p class="err" role="alert" style={{ padding: '8px 0 0' }}>{err}</p>}
      <div class="actions"><button type="button" class="btn" onClick={submit}>{x.add}</button><button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button></div>
    </div>
  );
}

/** Coverage cell editor: the state, and the evidence that state needs. */
function CoverageEditor({ call, locale, contactId, lineKey, lineLabel, current, onDone, onCancel }: { call: Call; locale: Locale; contactId: string; lineKey: string; lineLabel: string; current: CovState; onDone: () => void; onCancel: () => void }) {
  const x = S(locale);
  const [state, setState] = useState<CovState>(current);
  const [ev, setEv] = useState<{ policies: { id: string; planName: string; policyNumber: string }[]; analyses: { id: string; title: string }[] } | null>(null);
  const [policyId, setPolicyId] = useState('');
  const [outside, setOutside] = useState('');
  const [naId, setNaId] = useState('');
  const [note, setNote] = useState('');
  const [review, setReview] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', `/v1/people/${contactId}/coverage-evidence`).then(setEv, (e) => setErr((e as Error).message)); }, [call, contactId]);
  const save = async () => {
    setErr('');
    const body: Record<string, unknown> = { lineKey, state };
    if (state === 'covered') { if (policyId) body.policyId = policyId; else if (outside.trim()) body.outsideCoverage = outside.trim(); }
    if (state === 'potential_gap' && naId) body.needsAnalysisId = naId;
    if (note.trim()) body.note = note.trim();
    if (review) body.reviewDueOn = review;
    try { await call('POST', `/v1/people/${contactId}/coverage`, body); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  return (
    <div class="hcard" style={{ marginTop: '8px' }}>
      <strong>{x.setCoverage}: {lineLabel}</strong>
      <label>{x.state}</label>
      <select aria-label={x.state} value={state} onChange={(e) => setState((e.target as HTMLSelectElement).value as CovState)}>{(['covered', 'potential_gap', 'declined', 'unknown'] as CovState[]).map((s) => <option key={s} value={s}>{x.states[s]}</option>)}</select>
      {state === 'covered' && (
        <>
          <label>{x.evidencePolicy}</label>
          <select aria-label={x.evidencePolicy} value={policyId} onChange={(e) => setPolicyId((e.target as HTMLSelectElement).value)}><option value="">—</option>{(ev?.policies ?? []).map((p) => <option key={p.id} value={p.id}>{p.planName} · {p.policyNumber}</option>)}</select>
          {!policyId && <><label>{x.outsideCov}</label><input aria-label={x.outsideCov} maxLength={300} value={outside} onInput={(e) => setOutside((e.target as HTMLInputElement).value)} /></>}
        </>
      )}
      {state === 'potential_gap' && (
        <>
          <label>{x.na}</label>
          {ev && ev.analyses.length === 0 ? <p class="muted">{x.noEvidence}</p> : (
            <select aria-label={x.na} value={naId} onChange={(e) => setNaId((e.target as HTMLSelectElement).value)}><option value="">—</option>{(ev?.analyses ?? []).map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select>
          )}
        </>
      )}
      <label>{x.note}</label>
      <input aria-label={x.note} maxLength={500} value={note} onInput={(e) => setNote((e.target as HTMLInputElement).value)} />
      <label>{x.reviewBy}</label>
      <input aria-label={x.reviewBy} type="date" value={review} onInput={(e) => setReview((e.target as HTMLInputElement).value)} />
      {err && <p class="err" role="alert" style={{ padding: '8px 0 0' }}>{err}</p>}
      <div class="actions"><button type="button" class="btn" onClick={save}>{x.save}</button><button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button></div>
    </div>
  );
}

/** The Insurance section of the Family panel. Renders nothing when Gate B is switched off. */
export function FamilyInsurance({ call, locale, familyId, nonce }: { call: Call; locale: Locale; familyId: string; nonce?: number }) {
  const x = S(locale);
  const [on, setOn] = useState<boolean | null>(null);
  const [pol, setPol] = useState<any>(null);
  const [cov, setCov] = useState<any>(null);
  const [err, setErr] = useState('');
  const [openPolicy, setOpenPolicy] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ contactId: string; lineKey: string; label: string; state: CovState } | null>(null);
  const [linking, setLinking] = useState(false);
  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([call('GET', `/v1/families/${familyId}/policies`), call('GET', `/v1/families/${familyId}/coverage`)]);
      setPol(p); setCov(c); setOn(true);
    } catch (e) { if (statusOf(e) === 404) setOn(false); else setErr((e as Error).message); }
  }, [call, familyId]);
  useEffect(() => { void load(); }, [load, nonce]);
  if (on === false) return null;
  if (!pol || !cov) return err ? <p class="err" role="alert">{err}</p> : null;
  const members = cov.people.map((p: any) => ({ contactId: p.contactId, fullName: p.fullName }));
  if (openPolicy) return <section aria-label={x.insurance} style={{ marginTop: '16px' }}><PolicyPeople call={call} locale={locale} policyId={openPolicy} familyMembers={members} onBack={() => { setOpenPolicy(null); void load(); }} onChanged={load} /></section>;
  const label = (l: any) => (locale === 'fr-CA' ? l.labelFr : l.labelEn);
  return (
    <section aria-label={x.insurance} style={{ marginTop: '18px' }}>
      <h3 style={{ margin: '0 0 6px', fontSize: '14px' }}>{x.insurance}</h3>
      <div class="hcard">
        {pol.totals.length === 0 ? <p class="muted" style={{ margin: 0 }}>{x.none}</p> : pol.totals.map((t: any) => (
          <p key={t.currency} style={{ margin: '0 0 4px' }}><strong>{x.premium}: {money(t.annualPremiumCents, t.currency, locale)}</strong> <span class="muted">· {x.inForce(t.policies)}</span></p>
        ))}
        {pol.nextRenewal && <p class="muted" style={{ margin: 0 }}>{x.nextRenewal}: {day(pol.nextRenewal, locale)}</p>}
        {pol.completeness === 'partial' && (
          <div class="foot-note warn" style={{ marginTop: '6px' }} role="status">{x.partial}<ul style={{ margin: '4px 0 0', paddingLeft: '18px', fontWeight: 400 }}>{pol.warnings.map((w: any, i: number) => <li key={i}>{w.message}</li>)}</ul></div>
        )}
      </div>
      <h4 style={{ margin: '12px 0 4px', fontSize: '13.5px' }}>{x.policies}</h4>
      <ul class="maplist">
        {pol.policies.map((p: Policy) => (
          <li key={p.id}>
            <button type="button" class="linkbtn" onClick={() => setOpenPolicy(p.id)}><strong>{p.carrierName}</strong> · {p.planName}</button>
            <span class="muted"> · {x.statuses[p.status] ?? p.status} · {money(p.annualPremiumCents, p.currency, locale)}</span>
            <div class="muted" style={{ fontSize: '12.5px' }}>{(p.people ?? []).map((q) => `${q.fullName ?? '—'} (${q.roles.map((r) => x.roles[r]).join(', ')})`).join(' · ')}</div>
          </li>
        ))}
      </ul>
      {linking
        ? <LinkPolicy call={call} locale={locale} onPick={(id) => { setLinking(false); setOpenPolicy(id); }} onCancel={() => setLinking(false)} />
        : <button type="button" class="linkbtn" onClick={() => setLinking(true)}>{x.linkPolicy}</button>}
      {pol.beneficiaryOf.length > 0 && (
        <>
          <h4 style={{ margin: '12px 0 4px', fontSize: '13.5px' }}>{x.beneficiaryOf}</h4>
          <ul class="maplist">{pol.beneficiaryOf.map((p: Policy) => <li key={p.id}><button type="button" class="linkbtn" onClick={() => setOpenPolicy(p.id)}>{p.carrierName} · {p.planName}</button> <span class="muted">· {(p.people ?? []).map((q) => q.fullName).join(', ')}</span></li>)}</ul>
        </>
      )}
      <h4 style={{ margin: '14px 0 4px', fontSize: '13.5px' }}>{x.coverage}</h4>
      <p class="muted" style={{ margin: '0 0 6px', fontSize: '12.5px' }}>{x.unknownHelp}</p>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ fontSize: '12.5px', borderCollapse: 'separate', borderSpacing: '3px' }}>
          <thead><tr><th scope="col" style={{ position: 'static', background: 'none' }}></th>{cov.lines.map((l: any) => <th key={l.key} scope="col" style={{ position: 'static', background: 'none', whiteSpace: 'normal', padding: '2px 4px' }}>{label(l)}</th>)}</tr></thead>
          <tbody>
            {cov.people.map((p: any) => (
              <tr key={p.contactId}>
                <th scope="row" style={{ position: 'static', background: 'none', textAlign: 'left', padding: '2px 6px 2px 0', fontWeight: 600 }}>{p.fullName}</th>
                {p.cells.map((c: any, i: number) => {
                  const l = cov.lines[i];
                  return (
                    <td key={c.lineKey} style={{ padding: 0 }}>
                      <button type="button" aria-label={`${p.fullName}, ${label(l)}: ${x.states[c.state as CovState]}`} title={c.evidence?.label ?? ''}
                        style={{ ...STATE_STYLE[c.state as CovState], border: 0, borderRadius: '6px', padding: '4px 6px', width: '100%', minWidth: '78px', font: 'inherit', cursor: 'pointer', outline: c.reviewOverdue ? '2px solid var(--warn)' : 'none' }}
                        onClick={() => setEditing({ contactId: p.contactId, lineKey: c.lineKey, label: label(l), state: c.state })}>{x.states[c.state as CovState]}</button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <CoverageEditor key={`${editing.contactId}:${editing.lineKey}`} call={call} locale={locale} contactId={editing.contactId} lineKey={editing.lineKey} lineLabel={editing.label} current={editing.state} onCancel={() => setEditing(null)} onDone={() => { setEditing(null); void load(); }} />}
    </section>
  );
}

function LinkPolicy({ call, locale, onPick, onCancel }: { call: Call; locale: Locale; onPick: (id: string) => void; onCancel: () => void }) {
  const x = S(locale);
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Policy[] | null>(null);
  useEffect(() => {
    let live = true;
    const h = setTimeout(() => { call('GET', `/v1/policies/search?q=${encodeURIComponent(q.trim())}`).then((r) => live && setRows(r.policies), () => live && setRows([])); }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [call, q]);
  return (
    <div class="hcard" style={{ marginTop: '6px' }}>
      <input type="search" aria-label={x.findPolicy} placeholder={x.findPolicy} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
      {rows && (rows.length === 0 ? <p class="muted">{x.noPolicies}</p> : <ul class="maplist">{rows.map((p) => <li key={p.id}><button type="button" class="linkbtn" onClick={() => onPick(p.id)}>{p.carrierName} · {p.planName}</button> <span class="muted">· {p.policyNumber}</span></li>)}</ul>)}
      <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button>
    </div>
  );
}

/** Policies missing people: shown from the Contacts page when Gate B is on. */
export function MissingPeopleQueue({ call, locale, onClose }: { call: Call; locale: Locale; onClose: () => void }) {
  const x = S(locale);
  const [rows, setRows] = useState<Policy[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => call('GET', '/v1/policy-parties/missing').then((r) => setRows(r.policies), (e) => setErr((e as Error).message)), [call]);
  useEffect(() => { void load(); }, [load]);
  return (
    <aside tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.fixup} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      {open ? <PolicyPeople call={call} locale={locale} policyId={open} familyMembers={[]} onBack={() => { setOpen(null); void load(); }} /> : (
        <>
          <h2>{x.fixup}</h2>
          <p class="muted">{x.fixupHelp}</p>
          {err && <p class="err" role="alert">{err}</p>}
          {!rows ? <p class="muted">{x.loading}</p> : rows.length === 0 ? <p class="muted">—</p> : (
            <ul class="maplist">{rows.map((p) => (
              <li key={p.id}>
                <button type="button" class="linkbtn" onClick={() => setOpen(p.id)}>{p.carrierName} · {p.planName}</button>
                <span class="muted"> · {p.policyNumber} · {x.missing}: {(p.missing ?? []).map((m) => x.roles[m as PartyRole] ?? m).join(', ')}</span>
              </li>
            ))}</ul>
          )}
        </>
      )}
      <div class="actions"><button type="button" class="btn quiet" onClick={onClose}>{x.close}</button></div>
    </aside>
  );
}

/** Whether Gate B is on, for showing the queue link. */
export function useFamilyInsuranceOn(call: Call): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { call('GET', '/v1/coverage-lines').then(() => setOn(true), () => setOn(false)); }, [call]);
  return on;
}
