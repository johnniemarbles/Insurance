import type { Locale } from './types.ts';

/** Counts the server returns for head office, per country. Never names or records. */
export interface Insights {
  funnel: { partners: number; profile: number; documents: number; submitted: number; approved: number };
  backlog: { waiting: number; oldestDays: number; fresh: number; aging: number; stale: number; avgDaysToApprove: number | null };
  coverage: { meets: number; below: number; none: number };
  expiry: { overdue: number; within30: number; within14: number; weeks: number[] };
  appointments: { requested: number; inProgress: number; appointed: number; declined: number };
  companies: { total: number; adminNotSignedIn: number };
  prev?: { day: string; data: Record<string, number> } | null;
}
export type NeedTab = 'review' | 'all' | 'expiring' | 'companies';
export interface Need { key: string; text: string; tab: NeedTab | null; label?: string }

const s = (n: number, one: string, many: string) => (n === 1 ? one : many);
const T = {
  'en': {
    needs: 'Needs you', none: 'Nothing needs you right now.', all: 'See all', less: 'Show less', review: 'Review', open: 'Open', companies: 'Companies',
    wait: (n: number, d: number) => `${n} ${s(n, 'file is', 'files are')} waiting for review, oldest ${d} ${s(d, 'day', 'days')}`,
    over: (n: number) => `${n} licence or E&O ${s(n, 'item has', 'items have')} expired`,
    soon: (n: number) => `${n} ${s(n, 'item expires', 'items expire')} in the next 14 days`,
    below: (n: number) => `${n} ${s(n, 'partner is', 'partners are')} below the E&O minimum`,
    appt: (n: number) => `${n} carrier appointment ${s(n, 'request', 'requests')}`,
    invited: (n: number) => `${n} company ${s(n, 'admin has', 'admins have')} not signed in yet`,
    funnel: 'Onboarding funnel', stages: { partners: 'Partners', profile: 'Profile done', documents: 'Licence and E&O', submitted: 'Submitted', approved: 'Approved' } as Record<string, string>,
    expiry: 'Expiries, next 90 days', overdueL: 'Overdue', nowL: 'Now', expiryNone: 'No expiries in the next 90 days',
    expiryText: (o: number, t: number) => `${t} ${s(t, 'item expires', 'items expire')} in the next 90 days${o ? `, plus ${o} already overdue` : ''}`,
    backlog: 'Review backlog', fresh: 'Under 3 days', aging: '3 to 6 days', stale: '7 days or more', avg: (d: number) => `Average ${d} days to approve`, backlogNone: 'No files are waiting.',
    coverage: 'E&O coverage', meets: 'Meets the minimum', belowL: 'Below the minimum', noneL: 'No active E&O',
    appts: 'Carrier appointments', req: 'Requested', prog: 'In progress', done: 'Appointed', declined: 'Declined',
  },
  'fr-CA': {
    needs: 'À faire', none: 'Rien ne vous attend pour l’instant.', all: 'Tout voir', less: 'Voir moins', review: 'Examiner', open: 'Ouvrir', companies: 'Entreprises',
    wait: (n: number, d: number) => `${n} ${s(n, 'dossier attend', 'dossiers attendent')} un examen, le plus ancien depuis ${d} ${s(d, 'jour', 'jours')}`,
    over: (n: number) => `${n} ${s(n, 'permis ou police E&O a expiré', 'permis ou polices E&O ont expiré')}`,
    soon: (n: number) => `${n} ${s(n, 'échéance', 'échéances')} d’ici 14 jours`,
    below: (n: number) => `${n} ${s(n, 'partenaire est', 'partenaires sont')} sous le minimum E&O`,
    appt: (n: number) => `${n} ${s(n, 'demande', 'demandes')} de nomination auprès d’un assureur`,
    invited: (n: number) => `${n} ${s(n, 'administrateur d’entreprise ne s’est', 'administrateurs d’entreprise ne se sont')} pas encore connecté${n === 1 ? '' : 's'}`,
    funnel: 'Entonnoir d’intégration', stages: { partners: 'Partenaires', profile: 'Profil rempli', documents: 'Permis et E&O', submitted: 'Soumis', approved: 'Approuvés' } as Record<string, string>,
    expiry: 'Échéances, 90 prochains jours', overdueL: 'En retard', nowL: 'Maintenant', expiryNone: 'Aucune échéance d’ici 90 jours',
    expiryText: (o: number, t: number) => `${t} ${s(t, 'échéance', 'échéances')} d’ici 90 jours${o ? `, et ${o} déjà en retard` : ''}`,
    backlog: 'Dossiers en attente', fresh: 'Moins de 3 jours', aging: '3 à 6 jours', stale: '7 jours ou plus', avg: (d: number) => `${d} jours en moyenne pour approuver`, backlogNone: 'Aucun dossier en attente.',
    coverage: 'Garantie E&O', meets: 'Respecte le minimum', belowL: 'Sous le minimum', noneL: 'Aucune E&O active',
    appts: 'Nominations auprès des assureurs', req: 'Demandées', prog: 'En cours', done: 'Nommé', declined: 'Refusées',
  },
};

/** The short list of things that need a person, most urgent first. */
export function needsOf(i: Insights, locale: Locale, where = ''): Need[] {
  const x = T[locale]; const pre = where ? `${where}: ` : '';
  const out: Need[] = [];
  if (i.backlog.waiting) out.push({ key: 'wait', text: pre + x.wait(i.backlog.waiting, i.backlog.oldestDays), tab: 'review', label: x.review });
  if (i.expiry.overdue) out.push({ key: 'over', text: pre + x.over(i.expiry.overdue), tab: 'expiring', label: x.open });
  const soon = Math.max(0, i.expiry.within14 - i.expiry.overdue);
  if (soon) out.push({ key: 'soon', text: pre + x.soon(soon), tab: 'expiring', label: x.open });
  if (i.coverage.below) out.push({ key: 'below', text: pre + x.below(i.coverage.below), tab: 'all', label: x.open });
  if (i.companies.adminNotSignedIn) out.push({ key: 'inv', text: pre + x.invited(i.companies.adminNotSignedIn), tab: 'companies', label: x.companies });
  if (i.appointments.requested) out.push({ key: 'appt', text: pre + x.appt(i.appointments.requested), tab: null });
  return out;
}

export function NeedsYou({ needs, locale, openAll, setOpenAll }: { needs: { need: Need; go: () => void }[]; locale: Locale; openAll: boolean; setOpenAll: (v: boolean) => void }) {
  const x = T[locale];
  const shown = openAll ? needs : needs.slice(0, 3);
  return (
    <section class="needs" aria-label={x.needs}>
      <div class="erow"><b>{x.needs}</b><span class="spacer" />{needs.length > 3 && <button class="lk" onClick={() => setOpenAll(!openAll)}>{openAll ? x.less : `${x.all} (${needs.length})`}</button>}</div>
      {needs.length === 0 && <p class="muted" style={{ margin: '4px 0 8px' }}>{x.none}</p>}
      {shown.map(({ need, go: g }) => (
        <div class="need" key={need.key + need.text}><i class="dot" aria-hidden="true" /><span>{need.text}</span>{need.tab && <button class="btn" onClick={g}>{need.label}</button>}</div>
      ))}
    </section>
  );
}

export function Funnel({ f, locale, compact }: { f: Insights['funnel']; locale: Locale; compact?: boolean }) {
  const x = T[locale];
  const keys = ['partners', 'profile', 'documents', 'submitted', 'approved'] as const;
  const total = Math.max(1, f.partners);
  return (
    <div role="img" aria-label={`${x.funnel}: ${keys.map((k) => `${x.stages[k]} ${f[k]}`).join(', ')}`}>
      {keys.map((k) => (
        <div class="hb" key={k} style={compact ? { gridTemplateColumns: '96px 1fr 28px', margin: '3px 0' } : undefined}>
          <span>{x.stages[k]}</span><span class="tr"><i style={{ width: `${Math.round((f[k] / total) * 100)}%` }} /></span><b>{f[k]}</b>
        </div>
      ))}
    </div>
  );
}

export function ExpiryBars({ e, locale }: { e: Insights['expiry']; locale: Locale }) {
  const x = T[locale];
  const total = e.weeks.reduce((a, b) => a + b, 0);
  if (total === 0 && e.overdue === 0) return <div class="calm"><b>{x.expiryNone}</b></div>;
  const max = Math.max(1, e.overdue, ...e.weeks);
  const bars = [{ n: e.overdue, o: true, l: x.overdueL }, ...e.weeks.map((n, w) => ({ n, o: false, l: w === 0 ? x.nowL : w % 4 === 0 ? `${w}w` : '' }))];
  return (
    <div role="img" aria-label={x.expiryText(e.overdue, total)}>
      <div class="wk">
        {bars.map((b, i) => <div key={i}><em>{b.n || ''}</em><i class={b.o ? 'o' : ''} style={{ height: `${Math.max(b.n ? 6 : 2, Math.round((b.n / max) * 70))}px` }} /><small>{b.l}</small></div>)}
      </div>
    </div>
  );
}

function Stack({ parts }: { parts: { n: number; c: string; l: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  return (
    <>
      <div class="stack" role="img" aria-label={parts.map((p) => `${p.l} ${p.n}`).join(', ')}>{total > 0 && parts.map((p) => p.n > 0 && <i style={{ width: `${(p.n / total) * 100}%`, background: p.c }} />)}</div>
      <div class="legend">{parts.map((p) => <span style={{ '--c': p.c } as never}>{p.l} <b>{p.n}</b></span>)}</div>
    </>
  );
}

export function Widgets({ i, locale }: { i: Insights; locale: Locale }) {
  const x = T[locale];
  const b = i.backlog; const c = i.coverage; const a = i.appointments;
  return (
    <div class="charts">
      <section class="hcard chartcard"><h4>{x.backlog}</h4>
        {b.waiting === 0 ? <p class="muted">{x.backlogNone}</p> : <Stack parts={[{ n: b.fresh, c: 'var(--pri)', l: x.fresh }, { n: b.aging, c: 'var(--warn2)', l: x.aging }, { n: b.stale, c: 'var(--warn)', l: x.stale }]} />}
        {b.avgDaysToApprove != null && <p class="muted" style={{ margin: '8px 0 0' }}>{x.avg(b.avgDaysToApprove)}</p>}
      </section>
      <section class="hcard chartcard"><h4>{x.coverage}</h4>
        <Stack parts={[{ n: c.meets, c: 'var(--pri)', l: x.meets }, { n: c.below, c: 'var(--warn)', l: x.belowL }, { n: c.none, c: 'var(--gray)', l: x.noneL }]} />
      </section>
      <section class="hcard chartcard"><h4>{x.appts}</h4>
        <Stack parts={[{ n: a.requested, c: 'var(--warn2)', l: x.req }, { n: a.inProgress, c: 'var(--pri)', l: x.prog }, { n: a.appointed, c: 'var(--okc)', l: x.done }, { n: a.declined, c: 'var(--gray)', l: x.declined }]} />
      </section>
    </div>
  );
}

export function titles(locale: Locale) { const x = T[locale]; return { funnel: x.funnel, expiry: x.expiry }; }

/** "▲ 2 since 6 Sep": how a count moved since the saved day. Nothing is shown until there is history, or when nothing changed. */
export function Trend({ now, before, since, locale }: { now: number; before: number | undefined; since: string | undefined; locale: Locale }) {
  if (before === undefined || !since || now === before) return null;
  const d = now - before;
  const when = new Date(`${since}T12:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const txt = locale === 'fr-CA' ? `depuis le ${when}` : `since ${when}`;
  return <small class="trend" title={`${before} → ${now}`}><span aria-hidden="true">{d > 0 ? '▲' : '▼'}</span> {d > 0 ? '+' : '−'}{Math.abs(d)} {txt}</small>;
}
