import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type PartnerFile = {
  node?: { id: string; name: string }; company?: string; country?: string;
  checklist?: { steps?: { id: string; done: boolean; hint?: string }[]; percent?: number };
  items?: { id: string; kind: string; label: string; jurisdiction?: string | null; expiresOn?: string | null }[];
  appointments?: { id: string; carrier: string; status: string }[];
  documents?: { id: string; filename: string; kind: string }[];
  profile?: { legalName?: string | null; status?: string; agreementStatus?: string; agreementSignedOn?: string | null } | null;
};
type Tab = 'overview' | 'compliance' | 'carriers' | 'agreements' | 'documents';
const tabs: { id: Tab; en: string; fr: string }[] = [
  { id: 'overview', en: 'Overview', fr: 'Aperçu' },
  { id: 'compliance', en: 'Compliance', fr: 'Conformité' },
  { id: 'carriers', en: 'Carrier appointments', fr: 'Assureurs' },
  { id: 'agreements', en: 'Agreements', fr: 'Contrats' },
  { id: 'documents', en: 'Documents', fr: 'Documents' },
];
const carriers = ['Industrial Alliance (iA)', 'Manulife', 'Sun Life', 'Canada Life'];
export function PartnerProfile360({ call, locale, partnerId, headOffice, back, openCompliance }: {
  call: Call; locale: Locale; partnerId: string; headOffice: boolean;
  back: () => void; openCompliance: () => void;
}) {
  const fr = locale === 'fr-CA';
  const [file, setFile] = useState<PartnerFile | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    setLoading(true); setFile(null); setError(''); setTab('overview');
    const base = headOffice ? '/v1/ho/partners/' : '/v1/compliance/partners/';
    void call('GET', base + encodeURIComponent(partnerId)).then(result => {
      if (live) { setFile(result as PartnerFile); setLoading(false); }
    }, () => { if (live) { setError(fr ? 'Accès refusé ou dossier indisponible.' : 'Access denied or partner file unavailable.'); setLoading(false); } });
    return () => { live = false; };
  }, [call, partnerId, headOffice, locale]);
  const items = file?.items ?? [];
  const appts = file?.appointments ?? [];
  const docs = file?.documents ?? [];
  const steps = file?.checklist?.steps ?? [];
  return <section class="pd-profile">
    <button type="button" class="pd-back" onClick={back}>← {fr ? 'Répertoire' : 'Partner directory'}</button>
    {loading ? <p role="status">{fr ? 'Chargement…' : 'Loading partner profile…'}</p>
    : error || !file ? <p role="alert">{error || 'Partner unavailable'}</p>
    : <>
      <header class="hcard pd-profile-hero">
        <span class="pd-avatar" aria-hidden="true">{(file.node?.name || '?').slice(0,2).toUpperCase()}</span>
        <div><h2>{file.node?.name || (fr ? 'Partenaire' : 'Partner')}</h2>
          <p class="muted">{file.profile?.legalName || file.company || '—'} · {file.country || '—'}</p></div>
        <button type="button" class="btn primary" onClick={openCompliance}>{fr ? 'Ouvrir le dossier' : 'Open compliance file'} ↗</button>
      </header>
      <nav class="pd-profile-tabs" aria-label={fr ? 'Sections du profil' : 'Profile sections'}>
        {tabs.map(t => <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{fr ? t.fr : t.en}</button>)}
      </nav>
      <div class="hcard pd-profile-body">
        {tab === 'overview' && <>
          <h3>{fr ? 'Aperçu du partenaire' : 'Partner overview'}</h3>
          <div class="pd-profile-facts"><div><small>{fr ? 'Statut du profil' : 'Profile status'}</small><strong>{file.profile?.status || '—'}</strong></div>
          <div><small>{fr ? 'Progression' : 'Checklist progress'}</small><strong>{file.checklist?.percent ?? '—'}{typeof file.checklist?.percent === 'number' ? '%' : ''}</strong></div>
          <div><small>{fr ? 'Contrat' : 'Agreement'}</small><strong>{file.profile?.agreementStatus || '—'}</strong></div>
          <div><small>{fr ? 'Rendez-vous assureurs' : 'Carrier appointments'}</small><strong>{appts.length}</strong></div></div>
        </>}
        {tab === 'compliance' && <>
          <h3>{fr ? 'Exigences et licences' : 'Compliance requirements and licences'}</h3>
          {steps.length === 0 && items.length === 0 && <p class="muted">{fr ? 'Aucune donnée disponible.' : 'No compliance data available.'}</p>}
          {steps.map(s => <div class="pd-profile-line" key={s.id}><span>{s.id}</span><strong>{s.done ? '✓' : '—'}</strong></div>)}
          {items.map(i => <div class="pd-profile-line" key={i.id}><span>{i.label} · {i.jurisdiction || i.kind}</span><small>{i.expiresOn || '—'}</small></div>)}
        </>}
        {tab === 'carriers' && <>
          <h3>{fr ? 'Nominations auprès des assureurs' : 'Carrier appointments'}</h3>
          {carriers.map(name => {
            const a = appts.find(x => (x.carrier || '').toLowerCase().includes(name.toLowerCase()) || (name.includes('iA') && /industrial alliance|ia financial/i.test(x.carrier || '')));
            return <div class="pd-profile-line" key={name}><span>{name}</span><strong>{a?.status || (fr ? 'Non enregistré' : 'Not recorded')}</strong></div>;
          })}
          {appts.filter(a => !carriers.some(name => (a.carrier || '').toLowerCase().includes(name.toLowerCase()))).map(a => <div class="pd-profile-line" key={a.id}><span>{a.carrier || '—'}</span><strong>{a.status || '—'}</strong></div>)}
          <p class="muted">{fr ? 'Une nomination n’est active qu’après vérification officielle.' : 'An appointment is active only after authoritative carrier verification.'}</p>
        </>}
        {tab === 'agreements' && <>
          <h3>{fr ? 'Contrats' : 'Agreements'}</h3>
          <div class="pd-profile-line"><span>{fr ? 'Statut' : 'Status'}</span><strong>{file.profile?.agreementStatus || '—'}</strong></div>
          <div class="pd-profile-line"><span>{fr ? 'Signé le' : 'Signed on'}</span><strong>{file.profile?.agreementSignedOn || '—'}</strong></div>
          <button type="button" class="btn" onClick={openCompliance}>{fr ? 'Voir les preuves de signature' : 'View signature evidence'} ↗</button>
        </>}
        {tab === 'documents' && <>
          <h3>{fr ? 'Documents du dossier' : 'File documents'}</h3>
          {docs.length === 0 ? <p class="muted">{fr ? 'Aucun document disponible.' : 'No documents available.'}</p> : docs.map(d => <div class="pd-profile-line" key={d.id}><span>{d.filename}</span><small>{d.kind}</small></div>)}
          <button type="button" class="btn" onClick={openCompliance}>{fr ? 'Ouvrir le coffre sécurisé' : 'Open secure document file'} ↗</button>
        </>}
      </div>
    </>}
  </section>;
}
