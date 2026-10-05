import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface HomeData {
  upcoming: { id: string; title: string; dueAt: string | null; boxId: string | null; boxName: string | null; pipelineId: string | null }[];
  tasks: { id: string; title: string; dueAt: string | null; boxId: string | null; boxName: string | null; pipelineId: string | null }[];
  risks: { id: string; pipelineId: string; pipeline: string; name: string; stage: string; days: number; reasons: string[] }[];
  merges: { id: string; name: string; status: string; total: number; sent: number; failed: number }[];
  recent: { id: string; name: string; pipelineId: string; pipeline: string; stage: string; updatedAt: string }[];
}

const X = {
  'en': {
    title: 'My day', due: 'Due today and overdue', noTasks: 'Nothing due. Nice.', later: 'Coming up and no date', noDate: 'No date', attention: 'Needs attention', noRisk: 'Nothing looks stuck.', merges: 'Mail merges in progress', noMerges: 'No merge is running.',
    recent: 'Recently updated', overdue: 'Overdue', today: 'Today', sent: (a: number, b: number) => `${a} of ${b} sent`, paused: 'paused', days: (n: number) => `${n} days in stage`,
    why: { stalled: 'Stalled', overdue: 'Overdue task', past_close: 'Past close date', no_next_step: 'No next step', unowned: 'No owner' } as Record<string, string>, all: 'See all',
  },
  'fr-CA': {
    title: 'Ma journée', due: 'À faire aujourd’hui et en retard', noTasks: 'Rien à faire. Parfait.', later: 'À venir et sans date', noDate: 'Sans date', attention: 'À surveiller', noRisk: 'Rien ne semble bloqué.', merges: 'Publipostages en cours', noMerges: 'Aucun publipostage en cours.',
    recent: 'Récemment modifiés', overdue: 'En retard', today: 'Aujourd’hui', sent: (a: number, b: number) => `${a} sur ${b} envoyés`, paused: 'en pause', days: (n: number) => `${n} jours dans l’étape`,
    why: { stalled: 'Bloqué', overdue: 'Tâche en retard', past_close: 'Clôture dépassée', no_next_step: 'Aucune prochaine étape', unowned: 'Sans responsable' } as Record<string, string>, all: 'Tout voir',
  },
};

/** The first page: what needs the person today, on one screen. */
export function HomePage({ call, locale, go }: { call: Call; locale: Locale; go: (page: string, id?: string) => void }) {
  const x = X[locale];
  const [d, setD] = useState<HomeData | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', '/v1/home').then(setD, (e) => setErr((e as Error).message)); }, [call]);
  if (err) return <div class="err" role="alert">{err}</div>;
  if (!d) return <div class="msg">…</div>;
  const late = (iso: string | null) => (iso ? new Date(iso) < new Date(new Date().setHours(0, 0, 0, 0)) : false);
  return (
    <div class="home">
      <h2>{x.title}</h2>
      <div class="homegrid">
        <section class="hcard"><h3>{x.due}</h3>
          {d.tasks.length === 0 && <p class="muted">{x.noTasks}</p>}
          {d.tasks.map((t) => (
            <button class="hrow" key={t.id} onClick={() => t.pipelineId && t.boxId ? go('pipelines', t.pipelineId) : undefined}>
              <span>{t.title}</span><small class="muted">{t.boxName ?? ''}</small>
              <span class={`chip${late(t.dueAt) ? ' warn' : ''}`}>{late(t.dueAt) ? x.overdue : x.today}</span>
            </button>
          ))}
        </section>
        <section class="hcard"><h3>{x.later}</h3>
          {(d.upcoming ?? []).length === 0 && <p class="muted">—</p>}
          {(d.upcoming ?? []).map((t) => (
            <button class="hrow" key={t.id} onClick={() => t.pipelineId && t.boxId ? go('pipelines', t.pipelineId) : undefined}>
              <span>{t.title}</span><small class="muted">{t.boxName ?? ''}</small>
              <span class="chip">{t.dueAt ? new Date(t.dueAt).toLocaleDateString(locale) : x.noDate}</span>
            </button>
          ))}
        </section>
        <section class="hcard"><h3>{x.attention}</h3>
          {d.risks.length === 0 && <p class="muted">{x.noRisk}</p>}
          {d.risks.map((r) => (
            <button class="hrow" key={r.id} onClick={() => go('pipelines', r.pipelineId)}>
              <span>{r.name}</span><small class="muted">{r.pipeline} · {r.stage} · {x.days(r.days)}</small>
              <span>{r.reasons.map((k) => <span class="chip">{x.why[k] ?? k}</span>)}</span>
            </button>
          ))}
        </section>
        <section class="hcard"><h3>{x.merges}</h3>
          {d.merges.length === 0 && <p class="muted">{x.noMerges}</p>}
          {d.merges.map((m) => (
            <button class="hrow" key={m.id} onClick={() => go('merges')}>
              <span>{m.name}</span><small class="muted">{x.sent(m.sent, m.total)}{m.status === 'paused' ? ` · ${x.paused}` : ''}{m.failed ? ` · ${m.failed} ✕` : ''}</small>
              <progress max={m.total || 1} value={m.sent} />
            </button>
          ))}
        </section>
        <section class="hcard"><h3>{x.recent}</h3>
          {d.recent.map((r) => (
            <button class="hrow" key={r.id} onClick={() => go('pipelines', r.pipelineId)}>
              <span>{r.name}</span><small class="muted">{r.pipeline} · {r.stage} · {new Date(r.updatedAt).toLocaleDateString(locale)}</small>
            </button>
          ))}
        </section>
      </div>
    </div>
  );
}
