import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { Paths } from './paths.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface En { id: string; courseId: string; title: string; status: string; progressPct: number; dueAt: string | null; completedAt: string | null; certificateCode: string | null; ceHours: number | null; outdated?: boolean }

export function MyLearning({ call, locale, onOpen, canAuthor = false }: { call: Call; locale: Locale; onOpen: (courseId: string) => void; canAuthor?: boolean }) {
  const fr = locale === 'fr-CA';
  const [d, setD] = useState<{ origin: string; enrollments: En[] } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', `/v1/my/learning?locale=${locale}`).then(setD, (e) => setErr((e as Error).message)); }, [call, locale]);
  if (!d) return <div class="msg">{err || '…'}</div>;
  const now = Date.now(), week = now + 7 * 864e5;
  const all = d.enrollments;
  const done = all.filter((e) => e.status === 'completed');
  const open = all.filter((e) => e.status !== 'completed');
  const due = open.filter((e) => e.dueAt && new Date(e.dueAt).getTime() < week);
  const rest = open.filter((e) => !due.includes(e));
  const hours = done.reduce((n, e) => n + (e.ceHours ?? 0), 0);
  const dd = (x: string) => new Date(x).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric' });
  const card = (e: En) => {
    const late = !!e.dueAt && e.status !== 'completed' && new Date(e.dueAt).getTime() < now;
    return (
      <div class={`ml-c${late ? ' late' : ''}`} key={e.id}>
        <div class="ml-top"><b>{e.title}</b>{e.dueAt && e.status !== 'completed' && <span class={`ml-due${late ? ' late' : ''}`}>{late ? (fr ? 'En retard · ' : 'Overdue · ') : (fr ? 'Échéance ' : 'Due ')}{dd(e.dueAt)}</span>}{e.outdated && <span class="ml-due">{fr ? 'Nouvelle version' : 'New version'}</span>}</div>
        {e.status === 'completed'
          ? <div class="ml-bot"><span class="ok">✓ {fr ? 'Terminé' : 'Completed'}{e.completedAt ? ` · ${dd(e.completedAt)}` : ''}{e.ceHours ? ` · ${e.ceHours} h ${fr ? 'FC' : 'CE'}` : ''}</span>
              <span>{e.certificateCode && <><a href={`${d.origin}/c/${e.certificateCode}`} target="_blank" rel="noopener noreferrer">{fr ? 'Attestation' : 'Certificate'}</a> · <a href={`${d.origin}/c/${e.certificateCode}/pdf`} target="_blank" rel="noopener noreferrer">PDF</a> · </>}<button class="link" onClick={() => onOpen(e.courseId)}>{fr ? 'Revoir' : 'Review'}</button></span></div>
          : <div class="ml-bot"><div class="pbar" role="progressbar" aria-valuenow={Math.round(e.progressPct)} aria-valuemin={0} aria-valuemax={100}><i style={{ width: `${e.progressPct}%` }} /></div><small>{Math.round(e.progressPct)}%</small><button class="btn" onClick={() => onOpen(e.courseId)}>{e.progressPct > 0 ? (fr ? 'Continuer' : 'Continue') : (fr ? 'Commencer' : 'Start')}</button></div>}
      </div>
    );
  };
  const sec = (title: string, list: En[]) => list.length > 0 && <section><h3 class="ml-h">{title} <small>{list.length}</small></h3>{list.map(card)}</section>;
  return (
    <div class="tpad xl ml">
      <h1>{fr ? 'Mon apprentissage' : 'My learning'}</h1>
      <div class="ml-stats">
        <div><b>{open.length}</b><span>{fr ? 'À suivre' : 'To do'}</span></div>
        <div class={due.some((e) => new Date(e.dueAt!).getTime() < now) ? 'bad' : ''}><b>{due.length}</b><span>{fr ? 'Échéance proche' : 'Due soon'}</span></div>
        <div><b>{done.length}</b><span>{fr ? 'Terminés' : 'Completed'}</span></div>
        {hours > 0 && <div><b>{hours}</b><span>{fr ? 'Heures de FC' : 'CE hours'}</span></div>}
      </div>
      {all.length === 0 && <p class="muted">{fr ? 'Vous n’êtes inscrit à aucun cours. Ouvrez l’onglet Cours pour en choisir un.' : 'You are not enrolled in any course yet. Open the Courses tab to pick one.'}</p>}
      <Paths call={call} locale={locale} canAuthor={canAuthor} onOpen={onOpen} />
      {sec(fr ? 'Échéance proche ou en retard' : 'Due soon or overdue', due)}
      {sec(fr ? 'En cours' : 'In progress', rest)}
      {sec(fr ? 'Terminés' : 'Completed', done)}
    </div>
  );
}
