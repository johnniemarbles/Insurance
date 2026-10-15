// Broker self-report (plan v6, section 7). The partner records one of five events; the clock starts then, and the report goes
// to the branch's Compliance Manager's queue with its due day. Overdue once the due day has ended without an acknowledgement.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Kind = 'bankruptcy' | 'consumer_proposal' | 'investigation' | 'sanction' | 'criminal_charge';
const KINDS: Kind[] = ['bankruptcy', 'consumer_proposal', 'investigation', 'sanction', 'criminal_charge'];

const T = {
  en: {
    head: 'Report an event', intro: 'Tell compliance within five business days of a bankruptcy, consumer proposal, investigation, sanction or criminal charge. The clock starts when you record it.',
    kind: 'What happened', description: 'Describe it', submit: 'Record report', recorded: 'Recorded. Compliance will review it by', err: 'Describe the event in at least 10 characters.',
    queue: 'Self-reports', none: 'No self-reports.', partner: 'Partner', due: 'Due', status: 'Status', open: 'Open', overdue: 'Overdue', done: 'Acknowledged', ack: 'Acknowledge', recordedOn: 'Recorded',
    kinds: { bankruptcy: 'Bankruptcy', consumer_proposal: 'Consumer proposal', investigation: 'Investigation', sanction: 'Sanction', criminal_charge: 'Criminal charge' },
  },
  'fr-CA': {
    head: 'Signaler un événement', intro: 'Informez la conformité dans les cinq jours ouvrables suivant une faillite, une proposition de consommateur, une enquête, une sanction ou une accusation criminelle. Le délai commence quand vous l’enregistrez.',
    kind: 'Ce qui s’est passé', description: 'Décrivez-le', submit: 'Enregistrer le signalement', recorded: 'Enregistré. La conformité l’examinera d’ici le', err: 'Décrivez l’événement en au moins 10 caractères.',
    queue: 'Signalements', none: 'Aucun signalement.', partner: 'Partenaire', due: 'Échéance', status: 'Statut', open: 'Ouvert', overdue: 'En retard', done: 'Accusé de réception', ack: 'Accuser réception', recordedOn: 'Enregistré',
    kinds: { bankruptcy: 'Faillite', consumer_proposal: 'Proposition de consommateur', investigation: 'Enquête', sanction: 'Sanction', criminal_charge: 'Accusation criminelle' },
  },
} as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The partner records a self-report on its own case. */
export function SelfReportForm({ call, locale, caseId }: { call: Call; locale: Locale; caseId: string }) {
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const t = T[lc];
  const [kind, setKind] = useState<Kind>('bankruptcy');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(''); setNote('');
    if (description.trim().length < 10) return setErr(t.err);
    setBusy(true);
    try {
      const r = await call('POST', `/v1/onboarding/cases/${caseId}/self-reports`, { kind, description: description.trim() });
      setNote(`${t.recorded} ${r.dueOn}`);
      setDescription('');
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section class="obcard">
      <h3>{t.head}</h3>
      <p class="muted">{t.intro}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {note && <div class="banner" role="status">{note}</div>}
      <form class="obform" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label class="fl">{t.kind}
          <select value={kind} onChange={(e) => setKind((e.target as HTMLSelectElement).value as Kind)}>
            {KINDS.map((k) => <option key={k} value={k}>{t.kinds[k]}</option>)}
          </select>
        </label>
        <label class="fl">{t.description}
          <textarea rows={3} maxLength={1000} value={description} onInput={(e) => setDescription((e.target as HTMLTextAreaElement).value)} />
        </label>
        <button class="btn" disabled={busy}>{t.submit}</button>
      </form>
    </section>
  );
}

interface Report { id: string; partnerName: string; kind: Kind; description: string; recordedAt: string; dueOn: string; acknowledgedAt: string | null; overdue: boolean }

/** The Compliance Manager's queue of self-reports for the branches it holds. Acknowledging is the Compliance Manager's alone. */
export function SelfReportQueue({ call, locale }: { call: Call; locale: Locale }) {
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const t = T[lc];
  const [reports, setReports] = useState<Report[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/onboarding/self-reports').then((r) => setReports(r.reports ?? []), (e) => { setErr(errText(e)); setReports([]); });
  useEffect(() => { void load(); }, [call]);
  const ack = async (id: string) => {
    setErr('');
    try { await call('POST', `/v1/onboarding/self-reports/${id}/acknowledge`); await load(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <section class="obcard" aria-label={t.queue}>
      <h3>{t.queue}</h3>
      {err && <div class="err" role="alert">{err}</div>}
      {reports === null && <div class="msg">…</div>}
      {reports !== null && reports.length === 0 && <p class="muted">{t.none}</p>}
      {(reports ?? []).length > 0 && (
        <table class="obtable">
          <thead><tr><th>{t.partner}</th><th>{t.kind}</th><th>{t.recordedOn}</th><th>{t.due}</th><th>{t.status}</th><th /></tr></thead>
          <tbody>
            {reports!.map((r) => (
              <tr key={r.id}>
                <td>{r.partnerName}</td>
                <td>{t.kinds[r.kind]}</td>
                <td>{r.recordedAt.slice(0, 10)}</td>
                <td>{r.dueOn}</td>
                <td>{r.acknowledgedAt ? <span class="chip ok">{t.done}</span> : r.overdue ? <span class="chip warn">{t.overdue}</span> : <span class="chip">{t.open}</span>}</td>
                <td>{!r.acknowledgedAt && <button class="btn quiet" onClick={() => void ack(r.id)}>{t.ack}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
