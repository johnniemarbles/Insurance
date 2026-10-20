// Families, Gate D screens: one email per family (with a preview of each person's facts and who is skipped and why),
// the family import (a dry run lists every problem before anything is written), and the family timeline.
// Shown only when the server has FAMILIES_PRODUCTIVITY_ENABLED on: a 404 from the first call hides everything here.
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import type { Call } from './families.tsx';

const L = {
  en: {
    email: 'Email families', importT: 'Import families', timeline: 'Timeline', show: 'Show timeline', hide: 'Hide timeline', close: 'Close', cancel: 'Cancel', loading: 'Loading…',
    pick: 'Families', all: 'All', none: 'None', subject: 'Subject', body: 'Message', name: 'Name of this send (only you see it)', create: 'Create the send', created: 'Created. Start it from Mail merges, where you can check it once more.',
    tokens: 'You can use', tokensHelp: 'Each person sees only their own name, the family name and salutation, and policies they own. Another member\'s policies never appear.',
    preview: 'Preview', previewFor: 'Preview for', facts: 'Facts in this message', noOne: 'Nobody in this family can receive it.',
    who: (n: number, f: number) => `${n} ${n === 1 ? 'person' : 'people'} in ${f} ${f === 1 ? 'family' : 'families'}`, notYours: (n: number) => `${n} you can see but do not serve: not included`,
    reasons: { no_email: 'no email', opted_out: 'opted out', deceased: 'deceased', minor: 'under the age of majority', duplicate: 'same email as someone else', no_head: 'no Head' } as Record<string, string>,
    skipped: 'Skipped', headOnly: 'Head only', eachAdult: 'Each adult',
    importHelp: 'Upload a CSV with one row per person. Rows with the same family name become one family with exactly one Head. Existing clients are linked only by client_id or exact email, and their details are never changed.',
    template: 'Download a template', file: 'CSV file', check: 'Check the file', importNow: 'Import', checked: (r: number, e: number) => `${r} rows · ${e === 0 ? 'no problems' : `${e} ${e === 1 ? 'problem' : 'problems'}`}`,
    plan: (c: number, l: number, f: number, j: number) => `Will create ${c} clients, link ${l} existing, create ${f} families, add to ${j} existing`,
    fixFirst: 'Nothing is written until every row passes. Fix the file and check it again.', done: 'Imported.', unknownCols: 'Columns not used', line: 'Line', person: 'Person', problems: 'Problems', notes: 'Notes',
    actions: { create_client: 'New client', link_client: 'Existing client' } as Record<string, string>,
    kinds: {
      family_created: 'Family created', family_archived: 'Family archived', member_joined: 'Joined', member_left: 'Left', policy_role_added: 'Added to a policy', policy_role_ended: 'Removed from a policy',
      coverage_assessed: 'Coverage recorded', life_event: 'Life event', consent_given: 'Consent given', consent_withdrawn: 'Consent withdrawn', authority_recorded: 'Authority recorded',
      authority_verified: 'Authority verified', authority_rejected: 'Authority rejected', authority_ended: 'Authority ended', family_email_sent: 'Family email sent',
    } as Record<string, string>,
  },
  'fr-CA': {
    email: 'Écrire aux familles', importT: 'Importer des familles', timeline: 'Historique', show: 'Afficher l’historique', hide: 'Masquer l’historique', close: 'Fermer', cancel: 'Annuler', loading: 'Chargement…',
    pick: 'Familles', all: 'Toutes', none: 'Aucune', subject: 'Objet', body: 'Message', name: 'Nom de cet envoi (vous seul le voyez)', create: 'Créer l’envoi', created: 'Créé. Lancez-le depuis Publipostages, où vous pouvez le vérifier une dernière fois.',
    tokens: 'Vous pouvez utiliser', tokensHelp: 'Chaque personne ne voit que son nom, le nom et la formule d’appel de la famille, et les polices dont elle est titulaire. Les polices d’un autre membre n’apparaissent jamais.',
    preview: 'Aperçu', previewFor: 'Aperçu pour', facts: 'Renseignements dans ce message', noOne: 'Personne dans cette famille ne peut le recevoir.',
    who: (n: number, f: number) => `${n} ${n === 1 ? 'personne' : 'personnes'} dans ${f} ${f === 1 ? 'famille' : 'familles'}`, notYours: (n: number) => `${n} que vous voyez sans les servir : non incluses`,
    reasons: { no_email: 'pas de courriel', opted_out: 'désabonné', deceased: 'décédé', minor: 'mineur', duplicate: 'même courriel qu’une autre personne', no_head: 'pas de chef de famille' } as Record<string, string>,
    skipped: 'Exclus', headOnly: 'Chef de famille seulement', eachAdult: 'Chaque adulte',
    importHelp: 'Téléversez un CSV avec une ligne par personne. Les lignes portant le même nom de famille forment une famille avec un seul chef. Les clients existants ne sont liés que par client_id ou courriel exact, et leurs renseignements ne sont jamais modifiés.',
    template: 'Télécharger un modèle', file: 'Fichier CSV', check: 'Vérifier le fichier', importNow: 'Importer', checked: (r: number, e: number) => `${r} lignes · ${e === 0 ? 'aucun problème' : `${e} problème${e === 1 ? '' : 's'}`}`,
    plan: (c: number, l: number, f: number, j: number) => `Créera ${c} clients, liera ${l} clients existants, créera ${f} familles, ajoutera à ${j} familles existantes`,
    fixFirst: 'Rien n’est écrit tant que toutes les lignes ne sont pas valides. Corrigez le fichier et vérifiez-le de nouveau.', done: 'Importé.', unknownCols: 'Colonnes non utilisées', line: 'Ligne', person: 'Personne', problems: 'Problèmes', notes: 'Remarques',
    actions: { create_client: 'Nouveau client', link_client: 'Client existant' } as Record<string, string>,
    kinds: {
      family_created: 'Famille créée', family_archived: 'Famille archivée', member_joined: 'Arrivée', member_left: 'Départ', policy_role_added: 'Ajouté à une police', policy_role_ended: 'Retiré d’une police',
      coverage_assessed: 'Couverture inscrite', life_event: 'Événement de vie', consent_given: 'Consentement donné', consent_withdrawn: 'Consentement retiré', authority_recorded: 'Autorité inscrite',
      authority_verified: 'Autorité vérifiée', authority_rejected: 'Autorité refusée', authority_ended: 'Autorité terminée', family_email_sent: 'Courriel familial envoyé',
    } as Record<string, string>,
  },
};
const S = (l: Locale) => L[l] ?? L.en;
const msg = (e: unknown) => (e as Error).message;
const TOKENS = ['salutation', 'familyName', 'firstName', 'name', 'myPolicies', 'nextRenewal', 'myName', 'company', 'unsubscribe'];
const TEMPLATE = 'family,role,full_name,email,phone,date_of_birth,preferred_language,client_id,family_id,same_name_ok\nDhillon family,head,Manpreet Dhillon,manpreet@example.com,604-555-1000,1979-05-01,pa,,,\nDhillon family,spouse,Kiran Dhillon,kiran@example.com,,1981-03-01,,,,\n';

/** Whether Gate D is on. */
export function useFamilyToolsOn(call: Call): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => { call('GET', '/v1/families/imports').then(() => setOn(true), () => setOn(false)); }, [call]);
  return on;
}

interface Fam { id: string; displayName: string; memberCount: number; headName: string | null }
interface Plan { familyId: string; familyName: string; canSend: boolean; recipients: { contactId: string; name: string | null; email: string }[]; skipped: { name: string | null; reason: string }[] }

/** One email per family: pick families, write once, see each person's version and who is skipped. */
export function FamilyEmail({ call, locale, onClose, onCreated }: { call: Call; locale: Locale; onClose: () => void; onCreated: (mergeId: string) => void }) {
  const x = S(locale);
  const [fams, setFams] = useState<Fam[] | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [plan, setPlan] = useState<{ families: Plan[]; totals: { families: number; recipients: number; notYours: number } } | null>(null);
  const [subject, setSubject] = useState('Your annual review, {{familyName}}');
  const [body, setBody] = useState('Dear {{salutation}},\n\nIt is time for your annual review. The policies you hold with us:\n{{myPolicies}}\n\nReply to this email to choose a time.\n\n{{myName}}\n{{company}}\n\n{{unsubscribe}}');
  const [name, setName] = useState('');
  const [pv, setPv] = useState<{ to: { name: string | null; email: string } | null; subject: string; html: string; facts: { key: string }[]; family: Plan } | null>(null);
  const [pvFor, setPvFor] = useState<{ familyId: string; contactId?: string } | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { call('GET', '/v1/families?limit=200').then((r) => setFams(r.families), (e) => setErr(msg(e))); }, [call]);
  useEffect(() => {
    if (!sel.length) { setPlan(null); return; }
    const h = setTimeout(() => { call('POST', '/v1/family-merges/plan', { familyIds: sel }).then(setPlan, (e) => setErr(msg(e))); }, 250);
    return () => clearTimeout(h);
  }, [call, sel]);
  useEffect(() => {
    const target = pvFor ?? (sel[0] ? { familyId: sel[0] } : null);
    if (!target || !subject.trim() || !body.trim()) { setPv(null); return; }
    const h = setTimeout(() => { call('POST', '/v1/family-merges/preview', { subject, body, ...target }).then(setPv, () => setPv(null)); }, 350);
    return () => clearTimeout(h);
  }, [call, subject, body, pvFor, sel]);
  const toggle = (id: string) => setSel(sel.includes(id) ? sel.filter((s) => s !== id) : [...sel, id]);
  const create = async () => {
    setErr('');
    try { const r = await call('POST', '/v1/family-merges', { name: name.trim() || subject.replace(/\{\{[^}]*\}\}/g, '').replace(/[\s,.:;-]+$/, '').trim().slice(0, 60) || 'Family email', subject: subject.trim(), body, familyIds: sel }); onCreated(r.id); } catch (e) { setErr(msg(e)); }
  };
  return (
    <aside tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.email} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <h2>{x.email}</h2>
      {err && <p class="err" role="alert">{err}</p>}
      <fieldset style={{ border: 0, padding: 0 }}>
        <legend style={{ fontWeight: 600 }}>{x.pick} <button type="button" class="linkbtn" onClick={() => setSel((fams ?? []).map((f) => f.id))}>{x.all}</button> · <button type="button" class="linkbtn" onClick={() => setSel([])}>{x.none}</button></legend>
        {!fams ? <p class="muted">{x.loading}</p> : (
          <div style={{ maxHeight: '160px', overflow: 'auto', border: '1px solid var(--line)', borderRadius: '8px', padding: '6px 10px' }}>
            {fams.map((f) => <label key={f.id} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400, margin: '2px 0', color: 'var(--ink)' }}><input type="checkbox" style={{ width: 'auto', margin: 0, minHeight: 0 }} checked={sel.includes(f.id)} onChange={() => toggle(f.id)} /><span>{f.displayName} <span class="muted">· {f.headName ?? '—'} · {f.memberCount}</span></span></label>)}
          </div>
        )}
      </fieldset>
      {plan && (
        <div class="hcard" role="status" style={{ marginTop: '8px' }}>
          <strong>{x.who(plan.totals.recipients, plan.families.filter((f) => f.canSend).length)}</strong>
          {plan.totals.notYours > 0 && <div class="muted" style={{ fontSize: '12.5px' }}>{x.notYours(plan.totals.notYours)}</div>}
          <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '12.5px' }}>{plan.families.filter((f) => f.canSend).map((f) => (
            <li key={f.familyId}>{f.familyName}: {f.recipients.length ? f.recipients.map((r) => <button key={r.contactId} type="button" class="linkbtn" style={{ marginRight: '6px' }} onClick={() => setPvFor({ familyId: f.familyId, contactId: r.contactId })}>{r.name ?? r.email}</button>) : <span class="muted">{x.noOne}</span>}
              {f.skipped.length > 0 && <span class="muted"> · {x.skipped}: {f.skipped.map((s) => `${s.name ?? '—'} (${x.reasons[s.reason] ?? s.reason})`).join(', ')}</span>}</li>
          ))}</ul>
        </div>
      )}
      <label>{x.name}</label><input aria-label={x.name} maxLength={120} value={name} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      <label>{x.subject}</label><input aria-label={x.subject} maxLength={300} value={subject} onInput={(e) => setSubject((e.target as HTMLInputElement).value)} />
      <label>{x.body}</label><textarea aria-label={x.body} rows={9} value={body} onInput={(e) => setBody((e.target as HTMLTextAreaElement).value)} />
      <p class="muted" style={{ fontSize: '12.5px', margin: '4px 0 0' }}>{x.tokens}: {TOKENS.map((t) => `{{${t}}}`).join(' ')}. {x.tokensHelp}</p>
      {pv?.to && (
        <section aria-label={x.preview} class="hcard" style={{ marginTop: '10px' }}>
          <div class="muted" style={{ fontSize: '12.5px' }}>{x.previewFor} {pv.to.name ?? pv.to.email} &lt;{pv.to.email}&gt; · {pv.family.familyName}</div>
          <strong>{pv.subject}</strong>
          <div style={{ marginTop: '6px', fontSize: '13px' }} dangerouslySetInnerHTML={{ __html: pv.html }} />
          <div class="muted" style={{ fontSize: '12px', marginTop: '6px' }}>{x.facts}: {pv.facts.map((f) => f.key).join(', ') || '—'}</div>
        </section>
      )}
      <div class="actions"><button type="button" class="btn" disabled={!plan?.totals.recipients || !subject.trim() || !body.trim()} onClick={() => void create()}>{x.create}</button><button type="button" class="btn quiet" onClick={onClose}>{x.cancel}</button></div>
    </aside>
  );
}

interface Report { dryRun: boolean; committed: boolean; summary: { rows: number; rowsWithErrors: number; errors: number; clientsToCreate: number; clientsToLink: number; familiesToCreate: number; familiesToJoin: number }; rows: { line: number; family: string; role: string | null; person: string; action: string | null; errors: string[]; notes: string[] }[]; unknownColumns: string[] }

/** Family import: check first (nothing written), then import only when every row passes. */
export function FamilyImport({ call, locale, onClose, onDone }: { call: Call; locale: Locale; onClose: () => void; onDone: () => void }) {
  const x = S(locale);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (dryRun: boolean) => {
    setErr(''); setBusy(true);
    try { const r = await call('POST', '/v1/families/import', { csv, dryRun, ...(fileName ? { fileName } : {}) }); setRep(r); if (r.committed) onDone(); }
    catch (e) {
      // A commit refused because the file no longer passes (someone changed a family meanwhile): show the fresh check.
      if (!dryRun && (e as { status?: number }).status === 422) { try { setRep(await call('POST', '/v1/families/import', { csv, dryRun: true })); } catch (e2) { setErr(msg(e2)); } }
      else setErr(msg(e));
    }
    finally { setBusy(false); }
  };
  const ok = rep && rep.summary.errors === 0;
  return (
    <aside tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.importT} onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <h2>{x.importT}</h2>
      <p class="muted">{x.importHelp}</p>
      <p><a href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`} download="families-template.csv">{x.template}</a></p>
      <label>{x.file}</label>
      <input aria-label={x.file} type="file" accept=".csv,text/csv" onChange={async (e) => { const f = (e.target as HTMLInputElement).files?.[0]; if (!f) return; setFileName(f.name); setCsv(await f.text()); setRep(null); }} />
      {err && <p class="err" role="alert">{err}</p>}
      {rep && (
        <section aria-label={x.check} class="hcard" style={{ marginTop: '10px', borderColor: rep.committed || ok ? 'var(--ok)' : 'var(--warn)' }} role="status">
          <strong>{rep.committed ? x.done : x.checked(rep.summary.rows, rep.summary.errors)}</strong>
          <div style={{ fontSize: '12.5px' }}>{x.plan(rep.summary.clientsToCreate, rep.summary.clientsToLink, rep.summary.familiesToCreate, rep.summary.familiesToJoin)}</div>
          {!ok && <div class="muted" style={{ fontSize: '12.5px' }}>{x.fixFirst}</div>}
          {rep.unknownColumns.length > 0 && <div class="muted" style={{ fontSize: '12.5px' }}>{x.unknownCols}: {rep.unknownColumns.join(', ')}</div>}
          <table style={{ width: '100%', fontSize: '12.5px', marginTop: '6px', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
            <thead><tr><th style={{ textAlign: 'left', width: '9%' }}>{x.line}</th><th style={{ textAlign: 'left', width: '36%' }}>{x.person}</th><th style={{ textAlign: 'left' }}>{x.problems}</th></tr></thead>
            <tbody>{rep.rows.map((r) => (
              <tr key={r.line} style={{ borderTop: '1px solid var(--line)', verticalAlign: 'top' }}>
                <td style={{ padding: '4px' }}>{r.line}</td>
                <td style={{ padding: '4px', whiteSpace: 'normal' }}><strong>{r.person}</strong><div class="muted">{r.family}{r.action ? ` · ${x.actions[r.action]}` : ''}</div></td>
                <td style={{ padding: '4px', whiteSpace: 'normal' }}>{r.errors.length ? <ul class="err" style={{ margin: 0, paddingLeft: '16px' }}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : '✓'}{r.notes.length > 0 && <div class="muted">{r.notes.join(' · ')}</div>}</td>
              </tr>
            ))}</tbody>
          </table>
        </section>
      )}
      <div class="actions">
        <button type="button" class="btn quiet" disabled={!csv || busy} onClick={() => void go(true)}>{x.check}</button>
        <button type="button" class="btn" disabled={!ok || !!rep?.committed || busy} onClick={() => void go(false)}>{x.importNow}</button>
        <button type="button" class="btn quiet" onClick={onClose}>{x.close}</button>
      </div>
    </aside>
  );
}

/** The family's history under the viewer's access, newest first. */
export function FamilyTimeline({ call, locale, familyId }: { call: Call; locale: Locale; familyId: string }) {
  const x = S(locale);
  const [open, setOpen] = useState(false);
  const [ev, setEv] = useState<{ at: string; kind: string; name: string | null; detail: Record<string, any> }[] | null>(null);
  const [off, setOff] = useState(false);
  const load = useCallback(() => call('GET', `/v1/families/${familyId}/timeline?limit=100`).then((r) => setEv(r.events), (e) => { if ((e as { status?: number }).status === 404) setOff(true); }), [call, familyId]);
  useEffect(() => { void load(); }, [load]);
  if (off || !ev) return null;
  const when = (iso: string) => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const detail = (d: Record<string, any>) => [d.role, d.policy, d.reason, d.event, d.purpose, d.authority, d.line && `${d.line}: ${d.state}`, d.subject].filter(Boolean).join(' · ').replace(/_/g, ' ');
  return (
    <section aria-label={x.timeline} style={{ marginTop: '14px' }}>
      <button type="button" class="linkbtn" onClick={() => setOpen(!open)}>{open ? x.hide : x.show} ({ev.length})</button>
      {open && <ol class="maplist" style={{ listStyle: 'none', paddingLeft: 0 }}>{ev.map((e, i) => (
        <li key={i} style={{ fontSize: '13px' }}><span class="muted">{when(e.at)}</span> · <strong>{x.kinds[e.kind] ?? e.kind}</strong>{e.name ? ` · ${e.name}` : ''}{detail(e.detail) ? <span class="muted"> · {detail(e.detail)}</span> : null}</li>
      ))}</ol>}
    </section>
  );
}
