// Partner onboarding, for the Compliance officer: invite a partner, record the checks, decide the standing, move the agency agreement.
// The partner's own view is in onboarding-partner.tsx. Results and reasons are shown here only; the API never returns them to partners.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const STAGES = ['invited', 'form_submitted', 'consents_recorded', 'checks_requested', 'checks_complete', 'standing_decided', 'agency_agreement_sent', 'agency_agreement_signed', 'active'] as const;
type Stage = (typeof STAGES)[number];
const OUTCOMES = ['good_standing', 'needs_review', 'not_in_good_standing'] as const;

const T = {
  en: {
    title: 'Partner onboarding', sub: 'Invite a partner, run the Equifax credit and Sterling background checks, decide good standing, then send the agency agreement. The partner sees only the outcome.',
    invite: 'Invite a partner', partner: 'Partner', country: 'Country', inviteBtn: 'Invite', noPartners: 'Every partner is already in onboarding.',
    cases: 'Partners in onboarding', none: 'Nobody is in onboarding yet.', name: 'Partner', stage: 'Stage', standing: 'Standing', recheck: 'Next check', open: 'Open',
    forbidden: 'Only the Compliance officer for this region can run partner onboarding.',
    back: 'All partners', stagesHead: 'Progress', consentsHead: 'Consents given', checksHead: 'Checks', noChecks: 'No checks yet.',
    kind: { credit: 'Credit (Equifax)', background: 'Background (Sterling)', licence: 'Licence' } as Record<string, string>,
    status: { requested: 'Requested', complete: 'Complete', failed: 'Failed' } as Record<string, string>,
    checkCol: 'Check', checkL: 'Check', statusL: 'Status',
    recordHead: 'Record a check result', provider: 'Provider', score: 'Credit score', adverse: 'Background report', clear: 'Clear', adverseYes: 'Adverse finding',
    record: 'Record check', decisionHead: 'Good-standing decision', suggested: 'Rule suggests', pending: 'Waiting for a check result',
    outcome: 'Decision', reason: 'Reason (kept in the file, never shown to the partner)', decide: 'Record decision', decisions: 'Decisions on file',
    agreementHead: 'Agency agreement', nextStage: { agency_agreement_sent: 'Send agency agreement', agency_agreement_signed: 'Mark agreement signed', active: 'Activate partner' } as Record<string, string>,
    packetsHead: 'Carrier packets', noPackets: 'None yet.', saved: 'Saved',
    outcomeL: { good_standing: 'Good standing', needs_review: 'Needs review', not_in_good_standing: 'Not in good standing' } as Record<string, string>,
    stageL: { invited: 'Invited', form_submitted: 'Form submitted', consents_recorded: 'Consent given', checks_requested: 'Checks requested', checks_complete: 'Checks complete', standing_decided: 'Standing decided', agency_agreement_sent: 'Agreement sent', agency_agreement_signed: 'Agreement signed', active: 'Active' } as Record<string, string>,
    left: 'Due', dash: '—',
  },
  'fr-CA': {
    title: 'Intégration des partenaires', sub: 'Invitez un partenaire, faites les vérifications de crédit Equifax et d’antécédents Sterling, décidez de la bonne réputation, puis envoyez l’entente d’agence. Le partenaire ne voit que le résultat.',
    invite: 'Inviter un partenaire', partner: 'Partenaire', country: 'Pays', inviteBtn: 'Inviter', noPartners: 'Tous les partenaires sont déjà en intégration.',
    cases: 'Partenaires en intégration', none: 'Personne n’est en intégration pour l’instant.', name: 'Partenaire', stage: 'Étape', standing: 'Réputation', recheck: 'Prochaine vérification', open: 'Ouvrir',
    forbidden: 'Seul le responsable de la conformité de cette région peut gérer l’intégration des partenaires.',
    back: 'Tous les partenaires', stagesHead: 'Progression', consentsHead: 'Consentements donnés', checksHead: 'Vérifications', noChecks: 'Aucune vérification pour l’instant.',
    kind: { credit: 'Crédit (Equifax)', background: 'Antécédents (Sterling)', licence: 'Permis' } as Record<string, string>,
    status: { requested: 'Demandée', complete: 'Terminée', failed: 'Échouée' } as Record<string, string>,
    checkCol: 'Vérification', checkL: 'Vérification', statusL: 'Statut',
    recordHead: 'Enregistrer un résultat de vérification', provider: 'Fournisseur', score: 'Pointage de crédit', adverse: 'Rapport d’antécédents', clear: 'Sans constat', adverseYes: 'Constat défavorable',
    record: 'Enregistrer la vérification', decisionHead: 'Décision de bonne réputation', suggested: 'La règle suggère', pending: 'En attente d’un résultat de vérification',
    outcome: 'Décision', reason: 'Motif (conservé au dossier, jamais montré au partenaire)', decide: 'Enregistrer la décision', decisions: 'Décisions au dossier',
    agreementHead: 'Entente d’agence', nextStage: { agency_agreement_sent: 'Envoyer l’entente d’agence', agency_agreement_signed: 'Marquer l’entente signée', active: 'Activer le partenaire' } as Record<string, string>,
    packetsHead: 'Dossiers auprès des assureurs', noPackets: 'Aucun pour l’instant.', saved: 'Enregistré',
    outcomeL: { good_standing: 'Bonne réputation', needs_review: 'À examiner', not_in_good_standing: 'Réputation non conforme' } as Record<string, string>,
    stageL: { invited: 'Invité', form_submitted: 'Formulaire soumis', consents_recorded: 'Consentement donné', checks_requested: 'Vérifications demandées', checks_complete: 'Vérifications terminées', standing_decided: 'Réputation décidée', agency_agreement_sent: 'Entente envoyée', agency_agreement_signed: 'Entente signée', active: 'Actif' } as Record<string, string>,
    left: 'Échéance', dash: '—',
  },
};

type Dict = (typeof T)['en'];
interface CaseRow { id: string; nodeId: string; partnerName: string; country: string; stage: Stage; outcome: string | null; label: string; keepsAccess: boolean; recheck: { dueOn: string; status: string } | null }
interface Detail extends CaseRow {
  suggested: string; thresholds: { creditPassMin: number; creditReviewMin: number };
  consents: { kind: string; accepted: boolean; createdAt: string }[];
  checks: { id: string; kind: string; provider: string; status: string; score: number | null; adverse: boolean | null; requestedAt: string }[];
  decisions: { suggested: string; outcome: string; reason: string; decidedAt: string }[];
  carrierPackets: { id: string; carrier: string; templateVersion: string; status: string; createdAt: string }[];
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const dateOf = (s: string) => s.slice(0, 10);

export function OnboardingPage({ call, locale }: { call: Call; locale: Locale }) {
  const t: Dict = T[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [forbidden, setForbidden] = useState(false);
  const [partnerId, setPartnerId] = useState('');
  const [country, setCountry] = useState<'CA' | 'US'>('CA');

  const load = async () => {
    try {
      const r = await call('GET', '/v1/onboarding/cases');
      setCases(r.cases as CaseRow[]);
      setForbidden(false);
      const p = await call('GET', '/v1/compliance/partners');
      const inOnboarding = new Set((r.cases as CaseRow[]).map((c) => c.nodeId));
      setPartners((p.partners as { id: string; name: string }[]).filter((x) => !inOnboarding.has(x.id)));
    } catch (e) {
      const msg = errText(e);
      if (/only the compliance|compliance officer/i.test(msg)) setForbidden(true);
      setError(msg);
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

  if (openId) return <CaseFile call={call} t={t} id={openId} onBack={() => { setOpenId(null); void load(); }} />;

  return (
    <section class="onboarding">
      <h2>{t.title}</h2>
      <p class="muted">{t.sub}</p>
      {forbidden && <div class="msg">{t.forbidden}</div>}
      {error && !forbidden && <div class="err" role="alert">{error}</div>}
      {!forbidden && (
        <>
          <div class="row" style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
            <label>{t.partner}
              <select value={partnerId} onChange={(e) => setPartnerId((e.target as HTMLSelectElement).value)}>
                <option value="">—</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </label>
            <label>{t.country}
              <select value={country} onChange={(e) => setCountry((e.target as HTMLSelectElement).value as 'CA' | 'US')}>
                <option value="CA">Canada</option><option value="US">US</option>
              </select>
            </label>
            <button class="btn" disabled={!partnerId} onClick={invite}>{t.inviteBtn}</button>
          </div>
          {partners.length === 0 && cases && <p class="muted">{t.noPartners}</p>}
          <h3>{t.cases}</h3>
          {cases && cases.length === 0 && <p class="muted">{t.none}</p>}
          {cases && cases.length > 0 && (
            <table class="table">
              <thead><tr><th>{t.name}</th><th>{t.stage}</th><th>{t.standing}</th><th>{t.recheck}</th><th /></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr>
                    <td>{c.partnerName}</td>
                    <td>{t.stageL[c.stage]}</td>
                    <td>{c.outcome ? t.outcomeL[c.outcome] : t.dash}</td>
                    <td>{c.recheck ? `${dateOf(c.recheck.dueOn)}${c.recheck.status === 'overdue' ? ' (overdue)' : c.recheck.status === 'due_soon' ? ' (soon)' : ''}` : t.dash}</td>
                    <td><button class="btn quiet" onClick={() => setOpenId(c.id)}>{t.open}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

function CaseFile({ call, t, id, onBack }: { call: Call; t: Dict; id: string; onBack: () => void }) {
  const [d, setD] = useState<Detail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [check, setCheck] = useState({ kind: 'credit', provider: 'Equifax Canada', status: 'complete', score: '', adverse: 'false' });
  const [decision, setDecision] = useState({ outcome: 'good_standing', reason: '' });

  const load = async () => {
    try { setD((await call('GET', `/v1/onboarding/cases/${id}`)) as Detail); setError(''); } catch (e) { setError(errText(e)); }
  };
  useEffect(() => { void load(); }, [id]);

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
  const next = (stage: Stage): string | null => (stage === 'standing_decided' ? 'agency_agreement_sent' : stage === 'agency_agreement_sent' ? 'agency_agreement_signed' : stage === 'agency_agreement_signed' ? 'active' : null);

  if (!d) return <section class="onboarding"><button class="btn quiet" onClick={onBack}>{t.back}</button>{error && <div class="err" role="alert">{error}</div>}</section>;

  const nxt = next(d.stage);
  const suggestedLabel = d.suggested === 'pending' ? t.pending : t.outcomeL[d.suggested];
  const canDecide = d.stage === 'checks_complete';

  return (
    <section class="onboarding">
      <button class="btn quiet" onClick={onBack}>{t.back}</button>
      <h2>{d.partnerName}</h2>
      <p>{t.stage}: <strong>{t.stageL[d.stage]}</strong> · {t.standing}: <strong>{d.outcome ? t.outcomeL[d.outcome] : t.dash}</strong>
        {d.recheck && <> · {t.recheck}: {dateOf(d.recheck.dueOn)}</>}</p>
      {error && <div class="err" role="alert">{error}</div>}

      <h3>{t.consentsHead}</h3>
      {d.consents.length === 0 ? <p class="muted">—</p> : (
        <ul>{d.consents.map((c) => <li>{c.kind.replace(/_/g, ' ')}: {c.accepted ? 'yes' : 'no'}</li>)}</ul>
      )}

      <h3>{t.checksHead}</h3>
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
      {['consents_recorded', 'checks_requested', 'checks_complete'].includes(d.stage) && (
        <div class="row" style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
          <h4 style={{ width: '100%' }}>{t.recordHead}</h4>
          <label>{t.checkL}
            <select value={check.kind} onChange={(e) => setCheck({ ...check, kind: (e.target as HTMLSelectElement).value, provider: (e.target as HTMLSelectElement).value === 'credit' ? 'Equifax Canada' : 'Sterling Backcheck' })}>
              <option value="credit">{t.kind.credit}</option><option value="background">{t.kind.background}</option>
            </select>
          </label>
          <label>{t.provider}<input value={check.provider} onInput={(e) => setCheck({ ...check, provider: (e.target as HTMLInputElement).value })} /></label>
          <label>{t.statusL}
            <select value={check.status} onChange={(e) => setCheck({ ...check, status: (e.target as HTMLSelectElement).value })}>
              <option value="complete">{t.status.complete}</option><option value="requested">{t.status.requested}</option><option value="failed">{t.status.failed}</option>
            </select>
          </label>
          {check.kind === 'credit' && check.status === 'complete' && (
            <label>{t.score}<input type="number" min={300} max={900} value={check.score} onInput={(e) => setCheck({ ...check, score: (e.target as HTMLInputElement).value })} /></label>
          )}
          {check.kind === 'background' && check.status === 'complete' && (
            <label>{t.adverse}
              <select value={check.adverse} onChange={(e) => setCheck({ ...check, adverse: (e.target as HTMLSelectElement).value })}>
                <option value="false">{t.clear}</option><option value="true">{t.adverseYes}</option>
              </select>
            </label>
          )}
          <button class="btn" disabled={busy} onClick={recordCheck}>{t.record}</button>
        </div>
      )}

      {canDecide && (
        <>
          <h3>{t.decisionHead}</h3>
          <p>{t.suggested}: <strong>{suggestedLabel}</strong> (credit {d.thresholds.creditPassMin} pass, {d.thresholds.creditReviewMin}–{d.thresholds.creditPassMin - 1} review)</p>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'end', flexWrap: 'wrap' }}>
            <label>{t.outcome}
              <select value={decision.outcome} onChange={(e) => setDecision({ ...decision, outcome: (e.target as HTMLSelectElement).value })}>
                {OUTCOMES.map((o) => <option value={o}>{t.outcomeL[o]}</option>)}
              </select>
            </label>
            <label style={{ flex: '1 1 320px' }}>{t.reason}
              <textarea rows={3} value={decision.reason} onInput={(e) => setDecision({ ...decision, reason: (e.target as HTMLTextAreaElement).value })} />
            </label>
            <button class="btn" disabled={busy || decision.reason.trim().length < 1} onClick={decide}>{t.decide}</button>
          </div>
        </>
      )}
      {d.decisions.length > 0 && (
        <>
          <h4>{t.decisions}</h4>
          <ul>{d.decisions.map((x) => <li>{dateOf(x.decidedAt)}: {t.outcomeL[x.outcome]} · {x.reason}</li>)}</ul>
        </>
      )}

      <h3>{t.agreementHead}</h3>
      {nxt ? (
        <button class="btn" disabled={busy} onClick={() => nextStage(nxt)}>{t.nextStage[nxt]}</button>
      ) : <p class="muted">{t.dash}</p>}

      <h3>{t.packetsHead}</h3>
      {d.carrierPackets.length === 0 ? <p class="muted">{t.noPackets}</p> : (
        <ul>{d.carrierPackets.map((p) => <li>{p.carrier} · {p.templateVersion} · {p.status}</li>)}</ul>
      )}
    </section>
  );
}
