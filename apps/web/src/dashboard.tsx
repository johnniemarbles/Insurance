import { useEffect, useState } from 'preact/hooks';
import { ErrorBar } from './errorbar.tsx';
import { money } from './theme.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Dash {
  days: number;
  totals: { openCount: number; openValue: number; won: number; wonValue: number; lost: number; created: number; daysToWin: number | null; winRate: number | null };
  months: { month: string; won: number; wonValue: number; created: number }[];
  aging: { bucket: string; count: number; value: number }[];
  stages: { name: string; count: number; value: number }[];
  people: { name: string; open: number; openValue: number; won: number; wonValue: number; moves: number }[];
  pipelines: { id: string; name: string }[];
}

const X = {
  'en': {
    title: 'Dashboard', sub: 'How the business is doing, from the records you can see.', period: 'Period', pipeline: 'Pipeline', allP: 'All pipelines', d: (n: number) => `Last ${n} days`,
    open: 'Open', won: 'Won', lost: 'Lost', winRate: 'Win rate', days2win: 'Days to win', created: 'New records', valueW: 'Value',
    byStage: 'Open value by stage', trend: 'Won value by month', aging: 'How long records have sat in their stage', agingHelp: 'Records that have waited longest are the ones to chase first.',
    people: 'People', pOpen: 'Open', pWon: 'Won', pMoves: 'Updates', none: 'Nothing to show for this period yet.', retry: 'Try again', dayWord: 'days', rec: 'records',
  },
  'fr-CA': {
    title: 'Tableau de bord', sub: 'Où en est l’entreprise, selon les dossiers que vous pouvez voir.', period: 'Période', pipeline: 'Pipeline', allP: 'Tous les pipelines', d: (n: number) => `${n} derniers jours`,
    open: 'Ouverts', won: 'Gagnés', lost: 'Perdus', winRate: 'Taux de réussite', days2win: 'Jours pour gagner', created: 'Nouveaux dossiers', valueW: 'Valeur',
    byStage: 'Valeur ouverte par étape', trend: 'Valeur gagnée par mois', aging: 'Depuis combien de temps les dossiers sont à leur étape', agingHelp: 'Les dossiers qui attendent depuis le plus longtemps sont ceux à relancer en premier.',
    people: 'Personnes', pOpen: 'Ouverts', pWon: 'Gagnés', pMoves: 'Mises à jour', none: 'Rien à afficher pour cette période.', retry: 'Réessayer', dayWord: 'jours', rec: 'dossiers',
  },
};

function Bars({ rows, fmt, color }: { rows: { label: string; v: number; sub?: string }[]; fmt: (n: number) => string; color: string }) {
  const max = Math.max(1, ...rows.map((r) => r.v));
  return (
    <div class="dbars" role="img" aria-label={rows.map((r) => `${r.label} ${fmt(r.v)}`).join(', ')}>
      {rows.map((r) => (
        <div class="dbar" key={r.label}>
          <span class="dl" title={r.label}>{r.label}</span>
          <div class="dt"><i style={{ width: `${r.v > 0 ? Math.max(2, (r.v / max) * 100) : 0}%`, background: color }} /></div>
          <span class="dv">{fmt(r.v)}{r.sub ? <small class="muted"> · {r.sub}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

export function DashboardPage({ call, locale, currency }: { call: Call; locale: Locale; currency: string }) {
  const x = X[locale];
  const [days, setDays] = useState(30);
  const [pid, setPid] = useState('');
  const [d, setD] = useState<Dash | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setErr('');
    call('GET', `/v1/dashboard?days=${days}${pid ? `&pipelineId=${pid}` : ''}`).then(setD, (e) => setErr((e as Error).message));
  }, [call, days, pid]);
  if (err) return <ErrorBar msg={err} retry={x.retry} />;
  if (!d) return <div class="msg">…</div>;
  const m = (n: number) => money(n, currency, locale);
  const pct = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);
  const t = d.totals;
  const monthLabel = (s: string) => new Date(`${s}-01T00:00:00`).toLocaleDateString(locale, { month: 'short', year: '2-digit' });
  const agingLabel = (b: string) => `${b} ${x.dayWord}`;
  return (
    <div class="home dash">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{x.title}</h2><span class="muted">{x.sub}</span></div></div>
      <div class="dfilters">
        <label>{x.period} <select value={days} onChange={(e) => setDays(Number((e.target as HTMLSelectElement).value))}>{[7, 30, 90, 365].map((n) => <option value={n}>{x.d(n)}</option>)}</select></label>
        <label>{x.pipeline} <select value={pid} onChange={(e) => setPid((e.target as HTMLSelectElement).value)}><option value="">{x.allP}</option>{d.pipelines.map((p) => <option value={p.id}>{p.name}</option>)}</select></label>
      </div>
      <div class="kpis">
        <div><b>{t.openCount}</b><span>{x.open}</span><small>{m(t.openValue)}</small></div>
        <div><b>{t.won}</b><span>{x.won}</span><small>{m(t.wonValue)}</small></div>
        <div><b>{t.lost}</b><span>{x.lost}</span></div>
        <div><b>{pct(t.winRate)}</b><span>{x.winRate}</span></div>
        <div><b>{t.daysToWin == null ? '—' : Math.round(t.daysToWin)}</b><span>{x.days2win}</span></div>
        <div><b>{t.created}</b><span>{x.created}</span></div>
      </div>
      <div class="dgrid">
        <section class="hcard"><div class="hsec-h"><h3>{x.byStage}</h3></div>
          {d.stages.every((s) => s.count === 0) ? <p class="muted">{x.none}</p> : <Bars rows={d.stages.map((s) => ({ label: s.name, v: s.value, sub: `${s.count} ${x.rec}` }))} fmt={m} color="#2563eb" />}
        </section>
        <section class="hcard"><div class="hsec-h"><h3>{x.trend}</h3></div>
          <Bars rows={d.months.map((r) => ({ label: monthLabel(r.month), v: r.wonValue, sub: `${r.won} ${x.won.toLowerCase()}` }))} fmt={m} color="#16a34a" />
        </section>
        <section class="hcard"><div class="hsec-h"><h3>{x.aging}</h3></div><p class="muted">{x.agingHelp}</p>
          <Bars rows={d.aging.map((a) => ({ label: agingLabel(a.bucket), v: a.count, sub: m(a.value) }))} fmt={(n) => String(n)} color="#f59e0b" />
        </section>
        <section class="hcard"><div class="hsec-h"><h3>{x.people}</h3></div>
          {d.people.length === 0 ? <p class="muted">{x.none}</p> : (
            <table class="dtable"><thead><tr><th>{x.people}</th><th>{x.pOpen}</th><th>{x.pWon}</th><th>{x.valueW}</th><th>{x.pMoves}</th></tr></thead>
              <tbody>{d.people.map((p) => <tr key={p.name}><td>{p.name}</td><td>{p.open}</td><td>{p.won}</td><td>{m(p.wonValue)}</td><td>{p.moves}</td></tr>)}</tbody></table>
          )}
        </section>
      </div>
    </div>
  );
}
