import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { Face } from './presence.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const X = {
  en: {
    title: 'Partners', companies: 'Every partner company you can see. Open one to see its compliance file.', branch: 'Partners in your branch',
    branchSub: 'The partners in your branch and whether they are online now.', online: 'Online now', none: 'Nobody else in your branch is online.',
    search: 'Search partners', steps: 'steps', noCompanies: 'No partner companies yet.', noMembers: 'No other partners in your branch yet.',
    you: 'you', onlineNow: 'Online now', notSignedIn: 'Not signed in yet', lastActive: 'Last active', open: 'Open file', loading: 'Loading…',
    status: { complete: 'Complete', incomplete: 'Incomplete', approved: 'Approved', pending: 'Waiting', frozen: 'Frozen' } as Record<string, string>,
  },
  'fr-CA': {
    title: 'Partenaires', companies: 'Chaque entreprise partenaire que vous voyez. Ouvrez-en une pour voir son dossier de conformité.', branch: 'Partenaires de votre succursale',
    branchSub: 'Les partenaires de votre succursale et s’ils sont en ligne maintenant.', online: 'En ligne maintenant', none: 'Personne d’autre de votre succursale n’est en ligne.',
    search: 'Rechercher un partenaire', steps: 'étapes', noCompanies: 'Aucune entreprise partenaire pour l’instant.', noMembers: 'Aucun autre partenaire dans votre succursale pour l’instant.',
    you: 'vous', onlineNow: 'En ligne maintenant', notSignedIn: 'Pas encore connecté', lastActive: 'Dernière activité', open: 'Ouvrir le dossier', loading: 'Chargement…',
    status: { complete: 'Complet', incomplete: 'Incomplet', approved: 'Approuvé', pending: 'En attente', frozen: 'Gelé' } as Record<string, string>,
  },
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

function ago(iso: string, locale: Locale): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (mins < 60) return rtf.format(-Math.max(mins, 1), 'minute');
  if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), 'hour');
  return rtf.format(-Math.round(mins / 60 / 24), 'day');
}

/** The Partners page. Compliance staff see every partner company they can see; partners see the people in their branch. */
export function PartnersPage({ call, locale, headOffice, go }: { call: Call; locale: Locale; headOffice: boolean; go: (page: string, id?: string) => void }) {
  const x = X[locale];
  const [officer, setOfficer] = useState<boolean | null>(null);
  useEffect(() => { void call('GET', '/v1/onboarding/mine').then((r) => setOfficer(r.officer === true), () => setOfficer(false)); }, [call]);
  if (officer === null) return <div class="msg">{x.loading}</div>;
  return officer ? <Companies call={call} locale={locale} headOffice={headOffice} go={go} /> : <Branch call={call} locale={locale} />;
}

function Companies({ call, locale, headOffice, go }: { call: Call; locale: Locale; headOffice: boolean; go: (page: string, id?: string) => void }) {
  const x = X[locale];
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const base = headOffice ? '/v1/ho' : '/v1/compliance';
  // Head office gets every company in the country (its own shape); compliance staff get the companies they manage, with their checklist.
  useEffect(() => {
    void call('GET', `${base}/partners`).then((r) => setRows(((r.partners ?? []) as any[]).map((p) => (headOffice
      ? { id: p.nodeId, name: p.name, parent: p.company, status: p.status, steps: [] }
      : { id: p.id, name: p.name, parent: p.parent, status: p.status, steps: p.checklist?.steps ?? [] }))), () => setRows([]));
  }, [call, base, headOffice]);
  const shown = useMemo(() => (rows ?? []).filter((p) => !q || `${p.name} ${p.parent ?? ''}`.toLowerCase().includes(q.toLowerCase())), [rows, q]);
  return (
    <div class="home">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{x.title}</h2><span class="muted">{x.companies}</span></div></div>
      <div class="hcard">
        <input type="search" placeholder={x.search} aria-label={x.search} value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} class="pt-search" />
        {rows === null ? <p class="muted">{x.loading}</p> : shown.length === 0 ? <p class="muted">{x.noCompanies}</p> : (
          <ul class="pt-list">
            {shown.map((p) => {
              const steps = p.steps as { done: boolean }[];
              const done = steps.filter((s) => s.done).length;
              return (
                <li key={p.id}>
                  <button class="pt-row" onClick={() => go('compliance', p.id)} aria-label={`${p.name}: ${x.open}`}>
                    <span class="pt-av" aria-hidden="true">{initials(p.name)}</span>
                    <span class="pt-main"><b>{p.name}</b><small class="muted">{p.parent ?? ''}</small></span>
                    <span class="pt-meta"><span class={`pt-pill ${p.status === 'complete' || p.status === 'approved' ? 'ok' : ''}`}>{x.status[p.status] ?? p.status}</span>{steps.length > 0 && <small class="muted">{done}/{steps.length} {x.steps}</small>}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function Branch({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale];
  const [members, setMembers] = useState<any[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => call('GET', '/v1/partners/branch').then((r) => { if (alive) setMembers(r.members ?? []); }, () => { if (alive) setMembers([]); });
    load();
    const id = window.setInterval(load, 60_000);
    return () => { alive = false; window.clearInterval(id); };
  }, [call]);
  const online = (members ?? []).filter((m) => m.onlineNow && !m.me);
  return (
    <div class="home">
      <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{x.branch}</h2><span class="muted">{x.branchSub}</span></div></div>
      <div class="hcard">
        <h4 style={{ margin: '0 0 8px' }}>{x.online}</h4>
        {members === null ? <p class="muted">{x.loading}</p> : online.length === 0 ? <p class="muted">{x.none}</p> : (
          <div class="pz pt-online">{online.map((m) => <Face key={m.id} p={{ id: m.id, name: m.name, pictureUrl: m.pictureUrl }} />)}</div>
        )}
      </div>
      <div class="hcard">
        {members && members.length === 0 ? <p class="muted">{x.noMembers}</p> : (
          <ul class="pt-list">
            {(members ?? []).map((m) => (
              <li key={m.id}>
                <div class="pt-row static">
                  <span class="pt-av" aria-hidden="true">{m.pictureUrl ? <img src={m.pictureUrl} alt="" referrerPolicy="no-referrer" /> : initials(m.name)}</span>
                  <span class="pt-main"><b>{m.name}{m.me ? <small class="muted"> · {x.you}</small> : null}</b><small class="muted">{m.company}</small></span>
                  <span class="pt-meta">
                    {m.onlineNow
                      ? <span class="pt-pill ok"><i class="pt-dot" aria-hidden="true" /> {x.onlineNow}</span>
                      : <small class="muted">{m.lastActiveAt ? `${x.lastActive} ${ago(m.lastActiveAt, locale)}` : x.notSignedIn}</small>}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
