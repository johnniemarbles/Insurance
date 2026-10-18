import { useEffect, useMemo, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { Face } from './presence.tsx';
import { PartnerProfile360 } from './partner-profile-360.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const X = {
  en: {
    title: 'Partners', companies: 'Every partner company you can see. Open one to see its compliance file.', branch: 'Partners across the country',
    branchSub: 'Grouped by branch, with who is online now.', online: 'Online now', none: 'Nobody else is online right now.',
    search: 'Search partners', steps: 'steps', noCompanies: 'No partner companies yet.', noMembers: 'No other partners yet.',
    you: 'you', onlineNow: 'Online now', notSignedIn: 'Not signed in yet', lastActive: 'Last active', open: 'Open file', loading: 'Loading…',
    status: { complete: 'Complete', incomplete: 'Incomplete', approved: 'Approved', pending: 'Waiting', frozen: 'Frozen' } as Record<string, string>,
  },
  'fr-CA': {
    title: 'Partenaires', companies: 'Chaque entreprise partenaire que vous voyez. Ouvrez-en une pour voir son dossier de conformité.', branch: 'Partenaires de tout le pays',
    branchSub: 'Groupés par succursale, avec qui est en ligne maintenant.', online: 'En ligne maintenant', none: 'Personne d’autre n’est en ligne pour l’instant.',
    search: 'Rechercher un partenaire', steps: 'étapes', noCompanies: 'Aucune entreprise partenaire pour l’instant.', noMembers: 'Aucun autre partenaire pour l’instant.',
    you: 'vous', onlineNow: 'En ligne maintenant', notSignedIn: 'Pas encore connecté', lastActive: 'Dernière activité', open: 'Ouvrir le dossier', loading: 'Chargement…',
    status: { complete: 'Complet', incomplete: 'Incomplet', approved: 'Approuvé', pending: 'En attente', frozen: 'Gelé' } as Record<string, string>,
  },
};

function initials(name?: string | null): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
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
  const [status, setStatus] = useState('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [page, setPage] = useState(0);
  const [featured, setFeatured] = useState(0);
  const [selectedPartner, setSelectedPartner] = useState<string | null>(null);
  const base = headOffice ? '/v1/ho' : '/v1/compliance';
  useEffect(() => {
    let active = true;
    void call('GET', `${base}/partners`).then(r => {
      if (!active) return;
      setRows(((r.partners ?? []) as any[]).map(p => headOffice
        ? { id: p.nodeId, name: p.name, parent: p.company, status: p.status, steps: [] }
        : { id: p.id, name: p.name, parent: p.parent, status: p.status, steps: p.checklist?.steps ?? [] }));
    }, () => { if (active) setRows([]); });
    return () => { active = false; };
  }, [call, base, headOffice]);
  const shown = useMemo(() => (rows ?? []).filter(p => {
    const partnerName = String(p.name ?? '');
    const parentName = String(p.parent ?? '');
    const matches = !q || `${partnerName} ${parentName}`.toLowerCase().includes(q.toLowerCase());
    return matches && (status === 'all' || (status === 'attention'
      ? p.status !== 'complete' && p.status !== 'approved'
      : p.status === status));
  }).sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''))), [rows, q, status]);
  const total = rows?.length ?? 0;
  const complete = rows?.filter(p => p.status === 'complete' || p.status === 'approved').length ?? 0;
  const perPage = 12;
  const pages = Math.max(1, Math.ceil(shown.length / perPage));
  const safePage = Math.min(page, pages - 1);
  const featuredRows = (rows ?? []).filter(p => p.status === 'complete' || p.status === 'approved').slice(0, 12);
  const featuredStart = Math.min(featured, Math.max(0, featuredRows.length - 1));
  const card = (p: any, compact = false) => {
    const steps = (p.steps ?? []) as { done: boolean }[];
    const done = steps.filter(s => s.done).length;
    const partnerName = p.name || (locale === 'fr-CA' ? 'Partenaire sans nom' : 'Unnamed Partner');
    const statusLabel = x.status[p.status ?? ''] ?? p.status ?? '—';
    return <button key={p.id} type="button" class={compact ? 'pd-card pd-featured' : 'pd-card'} onClick={() => setSelectedPartner(p.id)} aria-label={`${partnerName}: ${x.open}`}>
      <span class="pd-card-top"><span class="pd-avatar" aria-hidden="true">{initials(partnerName)}</span><span class={`pt-pill ${p.status === 'complete' || p.status === 'approved' ? 'ok' : ''}`}>{statusLabel}</span></span>
      <span class="pd-name">{partnerName}</span>
      <span class="pd-parent">{p.parent || (locale === 'fr-CA' ? 'Partenaire' : 'Partner')}</span>
      <span class="pd-bottom"><small>{steps.length ? `${done}/${steps.length} ${x.steps}` : (locale === 'fr-CA' ? 'Dossier du partenaire' : 'Partner profile')}</small><span aria-hidden="true">↗</span></span>
    </button>;
  };
  if (selectedPartner) return <PartnerProfile360 call={call} locale={locale} partnerId={selectedPartner} headOffice={headOffice} back={() => setSelectedPartner(null)} openCompliance={() => go('compliance', selectedPartner)} openCarrierDashboard={() => go('compliance')} />;
  return <div class="home pd-directory">
    <div class="hwelcome"><div><h2 style={{ margin: 0 }}>{x.title}</h2><span class="muted">{x.companies}</span></div></div>
    <div class="pd-stats" aria-label={locale === 'fr-CA' ? 'Résumé du réseau' : 'Network summary'}>
      <div class="hcard"><small>{locale === 'fr-CA' ? 'Partenaires visibles' : 'Visible partners'}</small><strong>{total}</strong></div>
      <div class="hcard"><small>{locale === 'fr-CA' ? 'Dossiers complets' : 'Complete profiles'}</small><strong>{complete}</strong></div>
      <div class="hcard"><small>{locale === 'fr-CA' ? 'À examiner' : 'Needs review'}</small><strong>{total - complete}</strong></div>
    </div>
    {featuredRows.length > 0 && <section class="hcard pd-feature-section" aria-label={locale === 'fr-CA' ? 'Partenaires en vedette' : 'Featured partners'}>
      <div class="pd-heading"><div><h3>{locale === 'fr-CA' ? 'Partenaires en vedette' : 'Featured partners'}</h3><small class="muted">{locale === 'fr-CA' ? 'Dossiers complets ou approuvés' : 'Complete or approved profiles'}</small></div><div class="pd-arrows">
        <button type="button" disabled={featuredStart === 0} onClick={() => setFeatured(n => Math.max(0, n - 1))} aria-label="Previous partners">‹</button>
        <button type="button" disabled={featuredStart >= featuredRows.length - 1} onClick={() => setFeatured(n => Math.min(featuredRows.length - 1, n + 1))} aria-label="Next partners">›</button>
      </div></div>
      <div class="pd-carousel" role="region" aria-label="Partner carousel">{featuredRows.slice(featuredStart, featuredStart + 3).map(p => card(p, true))}</div>
    </section>}
    <section class="hcard">
      <div class="pd-heading"><h3>{locale === 'fr-CA' ? 'Tous les partenaires' : 'All partners'}</h3><span class="muted">{shown.length} {locale === 'fr-CA' ? 'résultats' : 'results'}</span></div>
      <div class="pd-tools">
        <input type="search" placeholder={x.search} aria-label={x.search} value={q} onInput={e => { setQ(e.currentTarget.value); setPage(0); }} class="pt-search" />
        <select aria-label={locale === 'fr-CA' ? 'Filtrer par statut' : 'Filter by status'} value={status} onChange={e => { setStatus(e.currentTarget.value); setPage(0); }}>
          <option value="all">{locale === 'fr-CA' ? 'Tous les statuts' : 'All statuses'}</option><option value="attention">{locale === 'fr-CA' ? 'À examiner' : 'Needs review'}</option>
          <option value="complete">{x.status.complete}</option><option value="approved">{x.status.approved}</option><option value="pending">{x.status.pending}</option><option value="incomplete">{x.status.incomplete}</option><option value="frozen">{x.status.frozen}</option>
        </select>
        <div class="pd-arrows"><button type="button" aria-pressed={view === 'grid'} onClick={() => setView('grid')} aria-label="Grid view">▦</button><button type="button" aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label="List view">☷</button></div>
      </div>
      {rows === null ? <p class="muted">{x.loading}</p> : shown.length === 0 ? <p class="muted">{x.noCompanies}</p> : <>
        <div class={view === 'grid' ? 'pd-grid' : 'pd-list'}>{shown.slice(safePage * perPage, (safePage + 1) * perPage).map(p => card(p))}</div>
        {pages > 1 && <div class="pd-pagination"><button type="button" disabled={safePage === 0} onClick={() => setPage(n => Math.max(0, n - 1))}>‹</button><span>{safePage + 1} / {pages}</span><button type="button" disabled={safePage >= pages - 1} onClick={() => setPage(n => Math.min(pages - 1, n + 1))}>›</button></div>}
      </>}
    </section>
  </div>;
}

function groupBy<T>(items: T[], key: (item: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const it of items) (out[key(it)] ??= []).push(it);
  return out;
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
          Object.entries(groupBy(members ?? [], (m) => m.branch || '—')).map(([branch, list]) => (
            <section key={branch}>
              <h4 style={{ margin: '12px 0 6px' }}>{branch} <small class="muted">· {list.length}</small></h4>
              <ul class="pt-list">
                {list.map((m) => (
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
            </section>
          ))
        )}
      </div>
    </div>
  );
}
