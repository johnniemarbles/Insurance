// Partner onboarding dashboard for the Compliance officer (a tab on the Compliance page): invite a partner, see every partner's progress,
// open a file to record the checks, decide the standing and move the agency agreement.
// The partner's own view is in onboarding-partner.tsx. Results and reasons are shown here only; the API never returns them to partners.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { ProgressBar, STAGE_LABEL, StepList, WAITING_ON, stagePercent, type Stage } from './onboarding-shared.tsx';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const OUTCOMES = ['good_standing', 'needs_review', 'not_in_good_standing'] as const;

const T = {
  en: {
    title: 'Partner onboarding', sub: 'Invite a partner, run the Equifax credit and Sterling background checks, decide good standing, then send the agency agreement. The partner sees only the outcome.',
    invite: 'Invite a partner', partner: 'Partner', country: 'Country', inviteBtn: 'Invite', noPartners: 'Every partner is already in onboarding.',
    cases: 'Partners in onboarding', none: 'Nobody is in onboarding yet.', name: 'Partner', stage: 'Stage', standing: 'Standing', recheck: 'Next check', open: 'Open',
    back: 'All partners in onboarding', dash: '—',
    tiles: { total: 'In onboarding', action: 'Need compliance action', partner: 'With the partner', active: 'Active', due: 'Checks due within 30 days', notGood: 'Not in good standing' },
    filters: { all: 'All', action: 'Needs compliance', partner: 'With the partner', active: 'Active' },
    filterNone: 'Nothing in this view.',
    nextHead: 'Next step', overdue: 'overdue', soon: 'due soon',
    next: {
      invited: 'The partner has been invited and has not submitted the profile yet.',
      form_submitted: 'The partner must give consent to the credit and background checks.',
      consents_recorded: 'Consent is in. Record the Equifax and Sterling results as they arrive.',
      checks_requested: 'Checks are running. Record each result as it comes in.',
      checks_complete: 'Every check is in. Record the good-standing decision.',
      standing_decided_good: 'Standing is good. Send the agency agreement.',
      standing_decided_other: 'The agency agreement is sent only for good standing, so it cannot go out for this decision.',
      agency_agreement_sent: 'The agreement is with the partner, who signs through the link emailed to them.',
      agency_agreement_signed: 'The agreement is signed. Activate the partner.',
      active: 'The partner is active. Carrier packets are sent from the partner’s page.',
    } as Record<string, string>,
    sections: { consents: 'Consents given', checks: 'Checks', decision: 'Good-standing decision', agreement: 'Agency agreement', packets: 'Carrier packets', signed: 'Signed agreements', decisions: 'Decisions on file' },
    noConsent: 'No consent recorded yet.', noChecks: 'No checks yet.', noPackets: 'None yet.', noSigned: 'None signed yet.',
    kind: { credit: 'Credit (Equifax)', background: 'Background (Sterling)', licence: 'Licence' } as Record<string, string>,
    status: { requested: 'Requested', complete: 'Complete', failed: 'Failed' } as Record<string, string>,
    checkCol: 'Check', checkL: 'Check', statusL: 'Status',
    recordHead: 'Record a check result', provider: 'Provider', score: 'Credit score', adverse: 'Background report', clear: 'Clear', adverseYes: 'Adverse finding',
    record: 'Record check', suggested: 'Rule suggests', pending: 'Waiting for a check result', decisionLocked: 'The decision opens once every check is complete.',
    outcome: 'Decision', reason: 'Reason (kept in the file, never shown to the partner)', decide: 'Record decision',
    agTitle: 'Agreement title', agVersion: 'Version', agText: 'Agreement text (as issued by counsel)', agSend: 'Send agency agreement to the partner',
    agResend: 'Send the agreement again', agWaiting: 'Waiting for the partner to sign. The link was emailed to the partner’s people.', agSentOk: 'Agreement sent.', agHint: 'The partner signs through a private link with a code sent to their email.',
    agSignedOn: 'Signed', agPdf: 'Sealed PDF', activate: 'Activate partner',
    outcomeL: { good_standing: 'Good standing', needs_review: 'Needs review', not_in_good_standing: 'Not in good standing' } as Record<string, string>,
    credit: (pass: number, review: number) => `Credit ${pass} or more passes. ${review} to ${pass - 1} needs review. Below ${review} is not in good standing.`,
  },
  'fr-CA': {
    title: 'Intégration des partenaires', sub: 'Invitez un partenaire, faites les vérifications de crédit Equifax et d’antécédents Sterling, décidez de la bonne réputation, puis envoyez l’entente d’agence. Le partenaire ne voit que le résultat.',
    invite: 'Inviter un partenaire', partner: 'Partenaire', country: 'Pays', inviteBtn: 'Inviter', noPartners: 'Tous les partenaires sont déjà en intégration.',
    cases: 'Partenaires en intégration', none: 'Personne n’est en intégration pour l’instant.', name: 'Partenaire', stage: 'Étape', standing: 'Réputation', recheck: 'Prochaine vérification', open: 'Ouvrir',
    back: 'Tous les partenaires en intégration', dash: '—',
    tiles: { total: 'En intégration', action: 'Action de conformité requise', partner: 'Chez le partenaire', active: 'Actifs', due: 'Vérifications dues dans 30 jours', notGood: 'Réputation non conforme' },
    filters: { all: 'Tous', action: 'Action requise', partner: 'Chez le partenaire', active: 'Actifs' },
    filterNone: 'Rien dans cette vue.',
    nextHead: 'Prochaine étape', overdue: 'en retard', soon: 'bientôt due',
    next: {
      invited: 'Le partenaire a été invité et n’a pas encore soumis son profil.',
      form_submitted: 'Le partenaire doit consentir aux vérifications de crédit et d’antécédents.',
      consents_recorded: 'Le consentement est reçu. Enregistrez les résultats Equifax et Sterling à leur arrivée.',
      checks_requested: 'Les vérifications sont en cours. Enregistrez chaque résultat à son arrivée.',
      checks_complete: 'Toutes les vérifications sont reçues. Enregistrez la décision de bonne réputation.',
      standing_decided_good: 'La réputation est bonne. Envoyez l’entente d’agence.',
      standing_decided_other: 'L’entente d’agence n’est envoyée qu’en cas de bonne réputation; elle ne peut donc pas partir pour cette décision.',
      agency_agreement_sent: 'L’entente est chez le partenaire, qui la signe par le lien envoyé par courriel.',
      agency_agreement_signed: 'L’entente est signée. Activez le partenaire.',
      active: 'Le partenaire est actif. Les dossiers auprès des assureurs s’envoient depuis sa page.',
    } as Record<string, string>,
    sections: { consents: 'Consentements donnés', checks: 'Vérifications', decision: 'Décision de bonne réputation', agreement: 'Entente d’agence', packets: 'Dossiers auprès des assureurs', signed: 'Ententes signées', decisions: 'Décisions au dossier' },
    noConsent: 'Aucun consentement enregistré pour l’instant.', noChecks: 'Aucune vérification pour l’instant.', noPackets: 'Aucun pour l’instant.', noSigned: 'Aucune entente signée pour l’instant.',
    kind: { credit: 'Crédit (Equifax)', background: 'Antécédents (Sterling)', licence: 'Permis' } as Record<string, string>,
    status: { requested: 'Demandée', complete: 'Terminée', failed: 'Échouée' } as Record<string, string>,
    checkCol: 'Vérification', checkL: 'Vérification', statusL: 'Statut',
    recordHead: 'Enregistrer un résultat de vérification', provider: 'Fournisseur', score: 'Pointage de crédit', adverse: 'Rapport d’antécédents', clear: 'Sans constat', adverseYes: 'Constat défavorable',
    record: 'Enregistrer la vérification', suggested: 'La règle suggère', pending: 'En attente d’un résultat de vérification', decisionLocked: 'La décision s’ouvre quand toutes les vérifications sont terminées.',
    outcome: 'Décision', reason: 'Motif (conservé au dossier, jamais montré au partenaire)', decide: 'Enregistrer la décision',
    agTitle: 'Titre de l’entente', agVersion: 'Version', agText: 'Texte de l’entente (tel que publié par les conseillers juridiques)', agSend: 'Envoyer l’entente d’agence au partenaire',
    agResend: 'Renvoyer l’entente', agWaiting: 'En attente de la signature du partenaire. Le lien a été envoyé par courriel aux personnes du partenaire.', agSentOk: 'Entente envoyée.', agHint: 'Le partenaire signe par un lien privé avec un code envoyé à son courriel.',
    agSignedOn: 'Signée', agPdf: 'PDF scellé', activate: 'Activer le partenaire',
    outcomeL: {
      good_standing: 'Bonne réputation', needs_review: 'À examiner', not_in_good_standing: 'Réputation non conforme',
    },
    credit: (pass: number, review: number) => `Crédit de ${pass} ou plus : réussi. De ${review} à ${pass - 1} : à examiner. Sous ${review} : non conforme.`,
  },
};

type Dict = (typeof T)['en'];
export interface CaseRow { id: string; nodeId: string; partnerName: string; country: string; stage: Stage; outcome: string | null; label: string; keepsAccess: boolean; recheck: { dueOn: string; status: string } | null }
interface Detail extends CaseRow {
  suggested: string; thresholds: { creditPassMin: number; creditReviewMin: number };
  consents: { kind: string; accepted: boolean; createdAt: string }[];
  checks: { id: string; kind: string; provider: string; status: string; score: number | null; adverse: boolean | null; requestedAt: string }[];
  decisions: { suggested: string; outcome: string; reason: string; decidedAt: string }[];
  carrierPackets: { id: string; carrier: string; templateVersion: string; status: string; createdAt: string }[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateOf = (s: string) => s.slice(0, 10);
const dayMs = 86_400_000;
type Filter = 'all' | 'action' | 'partner' | 'active';
const matches = (f: Filter, stage: Stage) => (f === 'all' ? true : f === 'active' ? stage === 'active' : f === 'partner' ? WAITING_ON[stage] === 'partner' : WAITING_ON[stage] === 'officer');

/** The Compliance officer's onboarding dashboard: totals, a progress board for every partner, and the file for one partner. */
export function OnboardingDashboard({ call, locale }: { call: Call; locale: Locale }) {
  const t: Dict = T[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [country, setCountry] = useState<'CA' | 'US'>('CA');
  const [filter, setFilter] = useState<Filter>('all');

  const load = async () => {
    try {
      const r = await call('GET', '/v1/onboarding/cases');
      setCases(r.cases as CaseRow[]);
      const p = await call('GET', '/v1/compliance/partners');
      const inOnboarding = new Set((r.cases as CaseRow[]).map((c) => c.nodeId));
      setPartners((p.partners as { id: string; name: string }[]).filter((x) => !inOnboarding.has(x.id)));
      setError('');
    } catch (e) {
      setError(errText(e));
    }
  };
  useEffect(() => { void load(); }, [call]);

  const invite = async () => {
    setError('');
    try {
      const r = await call('POST', '/v1/onboarding/cases', { nodeId: partnerId, country });
      setPartnerId('');
      await load();
      setOpenId(r.id as string);
    } catch (e) { setError(errText(e)); }
  };

  const tiles = useMemo(() => {
    const all = cases ?? [];
    const now = Date.now();
    return {
      total: all.filter((c) => c.stage !== 'active').length,
      action: all.filter((c) => WAITING_ON[c.stage] === 'officer').length,
      partner: all.filter((c) => WAITING_ON[c.stage] === 'partner').length,
      active: all.filter((c) => c.stage === 'active').length,
      due: all.filter((c) => c.stage === 'active' && c.recheck && new Date(c.recheck.dueOn).getTime() - now <= 30 * dayMs).length,
      notGood: all.filter((c) => c.outcome === 'not_in_good_standing').length,
    };
  }, [cases]);

  if (openId) return <CaseFile call={call} t={t} locale={locale} id={openId} onBack={() => { setOpenId(null); void load(); }} />;

  const shown = (cases ?? []).filter((c) => matches(filter, c.stage));
  const tile = (k: keyof Dict['tiles'], warn = false) => (
    <div class={`hstat ${warn && tiles[k] > 0 ? 'warn' : ''}`}><b>{tiles[k]}</b><span>{t.tiles[k]}</span></div>
  );

  return (
    <div class="home">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{t.title}</h2><span class="muted">{t.sub}</span></div></div>
      {error && <div class="err" role="alert">{error}</div>}

      <div class="hstats">
        {tile('total')}{tile('action', true)}{tile('partner')}{tile('active')}{tile('due', true)}{tile('notGood', true)}
      </div>

      <section class="hcard" style={{ marginBottom: '14px' }}>
        <h3 style={{ margin: '0 0 8px' }}>{t.invite}</h3>
        <div class="erow">
          <label class="fl">{t.partner}
            <select value={partnerId} onChange={(e) => setPartnerId((e.target as HTMLSelectElement).value)}>
              <option value="">—</option>
              {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label class="fl">{t.country}
            <select value={country} onChange={(e) => setCountry((e.target as HTMLSelectElement).value as 'CA' | 'US')}>
              <option value="CA">Canada</option><option value="US">US</option>
            </select>
          </label>
          <button class="btn" disabled={!partnerId} onClick={invite}>{t.inviteBtn}</button>
        </div>
        {partners.length === 0 && cases && <p class="muted" style={{ margin: '6px 0 0' }}>{t.noPartners}</p>}
      </section>

      <section class="hcard">
        <div class="erow" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>{t.cases}</h3>
          <div class="seg" role="tablist" aria-label={t.cases}>
            {(['all', 'action', 'partner', 'active'] as Filter[]).map((f) => (
              <button role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>{t.filters[f]}</button>
            ))}
          </div>
        </div>
        {cases === null && <div class="msg">…</div>}
        {cases && cases.length === 0 && <div class="calm">{t.none}</div>}
        {cases && cases.length > 0 && shown.length === 0 && <div class="calm">{t.filterNone}</div>}
        {shown.map((c) => (
          <button class="hrow obrow" key={c.id} onClick={() => setOpenId(c.id)}>
            <span class="rname">{c.partnerName}<small class="muted"> · {c.country === 'CA' ? 'Canada' : c.country}</small></span>
            <ProgressBar stage={c.stage} locale={locale} />
            <small class="muted">{Math.round(stagePercent(c.stage))}%</small>
            <span class={`chip ${WAITING_ON[c.stage] === 'officer' ? 'warn' : c.stage === 'active' ? 'ok' : ''}`}>{STAGE_LABEL[c.stage][locale === 'fr-CA' ? 'fr-CA' : 'en']}</span>
            <span class={`chip ${c.outcome === 'good_standing' ? 'ok' : c.outcome ? 'warn' : ''}`}>{c.outcome ? t.outcomeL[c.outcome] : t.dash}</span>
            {c.recheck && <small class={c.recheck.status === 'overdue' ? 'due bad' : c.recheck.status === 'due_soon' ? 'due warn' : 'muted'}>{t.recheck}: {dateOf(c.recheck.dueOn)}{c.recheck.status === 'overdue' ? ` · ${t.overdue}` : c.recheck.status === 'due_soon' ? ` · ${t.soon}` : ''}</small>}
          </button>
        ))}
      </section>
    </div>
  );
}

function CaseFile({ call, t, locale, id, onBack }: { call: Call; t: Dict; locale: Locale; id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState({ kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: '', adverse: 'false' });
  const [decision, setDecision] = useState({ outcome: 'good_standing', reason: '' });
  const [agr, setAgr] = useState({ title: 'PII agency agreement', version: '', body: '' });
  const [signed, setSigned] = useState<{ id: string; title: string; version: string; signedAt: string }[]>([]);
  const [sentOk, setSentOk] = useState(false);
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';

  const load = async () => {
    try { setD((await call('GET', `/v1/onboarding/cases/${id}`)) as Detail); setError(''); } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, [id]);
  useEffect(() => {
    void (async () => {
      try { setSigned((await call('GET', `/v1/onboarding/cases/${id}/agreements`)).agreements ?? []); } catch { setSigned([]); }
    })();
  }, [id, d?.stage]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const recordCheck = () => run(() => {
    const body: Record<string, unknown> = { kind: check.kind, provider: check.provider, status: check.status };
    if (check.kind === 'credit' && check.status === 'complete') body.score = Number(check.score);
    if (check.kind === 'background' && check.status === 'complete') body.adverse = check.adverse === 'true';
    return call('POST', `/v1/onboarding/cases/${id}/checks`, body);
  });

  const decide = () => run(() => call('POST', `/v1/onboarding/cases/${id}/decision`, decision));
  const nextStage = (s: string) => run(() => call('POST', `/v1/onboarding/cases/${id}/stage`, { to: s }));

  if (!d) return <div class="home"><button class="btn quiet" onClick={onBack}>← {t.back}</button>{error && <div class="err" role="alert">{error}</div>}</div>;

  const suggestedLabel = d.suggested === 'pending' ? t.pending : t.outcomeL[d.suggested];
  const canDecide = d.stage === 'checks_complete';
  const canRecord = ['consents_recorded', 'checks_requested', 'checks_complete'].includes(d.stage);
  const nextKey = d.stage === 'standing_decided' ? (d.outcome === 'good_standing' ? 'standing_decided_good' : 'standing_decided_other') : d.stage;
  const dueState = d.recheck?.status;

  return (
    <div class="home">
      <button class="btn quiet" onClick={onBack}>← {t.back}</button>
      <div class="hwelcome" style={{ marginTop: '8px' }}>
        <div>
          <h2 style={{ margin: 0 }}>{d.partnerName}</h2>
          <span class="muted">{d.country === 'CA' ? 'Canada' : d.country} · {STAGE_LABEL[d.stage][lc]}</span>
        </div>
        <span class="spacer" />
        <span class={`chip ${d.outcome === 'good_standing' ? 'ok' : d.outcome ? 'warn' : ''}`}>{d.outcome ? t.outcomeL[d.outcome] : t.dash}</span>
        {d.recheck && <span class={`chip ${dueState === 'overdue' ? 'warn' : ''}`}>{t.recheck}: {dateOf(d.recheck.dueOn)}{dueState === 'overdue' ? ` · ${t.overdue}` : dueState === 'due_soon' ? ` · ${t.soon}` : ''}</span>}
      </div>
      {error && <div class="err" role="alert">{error}</div>}

      <section class="hcard" style={{ marginBottom: '14px' }}>
        <StepList stage={d.stage} locale={locale} />
        <div class="obnext" role="status"><b>{t.nextHead}:</b> {t.next[nextKey]}</div>
      </section>

      <div class="obgrid">
        <section class="hcard" style={{ gridColumn: '1 / -1' }}>
          <h3>{t.sections.consents}</h3>
          {d.consents.length === 0 ? <p class="muted">{t.noConsent}</p> : (
            <ul>{d.consents.map((c) => <li>{c.kind.replace(/_/g, ' ')}: {c.accepted ? '✓' : '✗'}</li>)}</ul>
          )}
        </section>

        <section class="hcard" style={{ gridColumn: '1 / -1' }}>
          <h3>{t.sections.checks}</h3>
          {d.checks.length === 0 ? <p class="muted">{t.noChecks}</p> : (
            <table class="table">
              <thead><tr><th>{t.checkCol}</th><th>{t.provider}</th><th>{t.statusL}</th><th>{t.score}</th><th>{t.adverse}</th></tr></thead>
              <tbody>
                {d.checks.map((c) => (
                  <tr>
                    <td>{t.kind[c.kind] ?? c.kind}</td>
                    <td>{c.provider}</td>
                    <td>{t.status[c.status] ?? c.status}</td>
                    <td>{c.score ?? t.dash}</td>
                    <td>{c.kind === 'background' && c.status === 'complete' ? (c.adverse ? t.adverseYes : t.clear) : t.dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canRecord && (
            <div class="cform" style={{ marginTop: '12px' }}>
              <label class="fl">{t.checkL}
                <select value={check.kind} onChange={(e) => setCheck({ ...check, kind: (e.target as HTMLSelectElement).value, provider: (e.target as HTMLSelectElement).value === 'credit' ? 'Equifax Canada' : 'Sterling Backcheck' })}>
                  <option value="credit">{t.kind.credit}</option><option value="background">{t.kind.background}</option>
                </select>
              </label>
              <label class="fl">{t.provider}<input value={check.provider} onInput={(e) => setCheck({ ...check, provider: (e.target as HTMLInputElement).value })} /></label>
              <label class="fl">{t.statusL}
                <select value={check.status} onChange={(e) => setCheck({ ...check, status: (e.target as HTMLSelectElement).value })}>
                  <option value="complete">{t.status.complete}</option><option value="requested">{t.status.requested}</option><option value="failed">{t.status.failed}</option>
                </select>
              </label>
              {check.kind === 'credit' && check.status === 'complete' && (
                <label class="fl">{t.score}<input type="number" min={300} max={900} value={check.score} onInput={(e) => setCheck({ ...check, score: (e.target as HTMLInputElement).value })} /></label>
              )}
              {check.kind === 'background' && check.status === 'complete' && (
                <label class="fl">{t.adverse}
                  <select value={check.adverse} onChange={(e) => setCheck({ ...check, adverse: (e.target as HTMLSelectElement).value })}>
                    <option value="false">{t.clear}</option><option value="true">{t.adverseYes}</option>
                  </select>
                </label>
              )}
              <button class="btn" disabled={busy} onClick={recordCheck}>{t.record}</button>
            </div>
          )}
        </section>

        <section class="hcard" style={{ gridColumn: '1 / -1' }}>
          <h3>{t.sections.decision}</h3>
          {canDecide ? (
            <>
              <p>{t.suggested}: <strong>{suggestedLabel}</strong> <small class="muted">({t.credit(d.thresholds.creditPassMin, d.thresholds.creditReviewMin)})</small></p>
              <div class="cform">
                <label class="fl">{t.outcome}
                  <select value={decision.outcome} onChange={(e) => setDecision({ ...decision, outcome: (e.target as HTMLSelectElement).value })}>
                    {OUTCOMES.map((o) => <option value={o}>{t.outcomeL[o]}</option>)}
                  </select>
                </label>
                <label class="fl" style={{ gridColumn: 'span 2' }}>{t.reason}
                  <textarea rows={2} value={decision.reason} onInput={(e) => setDecision({ ...decision, reason: (e.target as HTMLTextAreaElement).value })} />
                </label>
                <button class="btn" disabled={busy || decision.reason.trim().length < 1} onClick={decide}>{t.decide}</button>
              </div>
            </>
          ) : <p class="muted">{t.decisionLocked}</p>}
          {d.decisions.length > 0 && (
            <>
              <h4>{t.sections.decisions}</h4>
              <ul>{d.decisions.map((x) => <li>{dateOf(x.decidedAt)}: {t.outcomeL[x.outcome]} · {x.reason}</li>)}</ul>
            </>
          )}
        </section>

        <section class="hcard" style={{ gridColumn: '1 / -1' }}>
          <h3>{t.sections.agreement}</h3>
          {(d.stage === 'standing_decided' || d.stage === 'agency_agreement_sent') && d.outcome === 'good_standing' && (
            <>
              <p class="muted">{t.agHint}</p>
              <div class="cform">
                <label class="fl">{t.agTitle}<input value={agr.title} onInput={(e) => setAgr({ ...agr, title: (e.target as HTMLInputElement).value })} /></label>
                <label class="fl">{t.agVersion}<input value={agr.version} onInput={(e) => setAgr({ ...agr, version: (e.target as HTMLInputElement).value })} /></label>
              </div>
              <label class="fl" style={{ display: 'grid', gap: '4px', marginTop: '10px' }}>{t.agText}
                <textarea rows={6} value={agr.body} onInput={(e) => setAgr({ ...agr, body: (e.target as HTMLTextAreaElement).value })} />
              </label>
              <button class="btn" style={{ marginTop: '10px' }} disabled={busy || agr.body.trim().length < 1 || agr.version.trim().length < 1 || agr.title.trim().length < 1}
                onClick={() => run(async () => { await call('POST', `/v1/onboarding/cases/${id}/agreement`, agr); setSentOk(true); })}>
                {d.stage === 'agency_agreement_sent' ? t.agResend : t.agSend}
              </button>
              {sentOk && d.stage === 'standing_decided' && <p class="muted">{t.agSentOk}</p>}
            </>
          )}
          {d.stage === 'agency_agreement_sent' && <p class="muted">{t.agWaiting}</p>}
          <h4>{t.sections.signed}</h4>
          {signed.length === 0 ? <p class="muted">{t.noSigned}</p> : (
            <ul>{signed.map((a) => <li>{a.title} · {a.version} · {t.agSignedOn} {dateOf(a.signedAt)} · <a href={`/v1/onboarding/agreements/${a.id}/pdf`}>{t.agPdf}</a></li>)}</ul>
          )}
          {d.stage === 'agency_agreement_signed' && (
            <button class="btn" disabled={busy} onClick={() => nextStage('active')}>{t.activate}</button>
          )}
        </section>

        <section class="hcard" style={{ gridColumn: '1 / -1' }}>
          <h3>{t.sections.packets}</h3>
          {d.carrierPackets.length === 0 ? <p class="muted">{t.noPackets}</p> : (
            <ul>{d.carrierPackets.map((p) => <li>{p.carrier} · {p.templateVersion} · {p.status}</li>)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
