// Client self-intake (roadmap Phase 2, feature 6) on a deal's Details tab: send a client a private link, follow it,
// review what they submitted, and apply it to the file. Hidden unless the server has INTAKE_ENABLED on (404 hides it).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;

const T = {
  en: {
    title: 'Client intake', help: 'Send a client a private link to fill in their details, situation and goals before you meet. Nothing they type changes the file until you review it here and apply it.',
    client: 'Client', noEmail: '(no email: add one first)', ask: 'Ask about', about: 'Who they are (always)', situation: 'Their situation and goals', consents: 'Consents', documents: 'Documents', id_check: 'Electronic ID check',
    send: 'Create the link', sentEmail: 'Emailed to the client.', notEmailed: 'Not emailed: send the link yourself.', blocked: 'The client withdrew consent to email, so send the link another way.', copy: 'Copy link', copied: 'Copied',
    list: 'Intakes on this deal', st: { sent: 'Sent', in_progress: 'Client started', submitted: 'Submitted: review it', applied: 'Applied to the file', canceled: 'Cancelled' } as Record<string, string>, expired: 'Expired',
    review: 'Review', hide: 'Hide', cancel: 'Cancel link', by: 'by', signed: (n: string, d: string) => `Confirmed by the client as “${n}” on ${d}, with a code sent to their email.`,
    aboutH: 'About them', situationH: 'Situation and goals', consentsH: 'Consents given (recorded on the Consent tab)', docsH: 'Documents (on the Files tab)', none: 'None',
    changes: 'Update the contact', change: (f: string, a: string | null, b: string) => `${f}: ${a ?? '(empty)'} → ${b}`, noChanges: 'Nothing differs from the contact record.',
    draft: 'Start a draft needs analysis from their answers', apply: 'Apply to the file', applied: (f: number, d: boolean) => `Applied${f ? `: ${f} contact detail${f === 1 ? '' : 's'} updated` : ''}${d ? `${f ? ', and' : ':'} a draft needs analysis is on the Advice tab` : ''}.`,
    fields: { phone: 'Phone', dateOfBirth: 'Date of birth', preferredLanguage: 'Language' } as Record<string, string>,
    labels: { legalName: 'Legal name', dateOfBirth: 'Date of birth', phone: 'Phone', address: 'Address', city: 'City', province: 'Province', postalCode: 'Postal code', occupation: 'Occupation', employer: 'Employer', preferredLanguage: 'Language',
      maritalStatus: 'Marital status', dependants: 'Dependants', annualIncome: 'Income', spouseIncome: 'Spouse income', monthlyExpenses: 'Monthly spending', liquidAssets: 'Savings', mortgage: 'Mortgage', otherDebts: 'Other debts',
      existingIndividual: 'Own life cover', existingGroup: 'Group life cover', existingPolicies: 'Policies', replacing: 'Replacing a policy', replacingNote: 'Replacement details', objectives: 'Goals', objectivesNote: 'Notes', monthlyBudget: 'Monthly budget' } as Record<string, string>,
    kinds: { collection_use: 'Collection and use', electronic_comms: 'Electronic messages', carrier_sharing: 'Sharing with insurers' } as Record<string, string>,
  },
  'fr-CA': {
    title: 'Accueil du client', help: 'Envoyez au client un lien privé pour remplir ses coordonnées, sa situation et ses objectifs avant la rencontre. Rien de ce qu’il saisit ne modifie le dossier avant que vous l’ayez revu et appliqué ici.',
    client: 'Client', noEmail: '(aucun courriel : ajoutez-en un)', ask: 'Demander', about: 'Son identité (toujours)', situation: 'Sa situation et ses objectifs', consents: 'Consentements', documents: 'Documents', id_check: 'Vérification d’identité électronique',
    send: 'Créer le lien', sentEmail: 'Envoyé au client par courriel.', notEmailed: 'Non envoyé : transmettez le lien vous-même.', blocked: 'Le client a retiré son consentement aux courriels : transmettez le lien autrement.', copy: 'Copier le lien', copied: 'Copié',
    list: 'Accueils de cette affaire', st: { sent: 'Envoyé', in_progress: 'Commencé par le client', submitted: 'Soumis : à revoir', applied: 'Appliqué au dossier', canceled: 'Annulé' } as Record<string, string>, expired: 'Expiré',
    review: 'Revoir', hide: 'Masquer', cancel: 'Annuler le lien', by: 'par', signed: (n: string, d: string) => `Confirmé par le client sous le nom « ${n} » le ${d}, avec un code envoyé à son courriel.`,
    aboutH: 'Identité', situationH: 'Situation et objectifs', consentsH: 'Consentements donnés (consignés dans l’onglet Consentement)', docsH: 'Documents (dans l’onglet Fichiers)', none: 'Aucun',
    changes: 'Mettre à jour le contact', change: (f: string, a: string | null, b: string) => `${f} : ${a ?? '(vide)'} → ${b}`, noChanges: 'Rien ne diffère de la fiche du contact.',
    draft: 'Créer une ébauche d’analyse des besoins à partir de ses réponses', apply: 'Appliquer au dossier', applied: (f: number, d: boolean) => `Appliqué${f ? ` : ${f} renseignement${f === 1 ? '' : 's'} mis à jour` : ''}${d ? `${f ? ', et' : ' :'} une ébauche d’analyse des besoins est dans l’onglet Conseils` : ''}.`,
    fields: { phone: 'Téléphone', dateOfBirth: 'Date de naissance', preferredLanguage: 'Langue' } as Record<string, string>,
    labels: { legalName: 'Nom légal', dateOfBirth: 'Date de naissance', phone: 'Téléphone', address: 'Adresse', city: 'Ville', province: 'Province', postalCode: 'Code postal', occupation: 'Profession', employer: 'Employeur', preferredLanguage: 'Langue',
      maritalStatus: 'État civil', dependants: 'Personnes à charge', annualIncome: 'Revenu', spouseIncome: 'Revenu du conjoint', monthlyExpenses: 'Dépenses mensuelles', liquidAssets: 'Épargne', mortgage: 'Hypothèque', otherDebts: 'Autres dettes',
      existingIndividual: 'Assurance vie personnelle', existingGroup: 'Assurance vie collective', existingPolicies: 'Polices', replacing: 'Remplacement', replacingNote: 'Détails du remplacement', objectives: 'Objectifs', objectivesNote: 'Notes', monthlyBudget: 'Budget mensuel' } as Record<string, string>,
    kinds: { collection_use: 'Collecte et utilisation', electronic_comms: 'Messages électroniques', carrier_sharing: 'Communication aux assureurs' } as Record<string, string>,
  },
};
const MONEY = ['annualIncome', 'spouseIncome', 'monthlyExpenses', 'liquidAssets', 'mortgage', 'otherDebts', 'existingIndividual', 'existingGroup', 'monthlyBudget'];
const show = (k: string, v: unknown, locale: Locale) => (typeof v === 'boolean' ? (v ? (locale === 'fr-CA' ? 'Oui' : 'Yes') : (locale === 'fr-CA' ? 'Non' : 'No')) : Array.isArray(v) ? v.join(', ').replace(/_/g, ' ') : MONEY.includes(k) && typeof v === 'number' ? `$${v.toLocaleString(locale)}` : String(v));

interface Intake { id: string; clientName: string; sections: string[]; status: string; expired: boolean; sentBy: string; createdAt: string; submittedAt: string | null; appliedBy: string | null }
interface Detail { status: string; answers: { about: Record<string, unknown>; situation?: Record<string, unknown> }; consents: string[]; documents: { id: string; name: string }[]; typedName: string | null; submittedAt: string | null; contactChanges: { field: string; from: string | null; to: string }[]; canApply: boolean }

function Answers({ x, title, a, locale }: { x: (typeof T)['en']; title: string; a: Record<string, unknown>; locale: Locale }) {
  const keys = Object.keys(a);
  return <div><h4 style={{ margin: '10px 0 4px' }}>{title}</h4>{keys.length === 0 ? <p class="muted">{x.none}</p> : <dl style={{ display: 'grid', gridTemplateColumns: 'minmax(120px, 34%) 1fr', gap: '2px 12px', margin: 0 }}>{keys.map((k) => <><dt class="muted" key={`${k}t`}>{x.labels[k] ?? k}</dt><dd key={`${k}d`} style={{ margin: 0 }}>{show(k, a[k], locale)}</dd></>)}</dl>}</div>;
}

export function IntakeCard({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ clients: { id: string; name: string; hasEmail: boolean }[]; intakes: Intake[]; idCheckAvailable: boolean } | null>(null);
  const [contact, setContact] = useState('');
  const [sections, setSections] = useState<string[]>(['situation', 'consents', 'documents']);
  const [made, setMade] = useState<{ url: string; emailed: boolean; emailBlocked: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [opts, setOpts] = useState({ updateContact: true, createNeedsDraft: true });
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = () => call('GET', `/v1/boxes/${boxId}/intakes`).then((r) => { setD(r); setContact((c) => c || r.clients.find((k: { hasEmail: boolean }) => k.hasEmail)?.id || ''); }, () => setD(null));
  useEffect(() => { void load(); }, [boxId]);
  if (!d) return null;
  const toggle = (s: string) => setSections(sections.includes(s) ? sections.filter((k) => k !== s) : [...sections, s]);
  const view = async (id: string) => { setErr(''); setDone(null); if (open === id) { setOpen(null); setDetail(null); return; } try { setDetail(await call('GET', `/v1/intakes/${id}`)); setOpen(id); } catch (e) { setErr(msg(e)); } };
  const box = { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } as const;
  const cb = { width: 'auto', margin: 0, minHeight: 0 } as const;
  return (
    <section aria-label={x.title} style={{ marginTop: '16px' }}>
      <h3>{x.title}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {canEdit && d.clients.length > 0 && <div class="hcard">
        <label class="fld">{x.client}<select aria-label={x.client} value={contact} onChange={(e) => { setContact((e.target as HTMLSelectElement).value); setMade(null); }}>{d.clients.map((c) => <option key={c.id} value={c.id} disabled={!c.hasEmail}>{c.name}{c.hasEmail ? '' : ` ${x.noEmail}`}</option>)}</select></label>
        <div style={{ fontWeight: 600, fontSize: '13px', margin: '8px 0 2px' }}>{x.ask}</div>
        <label style={box}><input type="checkbox" style={cb} checked disabled />{x.about}</label>
        {(['situation', 'consents', 'documents', ...(d.idCheckAvailable ? ['id_check'] : [])] as const).map((s) => <label key={s} style={box}><input type="checkbox" style={cb} checked={sections.includes(s)} onChange={() => toggle(s)} />{x[s as 'situation']}</label>)}
        <div class="actions"><button type="button" class="btn" disabled={!contact} onClick={() => { setErr(''); call('POST', `/v1/boxes/${boxId}/intakes`, { contactId: contact, sections }).then((r) => { setMade(r); setCopied(false); void load(); }, (e) => setErr(msg(e))); }}>{x.send}</button></div>
        {made && <div style={{ marginTop: '8px' }}>
          <p role="status" style={{ margin: '0 0 6px' }}>{made.emailed ? x.sentEmail : made.emailBlocked ? x.blocked : x.notEmailed}</p>
          <div style={{ display: 'flex', gap: '8px' }}><input aria-label="Intake link" readOnly value={made.url} onFocus={(e) => (e.target as HTMLInputElement).select()} />
            <button type="button" class="btn quiet" onClick={() => { void navigator.clipboard?.writeText(made.url).then(() => setCopied(true), () => undefined); }}>{copied ? x.copied : x.copy}</button></div>
        </div>}
      </div>}
      {d.intakes.length > 0 && <div style={{ marginTop: '10px' }}>
        <h4 style={{ margin: '0 0 4px' }}>{x.list}</h4>
        {d.intakes.map((i) => <div class="ev" key={i.id}>
          <strong>{i.clientName}: {i.expired ? x.expired : x.st[i.status]}</strong> <small>{new Date(i.createdAt).toLocaleDateString(locale)} · {x.by} {i.sentBy}</small>
          <div class="actions" style={{ gap: '8px', marginTop: '4px' }}>
            {['submitted', 'applied'].includes(i.status) && <button type="button" class="link" onClick={() => void view(i.id)}>{open === i.id ? x.hide : x.review}</button>}
            {canEdit && ['sent', 'in_progress'].includes(i.status) && !i.expired && <button type="button" class="link" onClick={() => { call('POST', `/v1/intakes/${i.id}/cancel`).then(() => load(), (e) => setErr(msg(e))); }}>{x.cancel}</button>}
          </div>
          {open === i.id && detail && <div class="hcard" style={{ marginTop: '6px' }}>
            {detail.typedName && detail.submittedAt && <p class="muted" style={{ marginTop: 0 }}>{x.signed(detail.typedName, new Date(detail.submittedAt).toLocaleString(locale))}</p>}
            <Answers x={x} title={x.aboutH} a={detail.answers.about} locale={locale} />
            {detail.answers.situation && <Answers x={x} title={x.situationH} a={detail.answers.situation} locale={locale} />}
            <h4 style={{ margin: '10px 0 4px' }}>{x.consentsH}</h4><p style={{ margin: 0 }}>{detail.consents.length ? detail.consents.map((k) => x.kinds[k] ?? k).join(', ') : x.none}</p>
            <h4 style={{ margin: '10px 0 4px' }}>{x.docsH}</h4><p style={{ margin: 0 }}>{detail.documents.length ? detail.documents.map((k) => k.name).join(', ') : x.none}</p>
            {canEdit && detail.canApply && <div style={{ marginTop: '10px' }}>
              <label style={box}><input type="checkbox" style={cb} checked={opts.updateContact} onChange={() => setOpts({ ...opts, updateContact: !opts.updateContact })} />{x.changes}</label>
              <ul style={{ margin: '2px 0 6px 26px', padding: 0 }}>{detail.contactChanges.length ? detail.contactChanges.map((c) => <li key={c.field}><small>{x.change(x.fields[c.field] ?? c.field, c.from, c.to)}</small></li>) : <li><small class="muted">{x.noChanges}</small></li>}</ul>
              {detail.answers.situation && <label style={box}><input type="checkbox" style={cb} checked={opts.createNeedsDraft} onChange={() => setOpts({ ...opts, createNeedsDraft: !opts.createNeedsDraft })} />{x.draft}</label>}
              <div class="actions"><button type="button" class="btn" onClick={() => { setErr(''); call('POST', `/v1/intakes/${i.id}/apply`, { updateContact: opts.updateContact, createNeedsDraft: opts.createNeedsDraft && !!detail.answers.situation }).then((r) => { setDone(x.applied(r.contactFields.length, !!r.needsAnalysisId)); setOpen(null); setDetail(null); void load(); }, (e) => setErr(msg(e))); }}>{x.apply}</button></div>
            </div>}
          </div>}
        </div>)}
        {done && <p role="status" class="hcard" style={{ borderColor: 'var(--ok)' }}>{done}</p>}
      </div>}
    </section>
  );
}
