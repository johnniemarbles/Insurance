import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const K = {
  en: {
    my: 'My CE', team: 'Team CE', officer: 'Compliance', courses: 'Courses',
    title: 'Continuing education', intro: 'Your hours against what your regulator asks for. Hours from PII courses are added for you. Add courses you took elsewhere, with proof.',
    setup: 'Which licence are you held to?', regulator: 'Regulator', licClass: 'Licence class', licNo: 'Licence number (optional)', since: 'First licensed on (optional)', termStart: 'Your current CE term started on (the day after your licence last expired)', saveLic: 'Save licence', changeLic: 'Change',
    term: 'Term', hours: 'hours', of: 'of', daysLeft: (n: number) => (n < 0 ? `${-n} days past the end` : `${n} days left`), needs: 'Still needed', counted: 'Counted',
    state: { met: 'Complete', on_track: 'On track', at_risk: 'At risk', overdue: 'Overdue', exempt: 'Exempt (new licensee)' } as Record<string, string>,
    cat: { technical: 'Technical', management: 'Management', ethics: 'Ethics', professional_development: 'Professional development', general: 'General', annuity: 'Annuity training' } as Record<string, string>,
    annTitle: 'Annuity training', annInitial: (h: string, n: number) => `Before selling annuities: ${h} of ${n} hours`, annDone: 'Done', annRenew: (h: string, n: number, end: string) => `This term: ${h} of ${n} hours, due by ${end}`, annBlocked: 'Annuity deals stay blocked until this is done.',
    add: 'Add a course taken elsewhere', addTitle: 'Course title', provider: 'Provider', category: 'Category', hrs: 'Hours', date: 'Completed on', proof: 'Proof (PDF, PNG or JPEG, up to 5 MB)', addBtn: 'Add to my record', added: 'Added. Your compliance officer can now review it.',
    ledger: 'My CE record', none: 'Nothing recorded this term yet.', source: { course: 'PII course', external: 'Added by me' } as Record<string, string>,
    status: { recorded: 'Recorded', verified: 'Verified', rejected: 'Not counted' } as Record<string, string>,
    download: 'Download proof', withdraw: 'Withdraw', withdrawn: 'Withdrawn', keep: (d: string) => `Kept until ${d} by law`, asOf: (d: string) => `Rules as of ${d}`, source1: 'Regulator page', confirm: 'Confirm with your regulator. These rules are our reading of their published requirements.',
    retention: 'Records can not be changed or deleted until the date shown.',
    people: 'People', company: 'Company', person: 'Person', unverified: 'To review', exportCsv: 'Download regulator CSV', all: 'All', export: 'Export for', toReview: 'Outside courses to review',
    verify: 'Verify', reject: 'Do not count', reason: 'Reason (optional)', noPeople: 'No one has set up a licence yet.', reviewed: 'Done',
    officerHead: 'CE across the country', ofCompanies: 'Companies', met: 'Complete', risk: 'At risk', over: 'Overdue',
    ceCourse: 'Counts as continuing education', ceNo: 'Not CE', ceNote: 'Counts only if the regulator accepts the course. Completing it adds these hours to each learner’s record.', ceSave: 'Save',
    aiQuiz: 'Draft questions with AI', aiLesson: 'Draft with AI', aiNote: 'AI draft. Check every answer and fact before you save.', aiBusy: 'Drafting…', aiTopic: 'What should this lesson cover?',
    certOpen: 'Open certificate', noPacks: 'No regulators are set up for your country yet. Your compliance officer will add them.',
  },
  'fr-CA': {
    my: 'Ma FC', team: 'FC de l’équipe', officer: 'Conformité', courses: 'Cours',
    title: 'Formation continue', intro: 'Vos heures par rapport aux exigences de votre organisme de réglementation. Les heures des cours PII sont ajoutées automatiquement. Ajoutez les cours suivis ailleurs, avec preuve.',
    setup: 'À quel permis êtes-vous assujetti?', regulator: 'Organisme', licClass: 'Catégorie de permis', licNo: 'Numéro de permis (facultatif)', since: 'Premier permis le (facultatif)', termStart: 'Début de votre période de FC actuelle (lendemain de la dernière expiration du permis)', saveLic: 'Enregistrer le permis', changeLic: 'Modifier',
    term: 'Période', hours: 'heures', of: 'sur', daysLeft: (n: number) => (n < 0 ? `${-n} jours après la fin` : `${n} jours restants`), needs: 'Encore requis', counted: 'Comptées',
    state: { met: 'Complété', on_track: 'En bonne voie', at_risk: 'À risque', overdue: 'En retard', exempt: 'Exempté (nouveau titulaire)' } as Record<string, string>,
    cat: { technical: 'Technique', management: 'Gestion', ethics: 'Déontologie', professional_development: 'Perfectionnement professionnel', general: 'Général', annuity: 'Formation sur les rentes' } as Record<string, string>,
    annTitle: 'Formation sur les rentes', annInitial: (h: string, n: number) => `Avant de vendre des rentes : ${h} sur ${n} heures`, annDone: 'Fait', annRenew: (h: string, n: number, end: string) => `Cette période : ${h} sur ${n} heures, d’ici le ${end}`, annBlocked: 'Les affaires de rentes restent bloquées tant que ce n’est pas fait.',
    add: 'Ajouter un cours suivi ailleurs', addTitle: 'Titre du cours', provider: 'Fournisseur', category: 'Catégorie', hrs: 'Heures', date: 'Terminé le', proof: 'Preuve (PDF, PNG ou JPEG, max 5 Mo)', addBtn: 'Ajouter à mon dossier', added: 'Ajouté. Votre responsable de la conformité peut maintenant le vérifier.',
    ledger: 'Mon dossier de FC', none: 'Rien d’enregistré pour cette période.', source: { course: 'Cours PII', external: 'Ajouté par moi' } as Record<string, string>,
    status: { recorded: 'Enregistré', verified: 'Vérifié', rejected: 'Non compté' } as Record<string, string>,
    download: 'Télécharger la preuve', withdraw: 'Retirer', withdrawn: 'Retiré', keep: (d: string) => `Conservé jusqu’au ${d} selon la loi`, asOf: (d: string) => `Règles en date du ${d}`, source1: 'Page de l’organisme', confirm: 'Confirmez auprès de votre organisme. Ces règles sont notre lecture de leurs exigences publiées.',
    retention: 'Les dossiers ne peuvent être ni modifiés ni supprimés avant la date indiquée.',
    people: 'Personnes', company: 'Entreprise', person: 'Personne', unverified: 'À vérifier', exportCsv: 'Télécharger le CSV pour l’organisme', all: 'Tous', export: 'Exporter pour', toReview: 'Cours externes à vérifier',
    verify: 'Vérifier', reject: 'Ne pas compter', reason: 'Raison (facultatif)', noPeople: 'Personne n’a encore configuré de permis.', reviewed: 'Fait',
    ofCompanies: 'Entreprises',
    officerHead: 'FC dans tout le pays', met: 'Complété', risk: 'À risque', over: 'En retard',
    ceCourse: 'Compte comme formation continue', ceNo: 'Pas de FC', ceNote: 'Ne compte que si l’organisme accepte le cours. Le terminer ajoute ces heures au dossier de chaque apprenant.', ceSave: 'Enregistrer',
    aiQuiz: 'Rédiger des questions avec l’IA', aiLesson: 'Rédiger avec l’IA', aiNote: 'Brouillon IA. Vérifiez chaque réponse et chaque fait avant d’enregistrer.', aiBusy: 'Rédaction…', aiTopic: 'Que doit couvrir cette leçon?',
    certOpen: 'Ouvrir l’attestation', noPacks: 'Aucun organisme n’est encore configuré pour votre pays. Votre responsable de la conformité les ajoutera.',
  },
};
export type CeStrings = (typeof K)['en'];
export const ceStrings = (l: Locale): CeStrings => (K[l] ?? K.en) as CeStrings;

export function saveFile(name: string, mime: string, base64: string) {
  const bin = atob(base64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([u], { type: mime })); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
}
const fileToBase64 = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(new Error('Could not read the file')); r.readAsDataURL(f); });
const hs = (n: number) => (Math.round(n * 10) / 10).toString();

interface Cls { key: string; label: string; label_fr: string; total: number }
interface Pack { code: string; name: string; nameFr: string; sourceUrl: string; classes: Cls[]; retentionNote: string; notes: string; notesFr: string; asOf: string; perLicenceTerm?: boolean }
interface Evaluation { state: string; required: number; counted: number; remaining: number; missing: Record<string, number>; termStart: string; termEnd: string; daysLeft: number }
const packName = (p: Pack | undefined, l: Locale) => (p ? (l === 'fr-CA' ? p.nameFr : p.name) : '');
const clsName = (c: Cls | undefined, l: Locale) => (c ? (l === 'fr-CA' ? c.label_fr : c.label) : '');
const missingText = (k: CeStrings, m: Record<string, number>) => Object.entries(m).map(([c, h]) => `${hs(h)} ${k.cat[c] ?? c}`).join(', ');

function Status({ e, k }: { e: Evaluation; k: CeStrings }) {
  const pct = e.required ? Math.min(100, Math.round((e.counted / e.required) * 100)) : 0;
  return (
    <div>
      <div class="cstat"><span class="cbar" role="img" aria-label={`${pct}%`} style={{ width: '160px' }}><i style={{ width: `${pct}%`, background: e.state === 'overdue' ? 'var(--bad,#b3261e)' : e.state === 'at_risk' ? 'var(--warn,#b36b00)' : 'var(--pri)' }} /></span>
        <b>{hs(e.counted)} {k.of} {e.required} {k.hours}</b><span class={`tag ce-${e.state}`}>{k.state[e.state] ?? e.state}</span></div>
      <small class="muted">{k.term} {e.termStart} → {e.termEnd} · {k.daysLeft(e.daysLeft)}{Object.keys(e.missing).length > 0 && e.state !== 'exempt' ? ` · ${k.needs}: ${missingText(k, e.missing)}` : ''}</small>
    </div>
  );
}

export function MyCe({ call, locale }: { call: Call; locale: Locale }) {
  const k = ceStrings(locale);
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState(''); const [note, setNote] = useState('');
  const [lic, setLic] = useState({ pack: '', cls: '', no: '', since: '', term: '' });
  const [editLic, setEditLic] = useState(false);
  const blank = { packCode: '', title: '', provider: '', category: 'technical', hours: '1', completedOn: new Date().toISOString().slice(0, 10) };
  const [f, setF] = useState(blank); const [file, setFile] = useState<File | null>(null);
  const load = useCallback(() => { call('GET', '/v1/ce/me').then(setD, (e) => setErr((e as Error).message)); }, [call]);
  useEffect(load, [load]);
  if (!d) return <div class="msg">{err || '…'}</div>;
  const packs: Pack[] = d.packs;
  const act = async (fn: () => Promise<unknown>, ok: string) => { setErr(''); setNote(''); try { await fn(); setNote(ok); load(); } catch (e) { setErr((e as Error).message); } };
  const pack = (c: string) => packs.find((p) => p.code === c);
  const hasLic = d.licences.length > 0;
  const licForm = (
    <form class="cform" onSubmit={(e) => { e.preventDefault(); void act(async () => { await call('PUT', '/v1/ce/licences', { packCode: lic.pack, licenceClass: lic.cls, licenceNumber: lic.no || null, licensedSince: lic.since || null, termStart: pack(lic.pack)?.perLicenceTerm ? lic.term || null : null }); setEditLic(false); }, '✓'); }}>
      <label class="fl">{k.regulator}<select class="wide" required value={lic.pack} onChange={(e) => setLic({ ...lic, pack: (e.target as HTMLSelectElement).value, cls: '' })}><option value="">…</option>{packs.map((p) => <option value={p.code}>{packName(p, locale)}</option>)}</select></label>
      <label class="fl">{k.licClass}<select class="wide" required value={lic.cls} onChange={(e) => setLic({ ...lic, cls: (e.target as HTMLSelectElement).value })}><option value="">…</option>{(pack(lic.pack)?.classes ?? []).map((c) => <option value={c.key}>{clsName(c, locale)} ({c.total} {k.hours})</option>)}</select></label>
      <label class="fl">{k.licNo}<input class="wide" value={lic.no} onInput={(e) => setLic({ ...lic, no: (e.target as HTMLInputElement).value })} /></label>
      <label class="fl">{k.since}<input class="wide" type="date" value={lic.since} onInput={(e) => setLic({ ...lic, since: (e.target as HTMLInputElement).value })} /></label>
      {pack(lic.pack)?.perLicenceTerm && <label class="fl">{k.termStart}<input class="wide" type="date" required max={new Date().toISOString().slice(0, 10)} value={lic.term} onInput={(e) => setLic({ ...lic, term: (e.target as HTMLInputElement).value })} /></label>}
      <div><button class="btn" disabled={!lic.pack || !lic.cls}>{k.saveLic}</button></div>
    </form>
  );
  return (
    <div class="tpad">
      <h1>{k.title}</h1><p class="muted">{k.intro}</p>
      {err && <div class="err">{err}</div>}{note && <div class="ok">{note}</div>}
      {packs.length === 0 && <p class="muted">{k.noPacks}</p>}
      {packs.length > 0 && (!hasLic || editLic) && <><h3>{k.setup}</h3>{licForm}</>}
      {d.licences.map((l: any) => {
        const p = pack(l.packCode); const c = p?.classes.find((x) => x.key === l.licenceClass);
        return (
          <div class="ccard" style={{ display: 'block', margin: '12px 0', padding: '12px 14px' }} key={l.id}>
            <div class="erow" style={{ margin: 0 }}><b>{packName(p, locale)}</b><span class="tag">{clsName(c, locale)}</span>{l.licenceNumber && <span class="muted">#{l.licenceNumber}</span>}<span class="spacer" style={{ flex: 1 }} /><button class="btn quiet" onClick={() => { setLic({ pack: l.packCode, cls: l.licenceClass, no: l.licenceNumber ?? '', since: l.licensedSince ?? '', term: l.termAnchor ?? '' }); setEditLic(true); }}>{k.changeLic}</button></div>
            {l.evaluation && <Status e={l.evaluation} k={k} />}
            {(d.annuity ?? []).filter((a: any) => a.packCode === l.packCode).map((a: any) => (
              <div key={a.packCode} style={{ margin: '8px 0' }} aria-label={k.annTitle}>
                <b>{k.annTitle}</b>
                <div>{k.annInitial(hs(a.initialHours), a.initialRequired)} {a.initialDone ? <span class="tag ce-met">{k.annDone}</span> : <span class="tag ce-at_risk">{k.annBlocked}</span>}</div>
                {a.renewalDue && <div>{k.annRenew(hs(a.renewalHours), a.renewalRequired, a.termEnd)} {a.renewalDone && <span class="tag ce-met">{k.annDone}</span>}</div>}
              </div>
            ))}
            <small class="muted">{k.asOf(p?.asOf ?? '')} · <a href={p?.sourceUrl} target="_blank" rel="noopener noreferrer">{k.source1}</a><br />{locale === 'fr-CA' ? p?.notesFr : p?.notes} {k.confirm}</small>
          </div>
        );
      })}

      <h3>{k.add}</h3>
      {hasLic ? (
        <form class="cform" onSubmit={(e) => { e.preventDefault(); void act(async () => { const b: Record<string, unknown> = { ...f, hours: Number(f.hours) }; if (file) { b.filename = file.name; b.dataBase64 = await fileToBase64(file); } await call('POST', '/v1/ce/entries', b); setF({ ...blank, packCode: f.packCode }); setFile(null); }, k.added); }}>
          <label class="fl">{k.regulator}<select class="wide" required value={f.packCode} onChange={(e) => setF({ ...f, packCode: (e.target as HTMLSelectElement).value })}><option value="">…</option>{d.licences.map((l: any) => <option value={l.packCode}>{packName(pack(l.packCode), locale)}</option>)}</select></label>
          <label class="fl">{k.addTitle}<input class="wide" required maxLength={200} value={f.title} onInput={(e) => setF({ ...f, title: (e.target as HTMLInputElement).value })} /></label>
          <label class="fl">{k.provider}<input class="wide" required maxLength={120} value={f.provider} onInput={(e) => setF({ ...f, provider: (e.target as HTMLInputElement).value })} /></label>
          <label class="fl">{k.category}<select class="wide" value={f.category} onChange={(e) => setF({ ...f, category: (e.target as HTMLSelectElement).value })}>{Object.entries(k.cat).map(([c, n]) => <option value={c}>{n}</option>)}</select></label>
          <label class="fl">{k.hrs}<input class="wide" type="number" min="0.5" max="40" step="0.5" required value={f.hours} onInput={(e) => setF({ ...f, hours: (e.target as HTMLInputElement).value })} /></label>
          <label class="fl">{k.date}<input class="wide" type="date" required max={new Date().toISOString().slice(0, 10)} value={f.completedOn} onInput={(e) => setF({ ...f, completedOn: (e.target as HTMLInputElement).value })} /></label>
          <label class="fl">{k.proof}<input class="wide" type="file" accept="application/pdf,image/png,image/jpeg" onChange={(e) => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} /></label>
          <div><button class="btn" disabled={!f.packCode || !f.title.trim() || !f.provider.trim()}>{k.addBtn}</button></div>
        </form>
      ) : <p class="muted">{k.setup}</p>}

      <h3>{k.ledger}</h3>
      {d.entries.length === 0 && <p class="muted">{k.none}</p>}
      {d.entries.length > 0 && (
        <table>
          <thead><tr><th>{k.date}</th><th>{k.addTitle}</th><th>{k.category}</th><th>{k.hrs}</th><th></th></tr></thead>
          <tbody>{d.entries.map((e: any) => (
            <tr key={e.id} style={e.status === 'rejected' ? { opacity: 0.55 } : undefined}>
              <td>{e.completedOn}</td>
              <td>{e.title}<br /><small class="muted">{e.provider} · {k.source[e.source]} · {k.keep(e.retainUntil)}</small>{e.reviewNote && <><br /><small class="muted">“{e.reviewNote}”</small></>}</td>
              <td>{k.cat[e.category] ?? e.category}</td><td>{hs(e.hours)}</td>
              <td><span class={`tag${e.status === 'verified' ? ' ok' : ''}`}>{k.status[e.status]}</span>{' '}
                {e.hasEvidence && <button class="btn quiet" onClick={() => void act(async () => { const r = await call('GET', `/v1/ce/entries/${e.id}/evidence`); saveFile(r.filename, r.mime, r.dataBase64); }, '')}>{k.download}</button>}
                {e.canVoid && <button class="btn quiet" onClick={() => void act(() => call('POST', `/v1/ce/entries/${e.id}/void`), k.withdrawn)}>{k.withdraw}</button>}</td>
            </tr>))}</tbody>
        </table>
      )}
      <p><small class="muted">{k.retention}</small></p>
    </div>
  );
}

function Review({ call, k, items, base, onDone, withCompany }: { call: Call; k: CeStrings; items: any[]; base: string; onDone: () => void; withCompany: boolean }) {
  const [err, setErr] = useState('');
  const go = async (id: string, decision: 'verified' | 'rejected') => {
    let note = '';
    if (decision === 'rejected') { note = prompt(k.reason) ?? ''; }
    try { await call('POST', `${base}/entries/${id}/review`, { decision, note }); onDone(); } catch (e) { setErr((e as Error).message); }
  };
  if (items.length === 0) return null;
  return (
    <>
      <h3>{k.toReview} ({items.length})</h3>
      {err && <div class="err">{err}</div>}
      <table>
        <tbody>{items.map((e) => (
          <tr key={e.id}>
            <td><b>{e.person}</b>{withCompany && <><br /><small class="muted">{e.company}</small></>}</td>
            <td>{e.title}<br /><small class="muted">{e.provider} · {k.cat[e.category]} · {hs(e.hours)} {k.hours} · {e.completedOn}</small></td>
            <td>
              {e.hasEvidence && <button class="btn quiet" onClick={async () => { try { const r = await call('GET', `${base}/entries/${e.id}/evidence`); saveFile(r.filename, r.mime, r.dataBase64); } catch (x) { setErr((x as Error).message); } }}>{k.download}</button>}
              <button class="btn" onClick={() => void go(e.id, 'verified')}>{k.verify}</button>
              <button class="btn quiet" onClick={() => void go(e.id, 'rejected')}>{k.reject}</button>
            </td>
          </tr>))}</tbody>
      </table>
    </>
  );
}

/** One table for a company's managers and for the country's compliance officer (who also sees the company column). */
export function PeopleCe({ call, locale, officer }: { call: Call; locale: Locale; officer: boolean }) {
  const k = ceStrings(locale);
  const base = officer ? '/v1/ho/ce' : '/v1/ce';
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [pack, setPack] = useState('');
  const load = useCallback(() => { call('GET', officer ? '/v1/ho/ce' : '/v1/ce/team').then((r) => { setD(r); setPack((p) => p || r.packs[0]?.code || ''); }, (e) => setErr((e as Error).message)); }, [call, officer]);
  useEffect(load, [load]);
  if (!d) return <div class="msg">{err || '…'}</div>;
  const packs: Pack[] = d.packs;
  const t = d.totals as Record<string, number>;
  const exportCsv = async () => { try { const r = await call('GET', `${officer ? '/v1/ho/ce/export' : '/v1/ce/export'}?pack=${encodeURIComponent(pack)}`); saveFile(r.filename, r.mime, r.dataBase64); } catch (e) { setErr((e as Error).message); } };
  return (
    <div class="tpad">
      <h1>{officer ? k.officerHead : k.team}</h1>
      {err && <div class="err">{err}</div>}
      <div class="kstrip">
        <div class="ktile"><b>{(t.met ?? 0)}</b><span>{k.met}</span></div>
        <div class="ktile"><b>{(t.on_track ?? 0)}</b><span>{k.state.on_track}</span></div>
        <div class={`ktile${t.at_risk ? ' hot' : ''}`}><b>{t.at_risk ?? 0}</b><span>{k.risk}</span></div>
        <div class={`ktile${t.overdue ? ' hot' : ''}`}><b>{t.overdue ?? 0}</b><span>{k.over}</span></div>
      </div>
      <div class="erow">
        <select aria-label={k.export} value={pack} onChange={(e) => setPack((e.target as HTMLSelectElement).value)}>{packs.map((p) => <option value={p.code}>{packName(p, locale)}</option>)}</select>
        <button class="btn" disabled={!pack} onClick={exportCsv}>{k.exportCsv}</button>
      </div>
      <Review call={call} k={k} items={d.toReview ?? []} base={base} onDone={load} withCompany={officer} />
      <h3>{k.people} ({d.people.length})</h3>
      {d.people.length === 0 ? <p class="muted">{k.noPeople}</p> : (
        <table>
          <thead><tr><th>{k.person}</th>{officer && <th>{k.company}</th>}<th>{k.regulator}</th><th>{k.counted}</th><th></th></tr></thead>
          <tbody>{d.people.map((p: any) => (
            <tr key={`${p.userId}${p.packCode}`}>
              <td>{p.name}</td>{officer && <td>{p.company}</td>}<td>{packName(packs.find((x) => x.code === p.packCode), locale)}</td>
              <td>{p.evaluation ? <><span class={`tag ce-${p.evaluation.state}`}>{k.state[p.evaluation.state]}</span> {hs(p.evaluation.counted)}/{p.evaluation.required}{Object.keys(p.evaluation.missing).length && p.evaluation.state !== 'exempt' ? <small class="muted"> · {k.needs}: {missingText(k, p.evaluation.missing)}</small> : null}</> : ''}</td>
              <td>{p.unverified > 0 && <span class="tag">{p.unverified} {k.unverified}</span>}</td>
            </tr>))}</tbody>
        </table>
      )}
      {officer && d.companies?.length > 0 && (
        <>
          <h3>{k.ofCompanies}</h3>
          <table><thead><tr><th>{k.company}</th><th>{k.people}</th><th>{k.met}</th><th>{k.risk}</th><th>{k.over}</th></tr></thead>
            <tbody>{d.companies.map((c: any) => <tr key={c.company}><td>{c.company}</td><td>{c.people}</td><td>{c.met}</td><td>{c.atRisk}</td><td>{c.overdue}</td></tr>)}</tbody></table>
        </>
      )}
    </div>
  );
}

/** Course author: does completing this course count as CE? */
export function CourseCe({ call, locale, courseId, value, onSaved }: { call: Call; locale: Locale; courseId: string; value: { cePack: string | null; ceHours: number | null; ceCategory: string | null }; onSaved: () => void }) {
  const k = ceStrings(locale);
  const [packs, setPacks] = useState<Pack[]>([]);
  const [pack, setPack] = useState(value.cePack ?? ''); const [hours, setHours] = useState(String(value.ceHours ?? 1)); const [cat, setCat] = useState(value.ceCategory ?? 'general');
  const [msg, setMsg] = useState('');
  useEffect(() => { call('GET', '/v1/ce/packs').then((r) => setPacks(r.packs), () => undefined); }, [call]);
  const save = async () => { setMsg(''); try { await call('PATCH', `/v1/courses/${courseId}`, { ce: pack ? { pack, hours: Number(hours), category: cat } : null }); setMsg('✓'); onSaved(); } catch (e) { setMsg((e as Error).message); } };
  return (
    <>
      <h3>{k.ceCourse}</h3>
      <div class="erow">
        <select aria-label={k.regulator} value={pack} onChange={(e) => setPack((e.target as HTMLSelectElement).value)}><option value="">{k.ceNo}</option>{packs.map((p) => <option value={p.code}>{packName(p, locale)}</option>)}</select>
        {pack && <><input aria-label={k.hrs} type="number" min="0.5" max="40" step="0.5" value={hours} style={{ flex: '0 0 80px' }} onInput={(e) => setHours((e.target as HTMLInputElement).value)} />
          <select aria-label={k.category} value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)}>{Object.entries(k.cat).map(([c, n]) => <option value={c}>{n}</option>)}</select></>}
        <button class="btn quiet" onClick={save}>{k.ceSave}</button>
      </div>
      <small class="muted">{k.ceNote}</small>{msg && <small class={msg === '✓' ? 'ok' : 'err'}> {msg}</small>}
    </>
  );
}

/** A strip on Home: where the person stands on CE and what training is waiting. */
export function HomeLearning({ call, locale, go }: { call: Call; locale: Locale; go: (page: string) => void }) {
  const k = ceStrings(locale);
  const fr = locale === 'fr-CA';
  const [ce, setCe] = useState<any>(null);
  const [courses, setCourses] = useState<any[] | null>(null);
  useEffect(() => {
    call('GET', '/v1/ce/me').then(setCe, () => setCe({ licences: [], packs: [] }));
    call('GET', '/v1/my/learning').then((r) => setCourses(r.enrollments), () => setCourses([]));
  }, [call]);
  if (!ce || !courses) return null;
  const open = courses.filter((c) => c.status !== 'completed');
  const lic = ce.licences[0];
  if (!lic && open.length === 0 && ce.packs.length === 0) return null;
  const e = lic?.evaluation;
  const bad = e && (e.state === 'overdue' || e.state === 'at_risk');
  return (
    <button class={`hcard${bad ? ' nudge' : ''}`} style={{ display: 'flex', gap: '14px', alignItems: 'center', textAlign: 'left', width: '100%', margin: '0 0 12px', cursor: 'pointer' }} onClick={() => go('training')} aria-label={k.title}>
      <span style={{ fontSize: '22px' }} aria-hidden="true">🎓</span>
      <span style={{ flex: 1 }}>
        <b>{k.title}</b><br />
        {e ? <small>{hs(e.counted)} {k.of} {e.required} {k.hours} · <b>{k.state[e.state]}</b> · {k.daysLeft(e.daysLeft)}{Object.keys(e.missing).length && e.state !== 'exempt' ? ` · ${k.needs}: ${missingText(k, e.missing)}` : ''}</small>
          : <small>{ce.packs.length ? k.setup : ''}</small>}
        {open.length > 0 && <><br /><small>{fr ? `${open.length} cours à suivre` : `${open.length} course${open.length === 1 ? '' : 's'} to take`}</small></>}
      </span>
      <span class="link">{fr ? 'Ouvrir' : 'Open'} →</span>
    </button>
  );
}
