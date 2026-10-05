import { useEffect, useMemo, useState } from 'preact/hooks';
import { ErrorBar } from './errorbar.tsx';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface Ren { id: string; name: string; pipelineId: string; pipeline: string; stage: string; renewalDate: string; daysLeft: number; policyType: string | null; ownerName: string | null; hasOpenTask: boolean }
interface Data { items: Ren[]; counts: { expired: number; d30: number; d60: number; d90: number } }

const X = {
  'en': { title: 'Renewals', sub: 'Policies coming up for renewal, nearest first. Reminder tasks are created for you at 90, 60 and 30 days.', all: 'All', expired: 'Expired', d30: 'Next 30 days', d60: '31 to 60 days', d90: '61 to 90 days', none: 'No renewals in this window.', retry: 'Try again',
    left: (n: number) => (n < 0 ? `${-n} day${n === -1 ? '' : 's'} ago` : n === 0 ? 'Today' : `in ${n} day${n === 1 ? '' : 's'}`), task: 'Reminder set', tip: 'Add a “Renewal date” field to a pipeline for its records to appear here.' },
  'fr-CA': { title: 'Renouvellements', sub: 'Les polices à renouveler, de la plus proche à la plus éloignée. Des tâches de rappel sont créées à 90, 60 et 30 jours.', all: 'Tous', expired: 'Échus', d30: '30 prochains jours', d60: '31 à 60 jours', d90: '61 à 90 jours', none: 'Aucun renouvellement dans cette période.', retry: 'Réessayer',
    left: (n: number) => (n < 0 ? `il y a ${-n} jour${n === -1 ? '' : 's'}` : n === 0 ? 'Aujourd’hui' : `dans ${n} jour${n === 1 ? '' : 's'}`), task: 'Rappel créé', tip: 'Ajoutez un champ « Date de renouvellement » à un pipeline pour que ses dossiers apparaissent ici.' },
};
type Win = 'all' | 'expired' | 'd30' | 'd60' | 'd90';
const inWin = (w: Win, n: number) => w === 'all' || (w === 'expired' ? n < 0 : w === 'd30' ? n >= 0 && n <= 30 : w === 'd60' ? n > 30 && n <= 60 : n > 60 && n <= 90);
export const tone = (n: number) => (n < 0 ? 'bad' : n <= 30 ? 'warn' : 'ok');

export function RenewalsPage({ call, locale, go }: { call: Call; locale: Locale; go: (page: string, id?: string) => void }) {
  const x = X[locale];
  const [d, setD] = useState<Data | null>(null);
  const [err, setErr] = useState('');
  const [win, setWin] = useState<Win>('all');
  useEffect(() => { call('GET', '/v1/renewals?days=120&back=60').then(setD, (e) => setErr((e as Error).message)); }, [call]);
  const groups = useMemo(() => {
    const m = new Map<string, Ren[]>();
    for (const r of (d?.items ?? []).filter((i) => inWin(win, i.daysLeft))) {
      const k = new Date(`${r.renewalDate}T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [d, win, locale]);
  if (err) return <ErrorBar msg={err} retry={x.retry} />;
  if (!d) return <div class="msg">…</div>;
  const tabs: [Win, string, number][] = [['all', x.all, d.items.length], ['expired', x.expired, d.counts.expired], ['d30', x.d30, d.counts.d30], ['d60', x.d60, d.counts.d60], ['d90', x.d90, d.counts.d90]];
  return (
    <div class="home">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{x.title}</h2><span class="muted">{x.sub}</span></div></div>
      <div class="rstats" role="tablist">
        {tabs.map(([k, label, n]) => (
          <button role="tab" aria-selected={win === k} class={`rstat ${k === 'expired' ? 'bad' : k === 'd30' ? 'warn' : ''}`} onClick={() => setWin(k)}><b>{n}</b><span>{label}</span></button>
        ))}
      </div>
      {groups.length === 0 && <div class="hcard"><p class="muted">{x.none}</p>{d.items.length === 0 && <p class="muted">{x.tip}</p>}</div>}
      {groups.map(([month, rows]) => (
        <section class="hcard rgroup" key={month}>
          <h3>{month}</h3>
          {rows.map((r) => (
            <button class="hrow" key={r.id} onClick={() => go('pipelines', `${r.pipelineId}::open=${r.id}`)}>
              <span class="rname">{r.name}{r.policyType ? <span class="chip" style={{ marginLeft: '8px' }}>{r.policyType}</span> : null}</span>
              <small class="muted">{r.pipeline} · {r.stage}{r.ownerName ? ` · ${r.ownerName}` : ''}{r.hasOpenTask ? ` · ✓ ${x.task}` : ''}</small>
              <span class={`due ${tone(r.daysLeft)}`}>{new Date(`${r.renewalDate}T00:00:00`).toLocaleDateString(locale, { month: 'short', day: 'numeric' })} · {x.left(r.daysLeft)}</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}
