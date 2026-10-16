// Renewals and deadlines for compliance officers: licence and E&O dates on a two-week timeline, what expires soon,
// and partners still in onboarding. Reads the existing dashboard and case lists only; nothing new is stored.
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { STAGE_LABEL } from './onboarding-shared.tsx';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

export interface Expiry { id: string; kind: 'licence' | 'eo'; label: string; expiresOn: string; status: 'expired' | 'expiring'; partnerName: string }
interface CaseRow { id: string; partnerName: string; stage: string; profile?: { done: number; total: number } | null }

const DAYS = 14;
const DAY_MS = 86400000;
const STAGES = Object.keys(STAGE_LABEL) as (keyof typeof STAGE_LABEL)[];

const T = {
  en: { title: 'Renewals and deadlines', sub: 'Two weeks from Monday', partner: 'Partner', noDates: 'No licence or E&O dates fall in the next two weeks.', expired: 'Expired', expires: 'Expires', licence: 'Licence', eo: 'E&O', upTitle: 'Coming up', upSub: 'Licence and E&O, by date', upNone: 'Nothing expires in the next 30 days.', obTitle: 'In onboarding', obSub: 'Partners not yet active', obNone: 'No partners in onboarding.', err: 'Could not load deadlines.', days: 'days', steps: 'steps done' },
  'fr-CA': { title: 'Échéances et renouvellements', sub: 'Deux semaines à partir du lundi', partner: 'Partenaire', noDates: 'Aucune date de permis ou d’E&O dans les deux prochaines semaines.', expired: 'Expiré', expires: 'Expire', licence: 'Permis', eo: 'E&O', upTitle: 'À venir', upSub: 'Permis et E&O, par date', upNone: 'Rien n’expire dans les 30 prochains jours.', obTitle: 'En intégration', obSub: 'Partenaires pas encore actifs', obNone: 'Aucun partenaire en intégration.', err: 'Impossible de charger les échéances.', days: 'j', steps: 'étapes faites' },
} as const;

// Calendar dates are kept as YYYY-MM-DD strings and compared in UTC, so the local time zone cannot shift a day.
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const utc = (k: string) => Date.parse(`${k}T00:00:00Z`);

export function DeadlinesPanel({ call, locale }: { call: Call; locale: Locale }) {
  const t = T[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [expiries, setExpiries] = useState<Expiry[] | null>(null);
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    Promise.all([call('GET', '/v1/onboarding/dashboard'), call('GET', '/v1/onboarding/cases')]).then(([d, c]) => {
      if (!live) return;
      setExpiries(d.expiries ?? []);
      setCases(c.cases ?? []);
    }, () => { if (live) setErr(t.err); });
    return () => { live = false; };
  }, [call]);

  // Monday of this week is column 0. Everything on the timeline is measured in days from it.
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
  const mondayKey = keyOf(monday);
  const dayOf = (k: string) => Math.round((utc(k) - utc(mondayKey)) / DAY_MS);
  const todayIdx = dayOf(keyOf(now));
  const days = Array.from({ length: DAYS }, (_, i) => new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i));
  const dateText = (k: string) => new Intl.DateTimeFormat(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(utc(k)));
  const weekday = (d: Date) => new Intl.DateTimeFormat(locale === 'fr-CA' ? 'fr-CA' : 'en-CA', { weekday: 'short' }).format(d);
  const kindText = (k: Expiry['kind']) => (k === 'eo' ? t.eo : t.licence);
  const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const daysTo = (k: string) => Math.round((utc(k) - utc(keyOf(now))) / DAY_MS);

  // One row per expiry that falls inside the two weeks, or that has already run out. Its bar runs from today to the date.
  const rows = (expiries ?? []).flatMap((e) => {
    const idx = dayOf(e.expiresOn);
    if (idx > DAYS - 1) return [];
    if (idx < 0) return [{ e, start: 0, end: todayIdx, expired: true }];
    return [{ e, start: Math.min(idx, todayIdx), end: Math.max(idx, todayIdx), expired: e.status === 'expired' }];
  });
  const upcoming = [...(expiries ?? [])].sort((a, b) => utc(a.expiresOn) - utc(b.expiresOn)).slice(0, 6);
  const inOnboarding = cases.filter((c) => c.stage !== 'active');

  return (
    <section class="dl dl-glass" aria-label={t.title}>
      {err && <p class="err" role="alert">{err}</p>}
      <section class="hcard">
        <div class="dl-h">
          <h2>{t.title}</h2>
          <p>{t.sub} · {dateText(mondayKey)}</p>
        </div>
        {rows.length === 0 ? <p class="muted">{t.noDates}</p> : (
          <div class="dl-tl" role="region" aria-label={t.title} tabIndex={0}>
            <div class="dl-in">
              <div class="dl-row dl-head">
                <div class="dl-who-h">{t.partner}</div>
                {days.map((d, i) => <div class={`dl-day${i === todayIdx ? ' today' : ''}`}>{weekday(d)}<b>{d.getDate()}</b></div>)}
              </div>
              {rows.map(({ e, start, end, expired }) => (
                <div class="dl-row">
                  <div class="dl-who" style={{ gridColumn: 1, gridRow: 1 }}><div class="dl-av" aria-hidden="true">{initials(e.partnerName)}</div><div class="dl-wt"><b>{e.partnerName}</b><span>{kindText(e.kind)} · {e.label}</span><em class={`dl-chip${expired ? ' exp' : ''}`}>{expired ? t.expired : t.expires}</em></div></div>
                  {days.map((_, i) => <div class={`dl-cell${i % 7 >= 5 ? ' we' : ''}`} style={{ gridColumn: i + 2, gridRow: 1 }} aria-hidden="true" />)}
                  <div class={`dl-bar${expired ? ' exp' : ''}`} style={{ gridColumn: `${start + 2} / ${end + 3}`, gridRow: 1 }}>
                    {expired ? `${t.expired} ${dateText(e.expiresOn)}` : `${t.expires} ${dateText(e.expiresOn)}`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <div class="pg-cols">
        <section class="hcard">
          <div class="dl-h"><h2>{t.upTitle}</h2><p>{t.upSub}</p></div>
          {upcoming.length === 0 ? <p class="muted">{t.upNone}</p> : (
            <ul class="dl-up">
              {upcoming.map((e) => (
                <li class={e.status === 'expired' ? 'hot' : ''}>
                  <div class="dl-wt"><b>{e.partnerName}</b><span>{kindText(e.kind)} · {e.label} · {e.status === 'expired' ? t.expired : t.expires} {dateText(e.expiresOn)}</span></div>
                  <em class="dl-pill">{daysTo(e.expiresOn) < 0 ? t.expired : `${daysTo(e.expiresOn)} ${t.days}`}</em>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section class="hcard">
          <div class="dl-h"><h2>{t.obTitle}</h2><p>{t.obSub}</p></div>
          {inOnboarding.length === 0 ? <p class="muted">{t.obNone}</p> : (
            <div class="dl-ob">
              {inOnboarding.map((c) => {
                const prof = c.profile ?? { done: 0, total: 5 };
                const pct = Math.round((prof.done / prof.total) * 100);
                return (
                  <div>
                    <div class="dl-av" aria-hidden="true">{initials(c.partnerName)}</div>
                    <b>{c.partnerName}</b>
                    <span>{STAGE_LABEL[c.stage as keyof typeof STAGE_LABEL]?.[locale === 'fr-CA' ? 'fr-CA' : 'en'] ?? c.stage}</span>
                    <small>{prof.done}/{prof.total} {t.steps}</small>
                    <div class="dl-bar2" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}
