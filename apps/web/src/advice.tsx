import { useVendors } from './vendors.tsx';
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { NeedsForm, RecommendationForm, money, type AdviceForm, type Answers } from './advice-form.tsx';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
interface Adv { id: string; kind: string; title: string; body: string; tier: 'builtin' | 'vendor'; status: 'draft' | 'awaiting_signature' | 'signed'; clientName: string; clientEmail: string | null; contentHash: string | null; signedAt: string | null; signedMethod: string | null; vendorName: string | null; vendorRef: string | null; createdBy: string;
  structured?: boolean; answers?: Answers | null; linkedAdviceId?: string | null; flags?: string[]; validUntil?: string | null; missing?: string[];
  calc?: { totalNeed: number; existing: number; gap: number }; review?: { status: 'pending' | 'passed' | 'needs_action'; reason: string; findings: string | null; reviewer: string | null } | null }
interface Kind { kind: string; tier: string; label: Record<Locale, string>; structured?: boolean }
interface Doc { id: string; name: string }

const T = {
  'en': { tab: 'Advice', h: 'Advice records', help: 'The advice you gave this client, kept as a permanent record. A signed record can never be changed.', none: 'No advice recorded yet.', add: 'New advice record', kind: 'Kind', title: 'Title', body: 'What you advised and why', client: 'Client name', email: 'Client email', save: 'Save draft', cancel: 'Cancel',
    draft: 'Draft', awaiting: 'Waiting for the client’s code', signed: 'Signed', builtin: 'Signed with a one-time code', vendor: 'Needs a certified e-signature vendor', send: 'Send code to client', code: '6-digit code', confirm: 'Confirm signature', sent: 'Code sent. It expires in 15 minutes.', del: 'Remove draft', edit: 'Edit',
    vendorHelp: 'Sign this with your certified e-signature vendor, upload the completed document on the Files tab, then record it here.', vendorPick: 'Vendor', vendorName: 'Vendor name', vendorRef: 'Vendor reference or envelope ID', doc: 'Completed document', record: 'Record vendor signature', by: 'by', via: 'via', adobeSend: 'Send for signature with Adobe', adobeCheck: 'Check Adobe status', adobeSent: 'Sent to the client through Adobe Acrobat Sign.', adobeStatus: 'Adobe says', adobeDone: 'Signed. The signed PDF is filed on this record.', hash: 'Fingerprint', link: 'Send signing link to client', linkMade: 'Signing link ready. Valid for 7 days.', emailedYes: 'It was also emailed to the client.', emailedNo: 'It was not emailed, so share the link yourself.', copy: 'Copy link',
    notes: 'Notes in your own words (optional: a summary is written from the answers)', todo: 'Still to fill in before signing', current: 'Current until', expiredOn: 'Expired on', flags: 'For compliance review', review: { pending: 'Under compliance review', passed: 'Passed compliance review', needs_action: 'Compliance asks for action' }, why: { flagged: 'flagged', new_advisor: 'new advisor', random: 'random sample', requested: 'requested' }, gap: 'Gap', fill: 'Fill in the form' },
  'fr-CA': { tab: 'Conseils', h: 'Dossiers de conseil', help: 'Les conseils donnés à ce client, conservés comme dossier permanent. Un dossier signé ne peut jamais être modifié.', none: 'Aucun conseil consigné.', add: 'Nouveau dossier de conseil', kind: 'Type', title: 'Titre', body: 'Ce que vous avez conseillé et pourquoi', client: 'Nom du client', email: 'Courriel du client', save: 'Enregistrer le brouillon', cancel: 'Annuler',
    draft: 'Brouillon', awaiting: 'En attente du code du client', signed: 'Signé', builtin: 'Signature par code à usage unique', vendor: 'Exige un fournisseur de signature électronique certifié', send: 'Envoyer le code au client', code: 'Code à 6 chiffres', confirm: 'Confirmer la signature', sent: 'Code envoyé. Il expire dans 15 minutes.', del: 'Retirer le brouillon', edit: 'Modifier',
    vendorHelp: 'Faites signer avec votre fournisseur de signature électronique certifié, téléversez le document final dans l’onglet Fichiers, puis consignez-le ici.', vendorPick: 'Fournisseur', vendorName: 'Nom du fournisseur', vendorRef: 'Référence ou ID d’enveloppe', doc: 'Document final', record: 'Consigner la signature du fournisseur', by: 'par', via: 'via', adobeSend: 'Envoyer pour signature avec Adobe', adobeCheck: 'Vérifier l’état chez Adobe', adobeSent: 'Envoyé au client par Adobe Acrobat Sign.', adobeStatus: 'Adobe indique', adobeDone: 'Signé. Le PDF signé est classé au dossier.', hash: 'Empreinte', link: 'Envoyer le lien de signature au client', linkMade: 'Lien de signature prêt. Valide 7 jours.', emailedYes: 'Il a aussi été envoyé par courriel au client.', emailedNo: 'Il n’a pas été envoyé par courriel : transmettez le lien vous-même.', copy: 'Copier le lien',
    notes: 'Notes dans vos mots (facultatif : un résumé est rédigé à partir des réponses)', todo: 'À remplir avant la signature', current: 'Valide jusqu’au', expiredOn: 'Expirée le', flags: 'Pour la revue de conformité', review: { pending: 'En revue de conformité', passed: 'Revue de conformité réussie', needs_action: 'La conformité demande des mesures' }, why: { flagged: 'signalé', new_advisor: 'nouveau conseiller', random: 'échantillon aléatoire', requested: 'demandée' }, gap: 'Écart', fill: 'Remplir le formulaire' },
};
const when = (iso: string, locale: Locale) => new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' });

/** Advice records on a record: draft, sign with a one-time code or record a vendor signature, and keep for good. */
export function AdviceTab({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale];
  const [list, setList] = useState<Adv[]>([]);
  const [kinds, setKinds] = useState<Kind[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [form, setForm] = useState<{ kind: string; title: string; body: string; clientName: string; clientEmail: string; answers: Answers; linkedAdviceId: string; editId?: string } | null>(null);
  const [schema, setSchema] = useState<AdviceForm | null>(null);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [links, setLinks] = useState<Record<string, { url: string; emailed: boolean }>>({});
  const [vend, setVend] = useState<Record<string, { vendorId: string; vendorName: string; vendorRef: string; documentId: string }>>({});
  const { d: vd } = useVendors(call);
  const adobeOn = !!vd?.vendors.find((v) => v.id === 'adobe_sign' && v.connected && v.enabled);
  const vset = (id: string, patch: Partial<{ vendorId: string; vendorName: string; vendorRef: string; documentId: string }>) => setVend({ ...vend, [id]: { vendorId: '', vendorName: '', vendorRef: '', documentId: '', ...vend[id], ...patch } });
  const load = () => Promise.all([call('GET', `/v1/boxes/${boxId}/advice`), call('GET', `/v1/boxes/${boxId}/documents`)]).then(([a, d]) => { setList(a.advice); setKinds(a.kinds); setSchema(a.form ?? null); setDocs(d.documents); }, (e) => setErr((e as Error).message));
  useEffect(() => { void load(); }, [boxId]);
  const go = async (fn: () => Promise<unknown>, msg = '') => { setErr(''); setOk(''); try { await fn(); await load(); setOk(msg); } catch (e) { setErr((e as Error).message); } };
  const label = (k: string) => kinds.find((y) => y.kind === k)?.label[locale] ?? k;
  const structured = (k: string) => !!kinds.find((y) => y.kind === k)?.structured;
  const today = new Date().toISOString().slice(0, 10);
  const needsOptions = list.filter((a) => a.kind === 'needs_analysis' && (a.status === 'signed' ? !a.validUntil || a.validUntil >= today : true))
    .map((a) => ({ id: a.id, title: `${a.title} (${a.clientName})`, signed: a.status === 'signed', gap: a.calc?.gap ?? null, budget: typeof a.answers?.monthlyBudget === 'number' ? (a.answers.monthlyBudget as number) : null }));
  const blank = (kind: string) => ({ kind, title: kind ? label(kind) : '', body: '', clientName: list[0]?.clientName ?? '', clientEmail: list[0]?.clientEmail ?? '', answers: kind === 'needs_analysis' ? { productLine: 'life_health' } : {}, linkedAdviceId: needsOptions.find((n) => n.signed)?.id ?? '' });
  const save = async () => {
    if (!form) return;
    const st = structured(form.kind);
    const payload: Record<string, unknown> = { title: form.title, clientName: form.clientName, ...(form.clientEmail ? { clientEmail: form.clientEmail } : {}), ...(form.body.trim() ? { body: form.body } : {}) };
    if (st) { payload.answers = form.answers; if (form.kind === 'recommendation' && form.linkedAdviceId) payload.linkedAdviceId = form.linkedAdviceId; }
    if (form.editId) await call('PATCH', `/v1/advice/${form.editId}`, payload);
    else await call('POST', `/v1/boxes/${boxId}/advice`, { kind: form.kind, ...payload });
    setForm(null);
  };
  return (
    <div class="rec-form">
      <h3>{x.h}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {ok && <div role="status" style={{ background: '#e6f4ea', color: '#137333', padding: '8px 10px', borderRadius: '8px', margin: '8px 0', fontWeight: 600 }}>{ok}</div>}
      {canEdit && !form && <button class="btn quiet" onClick={() => setForm(blank(kinds[0]?.kind ?? 'needs_analysis'))}>{x.add}</button>}
      {form && (
        <form class="rec-form" onSubmit={(e) => { e.preventDefault(); void go(save); }}>
          {!form.editId && <label class="fld">{x.kind}<select value={form.kind} onChange={(e) => { const k = (e.target as HTMLSelectElement).value; setForm({ ...blank(k), clientName: form.clientName, clientEmail: form.clientEmail }); }}>{kinds.map((k) => <option value={k.kind}>{k.label[locale]}</option>)}</select></label>}
          <label class="fld">{x.title}<input required maxLength={200} value={form.title} onInput={(e) => setForm({ ...form, title: (e.target as HTMLInputElement).value })} /></label>
          <label class="fld">{x.client}<input required value={form.clientName} onInput={(e) => setForm({ ...form, clientName: (e.target as HTMLInputElement).value })} /></label>
          <label class="fld">{x.email}<input type="email" value={form.clientEmail} onInput={(e) => setForm({ ...form, clientEmail: (e.target as HTMLInputElement).value })} /></label>
          {schema && form.kind === 'needs_analysis' && <NeedsForm form={schema} value={form.answers} locale={locale} onChange={(a) => setForm({ ...form, answers: a })} missing={list.find((a) => a.id === form.editId)?.missing ?? []} />}
          {schema && form.kind === 'recommendation' && <RecommendationForm form={schema} value={form.answers} locale={locale} onChange={(a) => setForm({ ...form, answers: a })} needs={needsOptions} linked={form.linkedAdviceId} onLink={(id) => setForm({ ...form, linkedAdviceId: id })} missing={list.find((a) => a.id === form.editId)?.missing ?? []} />}
          {structured(form.kind)
            ? <label class="fld">{x.notes}<textarea rows={3} value={form.body} onInput={(e) => setForm({ ...form, body: (e.target as HTMLTextAreaElement).value })} style={{ width: '100%' }} /></label>
            : <label class="fld">{x.body}<textarea required rows={6} value={form.body} onInput={(e) => setForm({ ...form, body: (e.target as HTMLTextAreaElement).value })} /></label>}
          <button class="btn" disabled={form.kind === 'recommendation' && !form.linkedAdviceId}>{x.save}</button> <button type="button" class="btn quiet" onClick={() => setForm(null)}>{x.cancel}</button>
        </form>
      )}
      {list.length === 0 && !form && <p class="muted">{x.none}</p>}
      {list.map((a) => (
        <div class="ev" key={a.id}>
          <strong>{a.title}</strong> <small>{label(a.kind)} · {a.clientName} · {a.status === 'signed' ? x.signed : a.status === 'awaiting_signature' ? x.awaiting : x.draft}</small>
          <div style={{ whiteSpace: 'pre-wrap', margin: '4px 0' }}>{a.body}</div>
          {a.calc && <small style={{ display: 'block' }}>{x.gap}: <strong>{money(a.calc.gap, locale)}</strong></small>}
          {a.kind === 'needs_analysis' && a.status === 'signed' && a.validUntil && <small style={{ display: 'block', color: a.validUntil < today ? '#b3261e' : undefined }}>{a.validUntil < today ? x.expiredOn : x.current} {a.validUntil}</small>}
          {(a.flags ?? []).length > 0 && <small style={{ display: 'block', color: '#8a5a00' }}>⚑ {x.flags}: {(a.flags ?? []).map((f) => schema?.flags[f]?.[locale] ?? f).join(' · ')}</small>}
          {a.review && <small style={{ display: 'block', color: a.review.status === 'needs_action' ? '#b3261e' : a.review.status === 'passed' ? '#137333' : '#8a5a00' }}>{x.review[a.review.status]} ({x.why[a.review.reason as keyof typeof x.why] ?? a.review.reason}){a.review.findings ? ` — ${a.review.findings}` : ''}{a.review.reviewer ? ` · ${a.review.reviewer}` : ''}</small>}
          {a.status !== 'signed' && (a.missing ?? []).length > 0 && <small style={{ display: 'block', color: '#b3261e' }}>{x.todo}: {(a.missing ?? []).length}</small>}
          {canEdit && a.status === 'draft' && a.structured && <button class="btn quiet" onClick={() => setForm({ kind: a.kind, title: a.title, body: a.body, clientName: a.clientName, clientEmail: a.clientEmail ?? '', answers: a.answers ?? {}, linkedAdviceId: a.linkedAdviceId ?? '', editId: a.id })}>{(a.missing ?? []).length ? x.fill : x.edit}</button>}
          {a.status === 'signed' && <small style={{ display: 'block' }}>✓ {a.signedMethod === 'vendor' ? `${x.via} ${a.vendorName} (${a.vendorRef})` : x.builtin} · {a.signedAt ? when(a.signedAt, locale) : ''} · {x.hash} {a.contentHash?.slice(0, 12)}…</small>}
          {links[a.id] && a.status !== 'signed' && <div class="muted" style={{ wordBreak: 'break-all' }}><code>{links[a.id]!.url}</code> <button class="btn quiet" onClick={() => void navigator.clipboard?.writeText(links[a.id]!.url)}>{x.copy}</button> {links[a.id]!.emailed ? x.emailedYes : x.emailedNo}</div>}
          {canEdit && a.status !== 'signed' && a.tier === 'builtin' && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '4px' }}>
              <button class="btn" disabled={(a.missing ?? []).length > 0} onClick={() => void go(async () => { const r = await call('POST', `/v1/advice/${a.id}/signing-link`); setLinks({ ...links, [a.id]: r }); }, x.linkMade)}>{x.link}</button>
              <button class="btn quiet" disabled={(a.missing ?? []).length > 0} onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/send-code`), x.sent)}>{x.send}</button>
              {a.status === 'awaiting_signature' && <>
                <input aria-label={x.code} placeholder={x.code} inputMode="numeric" maxLength={6} value={codes[a.id] ?? ''} onInput={(e) => setCodes({ ...codes, [a.id]: (e.target as HTMLInputElement).value })} style={{ width: '110px' }} />
                <button class="btn" disabled={(codes[a.id] ?? '').length !== 6} onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/confirm`, { code: codes[a.id] }), `✓ ${x.signed}`)}>{x.confirm}</button></>}
              {a.status === 'draft' && <button class="ib danger" aria-label={x.del} onClick={() => void go(() => call('DELETE', `/v1/advice/${a.id}`))}>✕</button>}
            </div>
          )}
          {canEdit && a.status !== 'signed' && a.tier === 'vendor' && (
            <div style={{ marginTop: '4px' }}>
              <p class="muted">{x.vendorHelp}</p>
              {adobeOn && <p>
                <button class="btn" disabled={!a.clientEmail || a.status === 'awaiting_signature'} onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/esign`), x.adobeSent)}>{x.adobeSend}</button>{' '}
                {a.status === 'awaiting_signature' && <button class="btn quiet" onClick={() => void (async () => { setErr(''); setOk(''); try { const r = await call('POST', `/v1/advice/${a.id}/esign/check`); await load(); setOk(r.signed ? x.adobeDone : `${x.adobeStatus}: ${r.status}`); } catch (e) { setErr((e as Error).message); } })()}>{x.adobeCheck}</button>}
              </p>}
              <select aria-label={x.vendorPick} value={vend[a.id]?.vendorId ?? ''} onChange={(e) => vset(a.id, { vendorId: (e.target as HTMLSelectElement).value })}>
                <option value="">{x.vendorPick}</option>{(vd?.vendors ?? []).filter((v) => v.enabled).map((v) => <option value={v.id}>{v.name}</option>)}
              </select>{' '}
              {vend[a.id]?.vendorId === 'other' && <><input aria-label={x.vendorName} placeholder={x.vendorName} value={vend[a.id]?.vendorName ?? ''} onInput={(e) => vset(a.id, { vendorName: (e.target as HTMLInputElement).value })} />{' '}</>}
              <input aria-label={x.vendorRef} placeholder={x.vendorRef} value={vend[a.id]?.vendorRef ?? ''} onInput={(e) => vset(a.id, { vendorRef: (e.target as HTMLInputElement).value })} />{' '}
              <select aria-label={x.doc} value={vend[a.id]?.documentId ?? ''} onChange={(e) => vset(a.id, { documentId: (e.target as HTMLSelectElement).value })}>
                <option value="">{x.doc}</option>{docs.map((d) => <option value={d.id}>{d.name}</option>)}
              </select>{' '}
              <button class="btn" disabled={!vend[a.id]?.vendorId || (vend[a.id]?.vendorId === 'other' && !vend[a.id]?.vendorName) || !vend[a.id]?.vendorRef || !vend[a.id]?.documentId} onClick={() => void go(() => call('POST', `/v1/advice/${a.id}/vendor-signed`, { vendorId: vend[a.id]!.vendorId, ...(vend[a.id]!.vendorId === 'other' ? { vendorName: vend[a.id]!.vendorName } : {}), vendorRef: vend[a.id]!.vendorRef, documentId: vend[a.id]!.documentId }), `✓ ${x.signed}`)}>{x.record}</button>{' '}
              {a.status === 'draft' && <button class="ib danger" aria-label={x.del} onClick={() => void go(() => call('DELETE', `/v1/advice/${a.id}`))}>✕</button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
export const adviceTabLabel = (locale: Locale) => T[locale].tab;
