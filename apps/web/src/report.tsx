import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

export interface Learner { userId: string; displayName: string | null; email: string; status: string; progressPct: number; dueAt: string | null; completedAt?: string | null; startedAt?: string | null; bestScore?: number | null; attempts?: number }

const csvCell = (v: unknown) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

export function CompletionReport({ learners, courseTitle, locale }: { learners: Learner[]; courseTitle: string; locale: Locale }) {
  const fr = locale === 'fr-CA';
  const now = Date.now();
  const rows = useMemo(() => learners.map((m) => {
    const done = m.status === 'completed';
    const overdue = !done && !!m.dueAt && new Date(m.dueAt).getTime() < now;
    return { ...m, done, overdue, state: done ? 'done' : overdue ? 'overdue' : m.progressPct > 0 ? 'going' : 'new' };
  }), [learners]);
  const n = rows.length, doneN = rows.filter((r) => r.done).length, overN = rows.filter((r) => r.overdue).length;
  const scores = rows.filter((r) => r.bestScore != null).map((r) => r.bestScore!);
  const avg = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const L: Record<string, string> = fr ? { done: 'Terminé', overdue: 'En retard', going: 'En cours', new: 'Pas commencé' } : { done: 'Completed', overdue: 'Overdue', going: 'In progress', new: 'Not started' };
  const d = (x?: string | null) => (x ? new Date(x).toLocaleDateString(locale) : '');
  const download = () => {
    const head = fr ? ['Nom', 'Courriel', 'Statut', 'Progression %', 'Échéance', 'Terminé le', 'Meilleur score %', 'Tentatives'] : ['Name', 'Email', 'Status', 'Progress %', 'Due', 'Completed on', 'Best quiz score %', 'Quiz attempts'];
    const iso = (x?: string | null) => (x ? new Date(x).toISOString().slice(0, 10) : '');
    const lines = [head, ...rows.map((r) => [r.displayName ?? '', r.email, L[r.state], Math.round(r.progressPct), iso(r.dueAt), iso(r.completedAt), r.bestScore ?? '', r.attempts ?? 0])];
    const blob = new Blob(['\ufeff' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `${courseTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'course'}-completion.csv`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const tile = (v: string | number, l: string, cls = '') => <div class={`rp-t ${cls}`}><b>{v}</b><span>{l}</span></div>;
  return (
    <div class="rp">
      <div class="rp-tiles">
        {tile(n, fr ? 'Inscrits' : 'Enrolled')}
        {tile(n ? `${Math.round((doneN / n) * 100)}%` : '–', fr ? `Terminé (${doneN})` : `Completed (${doneN})`, 'ok')}
        {tile(overN, fr ? 'En retard' : 'Overdue', overN ? 'bad' : '')}
        {tile(avg == null ? '–' : `${avg}%`, fr ? 'Score moyen' : 'Avg quiz score')}
      </div>
      {n === 0 ? <p class="muted">{fr ? 'Personne n’est encore inscrit.' : 'Nobody is enrolled yet.'}</p> : (
        <>
          <div class="actions"><button class="btn quiet" onClick={download}>⬇ {fr ? 'Télécharger le rapport (CSV)' : 'Download report (CSV)'}</button></div>
          <div class="rp-wrap"><table>
            <thead><tr><th>{fr ? 'Nom' : 'Name'}</th><th>{fr ? 'Statut' : 'Status'}</th><th>%</th><th>{fr ? 'Échéance' : 'Due'}</th><th>{fr ? 'Score' : 'Score'}</th></tr></thead>
            <tbody>{[...rows].sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.progressPct - b.progressPct).map((r) => (
              <tr key={r.userId}><td>{r.displayName ?? r.email}</td><td><span class={`rp-s ${r.state}`}>{L[r.state]}</span></td><td>{Math.round(r.progressPct)}%</td><td>{d(r.dueAt)}</td><td>{r.bestScore != null ? `${Math.round(r.bestScore)}%` : ''}</td></tr>
            ))}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

interface Overview { learners: number; enrolled: number; completed: number; overdue: number; completionPct: number | null; courses: { id: string; title: string; enrolled: number; completed: number; overdue: number }[] }

/** Company-wide training health for trainers and administrators, shown above the course list. */
export function TrainingOverview({ call, locale, onOpen }: { call: (m: 'GET', p: string) => Promise<any>; locale: Locale; onOpen: (id: string) => void }) {
  const fr = locale === 'fr-CA';
  const [o, setO] = useState<Overview | null>(null);
  useEffect(() => { call('GET', `/v1/training/overview?locale=${locale}`).then(setO, () => setO(null)); }, [call, locale]);
  if (!o || o.enrolled === 0) return null;
  const tile = (v: string | number, l: string, cls = '') => <div class={`rp-t ${cls}`}><b>{v}</b><span>{l}</span></div>;
  const watch = o.courses.filter((c) => c.overdue > 0);
  return (
    <section class="rp ov" aria-label={fr ? 'Aperçu de la formation' : 'Training overview'}>
      <div class="rp-tiles">
        {tile(o.learners, fr ? 'Apprenants' : 'Learners')}
        {tile(o.completionPct == null ? '–' : `${o.completionPct}%`, fr ? `Terminé (${o.completed} sur ${o.enrolled})` : `Completed (${o.completed} of ${o.enrolled})`, 'ok')}
        {tile(o.overdue, fr ? 'En retard' : 'Overdue', o.overdue ? 'bad' : '')}
        {tile(o.courses.length, fr ? 'Cours utilisés' : 'Courses in use')}
      </div>
      {watch.length > 0 && (
        <div class="ov-watch"><b>{fr ? 'À surveiller' : 'Needs attention'}</b>
          {watch.map((c) => <button class="ov-row" onClick={() => onOpen(c.id)}><span>{c.title}</span><em>{fr ? `${c.overdue} en retard` : `${c.overdue} overdue`}</em></button>)}
        </div>
      )}
    </section>
  );
}

/** Administrators choose who signs the company's certificates. Hidden for everyone else (the server refuses them). */
export function CertificateSigner({ call, locale }: { call: (m: 'GET' | 'PUT', p: string, b?: unknown) => Promise<any>; locale: Locale }) {
  const fr = locale === 'fr-CA';
  const [v, setV] = useState<{ name: string; title: string } | null>(null);
  const [msg, setMsg] = useState('');
  useEffect(() => { call('GET', '/v1/training/certificate-settings').then(setV, () => setV(null)); }, [call]);
  if (!v) return null;
  const save = async (e: Event) => {
    e.preventDefault(); setMsg('');
    try { await call('PUT', '/v1/training/certificate-settings', { name: v.name, title: v.title }); setMsg(fr ? 'Enregistré. Les attestations affichent maintenant cette signature.' : 'Saved. Certificates now show this signature.'); }
    catch (x) { setMsg((x as Error).message); }
  };
  return (
    <details class="sigset">
      <summary>{fr ? 'Signature sur les attestations' : 'Certificate signature'}</summary>
      <form class="erow" onSubmit={save}>
        <input aria-label={fr ? 'Nom du signataire' : 'Signatory name'} placeholder={fr ? 'Nom du signataire' : 'Signatory name'} maxLength={80} value={v.name} onInput={(e) => setV({ ...v, name: (e.target as HTMLInputElement).value })} />
        <input aria-label={fr ? 'Titre' : 'Title'} placeholder={fr ? 'Titre (ex. Directeur)' : 'Title (e.g. Principal Broker)'} maxLength={80} value={v.title} onInput={(e) => setV({ ...v, title: (e.target as HTMLInputElement).value })} />
        <button class="btn">{fr ? 'Enregistrer' : 'Save'}</button>
        {msg && <span class="muted">{msg}</span>}
      </form>
      <p class="muted" style={{ margin: '4px 0 0' }}>{fr ? 'Laissez le nom vide pour ne pas afficher de signature. Les attestations déjà émises affichent aussi la signature actuelle.' : 'Leave the name empty to print no signature. Certificates already issued also show the current signature.'}</p>
    </details>
  );
}
