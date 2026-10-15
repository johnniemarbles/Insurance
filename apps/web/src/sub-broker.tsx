// Sub-brokers (plan v6 section 2; plan v7). The administrator of an Active broker asks for a sub-broker. The branch's Compliance
// Manager starts its file, which creates the sub-broker with its file and invitation together.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const T = {
  en: {
    head: 'Sub-brokers', intro: 'Ask compliance to open a file for a sub-broker you work with. Three levels of brokers are allowed.',
    name: 'Business name', type: 'Type', individual: 'Individual', corporate: 'Corporation', admin: 'Email of the sub-broker’s administrator', submit: 'Request sub-broker',
    sent: 'Requested. Compliance will start its file.', err: 'Enter a business name and a valid administrator email.',
    queue: 'Sub-broker requests', none: 'No sub-broker requests.', parent: 'Broker', asked: 'Requested', status: 'Status', requested: 'Waiting for file', started: 'File started', start: 'Start file',
  },
  'fr-CA': {
    head: 'Sous-courtiers', intro: 'Demandez à la conformité d’ouvrir un dossier pour un sous-courtier avec qui vous travaillez. Trois niveaux de courtiers sont permis.',
    name: 'Nom d’entreprise', type: 'Type', individual: 'Particulier', corporate: 'Société', admin: 'Courriel de l’administrateur du sous-courtier', submit: 'Demander un sous-courtier',
    sent: 'Demande envoyée. La conformité ouvrira son dossier.', err: 'Entrez un nom d’entreprise et un courriel d’administrateur valide.',
    queue: 'Demandes de sous-courtiers', none: 'Aucune demande de sous-courtier.', parent: 'Courtier', asked: 'Demandé', status: 'Statut', requested: 'En attente du dossier', started: 'Dossier ouvert', start: 'Ouvrir le dossier',
  },
} as const;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The broker's administrator asks for a sub-broker on its own case. Shown once the broker is Active. */
export function SubBrokerForm({ call, locale, caseId }: { call: Call; locale: Locale; caseId: string }) {
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const t = T[lc];
  const [name, setName] = useState('');
  const [type, setType] = useState<'individual' | 'corporate'>('individual');
  const [adminEmail, setAdminEmail] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(''); setNote('');
    if (name.trim().length < 2 || name.includes('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(adminEmail.trim())) return setErr(t.err);
    setBusy(true);
    try {
      await call('POST', `/v1/onboarding/cases/${caseId}/sub-brokers`, { name: name.trim(), type, adminEmail: adminEmail.trim() });
      setNote(t.sent); setName(''); setAdminEmail('');
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <section class="obcard">
      <h3>{t.head}</h3>
      <p class="muted">{t.intro}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {note && <div class="banner" role="status">{note}</div>}
      <form class="obform" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <label class="fl">{t.name}<input value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
        <label class="fl">{t.type}
          <select value={type} onChange={(e) => setType((e.target as HTMLSelectElement).value as 'individual' | 'corporate')}>
            <option value="individual">{t.individual}</option>
            <option value="corporate">{t.corporate}</option>
          </select>
        </label>
        <label class="fl">{t.admin}<input type="email" value={adminEmail} onInput={(e) => setAdminEmail((e.target as HTMLInputElement).value)} /></label>
        <button class="btn" disabled={busy}>{t.submit}</button>
      </form>
    </section>
  );
}

interface SubRequest { id: string; name: string; parentName: string; status: 'requested' | 'started'; requestedAt: string }

/** The Compliance Manager's queue: sub-brokers asked for by active brokers, waiting for their file to be started. */
export function SubBrokerQueue({ call, locale }: { call: Call; locale: Locale }) {
  const lc = locale === 'fr-CA' ? 'fr-CA' : 'en';
  const t = T[lc];
  const [rows, setRows] = useState<SubRequest[] | null>(null);
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/onboarding/sub-broker-requests').then((r) => setRows(r.requests ?? []), (e) => { setErr(errText(e)); setRows([]); });
  useEffect(() => { void load(); }, [call]);
  const start = async (id: string) => {
    setErr('');
    try { await call('POST', `/v1/onboarding/sub-broker-requests/${id}/start`); await load(); } catch (e) { setErr(errText(e)); }
  };
  return (
    <section class="obcard" aria-label={t.queue}>
      <h3>{t.queue}</h3>
      {err && <div class="err" role="alert">{err}</div>}
      {rows === null && <div class="msg">…</div>}
      {rows !== null && rows.length === 0 && <p class="muted">{t.none}</p>}
      {(rows ?? []).length > 0 && (
        <table class="obtable">
          <thead><tr><th>{t.name}</th><th>{t.parent}</th><th>{t.asked}</th><th>{t.status}</th><th /></tr></thead>
          <tbody>
            {rows!.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{r.parentName}</td>
                <td>{r.requestedAt.slice(0, 10)}</td>
                <td>{r.status === 'started' ? <span class="chip ok">{t.started}</span> : <span class="chip">{t.requested}</span>}</td>
                <td>{r.status === 'requested' && <button class="btn quiet" onClick={() => void start(r.id)}>{t.start}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
