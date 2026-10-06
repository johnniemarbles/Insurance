import { useEffect, useState } from 'preact/hooks';
import { ErrorBar } from './errorbar.tsx';
import { NeedsYou, ExpiryBars, Trend, type Need } from './hoinsights.tsx';
import { money } from './theme.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface Overview {
  pipeline: { stages: { name: string; count: number; value: number }[]; openCount: number; openValue: number; won: number; lost: number; winRate: number | null; stalled: number };
  tasks: { overdue: number; today: number; open: number };
  renewals: { expired: number; d30: number; weeks: number[] };
  activity: { name: string; count: number }[];
  team: number;
  partners: { partners: number; approved: number; submitted: number; incomplete: number; itemsExpired: number; itemsSoon: number };
  prev?: { day: string; data: Record<string, number> } | null;
}

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
const T = {
  'en': {
    title: 'Overview', mine: 'My day', needs: 'Needs you', pipe: 'Open pipeline', win: 'Win rate', over: 'Overdue tasks', team: 'People', partners: 'Partners approved',
    byStage: 'Pipeline by stage', renew: 'Renewals, next 90 days', active: 'Activity this week', onboard: 'Partner onboarding', noStage: 'No open records yet.', noAct: 'No activity in the last 7 days.',
    approved: 'Approved', submitted: 'Waiting for head office', incomplete: 'Not finished', none: '—',
    nOver: (n: number) => `${n} ${s(n, 'task is', 'tasks are')} overdue`, nStall: (n: number) => `${n} ${s(n, 'record looks', 'records look')} stuck`,
    nRen: (n: number) => `${n} ${s(n, 'renewal is', 'renewals are')} overdue`, nRen30: (n: number) => `${n} ${s(n, 'renewal', 'renewals')} in the next 30 days`,
    nExp: (n: number) => `${n} licence or E&O ${s(n, 'item has', 'items have')} expired`, nInc: (n: number) => `${n} ${s(n, 'partner has', 'partners have')} not finished onboarding`,
    open: 'Open', recs: (n: number) => `${n} ${s(n, 'record', 'records')}`,
  },
  'fr-CA': {
    title: 'Aperçu', mine: 'Ma journée', needs: 'À faire', pipe: 'Pipeline ouvert', win: 'Taux de réussite', over: 'Tâches en retard', team: 'Personnes', partners: 'Partenaires approuvés',
    byStage: 'Pipeline par étape', renew: 'Renouvellements, 90 prochains jours', active: 'Activité cette semaine', onboard: 'Intégration des partenaires', noStage: 'Aucun dossier ouvert.', noAct: 'Aucune activité ces 7 derniers jours.',
    approved: 'Approuvés', submitted: 'En attente du siège social', incomplete: 'Non terminés', none: '—',
    nOver: (n: number) => `${n} ${s(n, 'tâche est', 'tâches sont')} en retard`, nStall: (n: number) => `${n} ${s(n, 'dossier semble', 'dossiers semblent')} bloqué${n === 1 ? '' : 's'}`,
    nRen: (n: number) => `${n} ${s(n, 'renouvellement est', 'renouvellements sont')} en retard`, nRen30: (n: number) => `${n} ${s(n, 'renouvellement', 'renouvellements')} d’ici 30 jours`,
    nExp: (n: number) => `${n} ${s(n, 'permis ou police E&O a expiré', 'permis ou polices E&O ont expiré')}`, nInc: (n: number) => `${n} ${s(n, 'partenaire n’a', 'partenaires n’ont')} pas terminé l’intégration`,
    open: 'Ouvrir', recs: (n: number) => `${n} ${s(n, 'dossier', 'dossiers')}`,
  },
};

/** What a company or branch administrator sees first: the work in their own part of the organization, as numbers and small charts. */
export function OverviewPanel({ call, locale, go, currency }: { call: Call; locale: Locale; go: (page: string, id?: string) => void; currency: string }) {
  const x = T[locale];
  const [d, setD] = useState<Overview | null>(null);
  const [err, setErr] = useState('');
  const [all, setAll] = useState(false);
  useEffect(() => { call('GET', '/v1/insights/overview').then(setD, (e) => setErr((e as Error).message)); }, [call]);
  if (err) return <ErrorBar msg={err} retry="↻" />;
  if (!d) return <div class="msg">…</div>;
  const p = d.pipeline; const pt = d.partners; const pv = d.prev?.data;
  const needs: { need: Need; go: () => void }[] = [];
  const add = (key: string, text: string, page: string, id?: string) => needs.push({ need: { key, text, tab: 'all', label: x.open }, go: () => go(page, id) });
  if (d.tasks.overdue) add('task', x.nOver(d.tasks.overdue), 'home');
  if (d.renewals.expired) add('ren', x.nRen(d.renewals.expired), 'renewals');
  if (p.stalled) add('stall', x.nStall(p.stalled), 'pipelines');
  if (pt.itemsExpired) add('exp', x.nExp(pt.itemsExpired), 'compliance');
  if (pt.incomplete) add('inc', x.nInc(pt.incomplete), 'compliance');
  if (d.renewals.d30) add('r30', x.nRen30(d.renewals.d30), 'renewals');
  const maxV = Math.max(1, ...p.stages.map((z) => z.count));
  const maxA = Math.max(1, ...d.activity.map((z) => z.count));
  const tot = Math.max(1, pt.partners);
  const pct = p.winRate == null ? x.none : `${Math.round(p.winRate * 100)}%`;
  return (
    <div class="ovw">
      <NeedsYou needs={needs} locale={locale} openAll={all} setOpenAll={setAll} />
      <div class="hstats">
        <div class="hstat"><b>{money(p.openValue, currency, locale)}</b><span>{x.pipe}</span><small>{x.recs(p.openCount)}</small><Trend now={p.openCount} before={pv?.openCount} since={d.prev?.day} locale={locale} /></div>
        <div class="hstat"><b>{pct}</b><span>{x.win}</span></div>
        <div class={`hstat ${d.tasks.overdue ? 'warn' : ''}`}><b>{d.tasks.overdue}</b><span>{x.over}</span><Trend now={d.tasks.overdue} before={pv?.overdueTasks} since={d.prev?.day} locale={locale} /></div>
        {pt.partners > 0 ? <div class="hstat"><b>{pt.approved}/{pt.partners}</b><span>{x.partners}</span><Trend now={pt.approved} before={pv?.approved} since={d.prev?.day} locale={locale} /></div> : <div class="hstat"><b>{d.team}</b><span>{x.team}</span></div>}
      </div>
      <div class="charts">
        <section class="hcard chartcard" aria-label={x.byStage}><h4>{x.byStage}</h4>
          {p.stages.every((z) => z.count === 0) ? <div class="calm"><b>{x.noStage}</b></div> : p.stages.map((z) => (
            <div class="hb" key={z.name} style={{ gridTemplateColumns: '110px 1fr 28px', margin: '3px 0' }}><span>{z.name}</span><span class="tr"><i style={{ width: `${Math.round((z.count / maxV) * 100)}%` }} /></span><b>{z.count}</b></div>
          ))}
        </section>
        <section class="hcard chartcard"><h4>{x.renew}</h4><ExpiryBars e={{ overdue: d.renewals.expired, within30: d.renewals.d30, within14: 0, weeks: d.renewals.weeks }} locale={locale} /></section>
        <section class="hcard chartcard"><h4>{x.active}</h4>
          {d.activity.length === 0 ? <div class="calm"><b>{x.noAct}</b></div> : d.activity.map((a) => (
            <div class="hb" key={a.name} style={{ gridTemplateColumns: '110px 1fr 28px', margin: '3px 0' }}><span>{a.name}</span><span class="tr"><i style={{ width: `${Math.round((a.count / maxA) * 100)}%` }} /></span><b>{a.count}</b></div>
          ))}
        </section>
        {pt.partners > 0 && (
          <section class="hcard chartcard"><h4>{x.onboard}</h4>
            {([['approved', pt.approved], ['submitted', pt.submitted], ['incomplete', pt.incomplete]] as const).map(([k, n]) => (
              <div class="hb" key={k} style={{ gridTemplateColumns: '130px 1fr 28px', margin: '3px 0' }}><span>{x[k]}</span><span class="tr"><i style={{ width: `${Math.round((n / tot) * 100)}%` }} /></span><b>{n}</b></div>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}
export const overviewLabels = (locale: Locale) => ({ title: T[locale].title, mine: T[locale].mine });
