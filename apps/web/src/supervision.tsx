// Supervision rules and escalation (roadmap Phase 2, feature 9): the rules and the review queue on the Compliance page,
// and what applies to a deal on its Files tab. Hidden unless the server has SUPERVISION_ENABLED on (a 404 hides it).
import { useEffect, useState } from 'preact/hooks';
import { DOC_TYPES } from './doctypes.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;

const T = {
  en: {
    rules: 'Supervision rules', rulesHelp: 'Extra paperwork or a compliance review for the deals that need it, by pipeline, stage, amount, product or province. A deal cannot enter the stage until the rule is met.',
    add: 'New rule', edit: 'Edit', save: 'Save rule', cancel: 'Cancel', on: 'On', off: 'Off', turnOn: 'Switch on', turnOff: 'Switch off',
    name: 'Name', risk: 'Risk', low: 'Low', medium: 'Medium', high: 'High', when: 'When a deal', pipeline: 'Pipeline', anyPipeline: 'Any pipeline', stage: 'Enters stage', wonStage: 'Any won stage',
    minValue: 'Deal value at least ($)', minCover: 'Recommended cover at least ($)', product: 'Product line', anyProduct: 'Any', life_health: 'Life and health', annuity: 'Annuities', province: 'Client province (two letters)', replacing: 'Only when replacing existing cover',
    then: 'Then it needs', docs: 'Paperwork', review: 'A compliance review', hours: 'Review within (hours)', escalate: 'If late, tell', everyone: 'Every compliance officer',
    by: 'by', needs: 'Needs', reviewIn: (h: number) => `review within ${h} h`,
    queue: 'Reviews requested', queueHelp: 'Deals waiting for a compliance review under a company rule, late and high-risk first.', empty: 'Nothing waiting.', overdue: 'Late', due: 'Due', note: 'Your note (at least 10 characters)', approve: 'Approve', reject: 'Reject', recent: 'Decided in the last 7 days',
    deal: 'Company rules for this deal', dealHelp: 'Rules compliance has set that apply to this deal.', missing: 'Still to file', allFiled: 'Paperwork on file', ask: 'Ask compliance for a review', askNote: 'Note for compliance (optional)',
    st: { pending: 'Review pending', approved: 'Review approved', rejected: 'Review rejected' } as Record<string, string>, at: 'at',
  },
  'fr-CA': {
    rules: 'Règles de supervision', rulesHelp: 'Documents supplémentaires ou examen de conformité pour les affaires qui l’exigent, selon le pipeline, l’étape, le montant, le produit ou la province. Une affaire ne peut entrer à l’étape tant que la règle n’est pas respectée.',
    add: 'Nouvelle règle', edit: 'Modifier', save: 'Enregistrer la règle', cancel: 'Annuler', on: 'Active', off: 'Inactive', turnOn: 'Activer', turnOff: 'Désactiver',
    name: 'Nom', risk: 'Risque', low: 'Faible', medium: 'Moyen', high: 'Élevé', when: 'Quand une affaire', pipeline: 'Pipeline', anyPipeline: 'Tout pipeline', stage: 'Entre à l’étape', wonStage: 'Toute étape conclue',
    minValue: 'Valeur de l’affaire d’au moins ($)', minCover: 'Garantie recommandée d’au moins ($)', product: 'Gamme de produits', anyProduct: 'Toutes', life_health: 'Vie et santé', annuity: 'Rentes', province: 'Province du client (deux lettres)', replacing: 'Seulement en cas de remplacement',
    then: 'Alors elle exige', docs: 'Documents', review: 'Un examen de conformité', hours: 'Examen dans les (heures)', escalate: 'En cas de retard, aviser', everyone: 'Tous les responsables de la conformité',
    by: 'par', needs: 'Exige', reviewIn: (h: number) => `examen dans les ${h} h`,
    queue: 'Examens demandés', queueHelp: 'Affaires en attente d’un examen de conformité selon une règle de l’entreprise, en retard et à risque élevé d’abord.', empty: 'Rien en attente.', overdue: 'En retard', due: 'Échéance', note: 'Votre note (au moins 10 caractères)', approve: 'Approuver', reject: 'Refuser', recent: 'Décidés ces 7 derniers jours',
    deal: 'Règles de l’entreprise pour cette affaire', dealHelp: 'Règles établies par la conformité qui s’appliquent à cette affaire.', missing: 'À déposer', allFiled: 'Documents au dossier', ask: 'Demander un examen à la conformité', askNote: 'Note pour la conformité (facultatif)',
    st: { pending: 'Examen en attente', approved: 'Examen approuvé', rejected: 'Examen refusé' } as Record<string, string>, at: 'à',
  },
};
type X = (typeof T)['en'];
const docName = (k: string, locale: Locale) => DOC_TYPES.find((d) => d.k === k)?.l[locale] ?? k;
interface RuleOut { id: string; name: string; active: boolean; risk: 'low' | 'medium' | 'high'; pipelineId: string | null; stageId: string | null; minDealValue: number | null; minCoverage: number | null; productLine: string | null; province: string | null; replacingOnly: boolean; requiredDocs: string[]; reviewRequired: boolean; reviewHours: number; escalateTo: string | null; description: string; updatedBy: string }
const RISK_COLOR = { high: 'var(--danger, #b42318)', medium: 'var(--warn, #b54708)', low: 'var(--muted, #6b7280)' } as const;
const blank = { name: '', risk: 'medium', pipelineId: '', stageId: '', minDealValue: '', minCoverage: '', productLine: '', province: '', replacingOnly: false, requiredDocs: [] as string[], reviewRequired: true, reviewHours: '48', escalateTo: '' };

function RuleForm({ x, locale, data, initial, onSave, onCancel }: { x: X; locale: Locale; data: { pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[]; people: { id: string; name: string }[] }; initial: typeof blank; onSave: (f: typeof blank) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof blank, v: unknown) => setF({ ...f, [k]: v });
  const box = { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } as const;
  const cb = { width: 'auto', margin: 0, minHeight: 0 } as const;
  const pipe = data.pipelines.find((p) => p.id === f.pipelineId);
  return (
    <div class="hcard" style={{ marginTop: '8px' }}>
      <div class="two"><label class="fld">{x.name}<input aria-label={x.name} value={f.name} maxLength={120} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} /></label>
        <label class="fld">{x.risk}<select aria-label={x.risk} value={f.risk} onChange={(e) => set('risk', (e.target as HTMLSelectElement).value)}>{(['low', 'medium', 'high'] as const).map((r) => <option key={r} value={r}>{x[r]}</option>)}</select></label></div>
      <div style={{ fontWeight: 600, margin: '8px 0 2px' }}>{x.when}</div>
      <div class="two"><label class="fld">{x.pipeline}<select aria-label={x.pipeline} value={f.pipelineId} onChange={(e) => setF({ ...f, pipelineId: (e.target as HTMLSelectElement).value, stageId: '' })}><option value="">{x.anyPipeline}</option>{data.pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <label class="fld">{x.stage}<select aria-label={x.stage} value={f.stageId} onChange={(e) => set('stageId', (e.target as HTMLSelectElement).value)}><option value="">{x.wonStage}</option>{(pipe?.stages ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label></div>
      <div class="two"><label class="fld">{x.minValue}<input aria-label={x.minValue} type="number" min="0" value={f.minDealValue} onInput={(e) => set('minDealValue', (e.target as HTMLInputElement).value)} /></label>
        <label class="fld">{x.minCover}<input aria-label={x.minCover} type="number" min="0" value={f.minCoverage} onInput={(e) => set('minCoverage', (e.target as HTMLInputElement).value)} /></label></div>
      <div class="two"><label class="fld">{x.product}<select aria-label={x.product} value={f.productLine} onChange={(e) => set('productLine', (e.target as HTMLSelectElement).value)}><option value="">{x.anyProduct}</option><option value="life_health">{x.life_health}</option><option value="annuity">{x.annuity}</option></select></label>
        <label class="fld">{x.province}<input aria-label={x.province} maxLength={2} value={f.province} onInput={(e) => set('province', (e.target as HTMLInputElement).value.toUpperCase())} /></label></div>
      <label style={box}><input type="checkbox" style={cb} checked={f.replacingOnly} onChange={() => set('replacingOnly', !f.replacingOnly)} />{x.replacing}</label>
      <div style={{ fontWeight: 600, margin: '10px 0 2px' }}>{x.then}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2px 16px' }}>{DOC_TYPES.map((d) => <label key={d.k} style={box}><input type="checkbox" style={cb} checked={f.requiredDocs.includes(d.k)} onChange={() => set('requiredDocs', f.requiredDocs.includes(d.k) ? f.requiredDocs.filter((k) => k !== d.k) : [...f.requiredDocs, d.k])} />{d.l[locale]}</label>)}</div>
      <label style={{ ...box, marginTop: '6px' }}><input type="checkbox" style={cb} checked={f.reviewRequired} onChange={() => set('reviewRequired', !f.reviewRequired)} />{x.review}</label>
      {f.reviewRequired && <div class="two"><label class="fld">{x.hours}<input aria-label={x.hours} type="number" min="1" max="720" value={f.reviewHours} onInput={(e) => set('reviewHours', (e.target as HTMLInputElement).value)} /></label>
        <label class="fld">{x.escalate}<select aria-label={x.escalate} value={f.escalateTo} onChange={(e) => set('escalateTo', (e.target as HTMLSelectElement).value)}><option value="">{x.everyone}</option>{data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>}
      <div class="actions" style={{ gap: '8px' }}>
        <button type="button" class="btn" disabled={busy || f.name.trim().length < 3 || (!f.reviewRequired && !f.requiredDocs.length)} onClick={() => { setBusy(true); void onSave(f).finally(() => setBusy(false)); }}>{x.save}</button>
        <button type="button" class="btn quiet" onClick={onCancel}>{x.cancel}</button>
      </div>
    </div>
  );
}

/** Compliance page: write and switch rules. */
export function SupervisionRulesPanel({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ rules: RuleOut[]; pipelines: { id: string; name: string; stages: { id: string; name: string }[] }[]; people: { id: string; name: string }[]; canChange: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/supervision/rules').then(setD, () => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d || !d.canChange) return null;
  const toBody = (f: typeof blank) => ({ name: f.name.trim(), risk: f.risk, pipelineId: f.pipelineId || null, stageId: f.stageId || null, minDealValue: f.minDealValue === '' ? null : Number(f.minDealValue),
    minCoverage: f.minCoverage === '' ? null : Number(f.minCoverage), productLine: f.productLine || null, province: f.province || null, replacingOnly: f.replacingOnly, requiredDocs: f.requiredDocs,
    reviewRequired: f.reviewRequired, reviewHours: Number(f.reviewHours) || 48, escalateTo: f.escalateTo || null });
  const save = async (id: string | null, f: typeof blank) => { setErr(''); try { await call(id ? 'PATCH' : 'POST', id ? `/v1/supervision/rules/${id}` : '/v1/supervision/rules', toBody(f)); setEditing(null); await load(); } catch (e) { setErr(msg(e)); } };
  const fromRule = (r: RuleOut): typeof blank => ({ name: r.name, risk: r.risk, pipelineId: r.pipelineId ?? '', stageId: r.stageId ?? '', minDealValue: r.minDealValue == null ? '' : String(r.minDealValue), minCoverage: r.minCoverage == null ? '' : String(r.minCoverage),
    productLine: r.productLine ?? '', province: r.province ?? '', replacingOnly: r.replacingOnly, requiredDocs: r.requiredDocs, reviewRequired: r.reviewRequired, reviewHours: String(r.reviewHours), escalateTo: r.escalateTo ?? '' });
  return (
    <section class="hcard rec-form" aria-label={x.rules} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.rules}</h3>
      <p class="muted">{x.rulesHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {d.rules.map((r) => <div class="ev" key={r.id} style={{ opacity: r.active ? 1 : 0.6 }}>
        <strong>{r.name}</strong> <small style={{ color: RISK_COLOR[r.risk] }}>● {x[r.risk]}</small> <small class="muted">· {r.active ? x.on : x.off}</small>
        <div><small>{r.description}</small></div>
        <div><small>{x.needs}: {[...r.requiredDocs.map((k) => docName(k, locale)), ...(r.reviewRequired ? [x.reviewIn(r.reviewHours)] : [])].join(', ')}</small></div>
        {editing === r.id ? <RuleForm x={x} locale={locale} data={d} initial={fromRule(r)} onSave={(f) => save(r.id, f)} onCancel={() => setEditing(null)} />
          : <div class="actions" style={{ gap: '8px', marginTop: '2px' }}><button type="button" class="link" onClick={() => setEditing(r.id)}>{x.edit}</button><button type="button" class="link" onClick={() => { call('PATCH', `/v1/supervision/rules/${r.id}`, { active: !r.active }).then(() => load(), (e) => setErr(msg(e))); }}>{r.active ? x.turnOff : x.turnOn}</button></div>}
      </div>)}
      {editing === 'new' ? <RuleForm x={x} locale={locale} data={d} initial={blank} onSave={(f) => save(null, f)} onCancel={() => setEditing(null)} />
        : <div class="actions"><button type="button" class="btn quiet" onClick={() => setEditing('new')}>{x.add}</button></div>}
    </section>
  );
}

/** Compliance page: the review queue. */
export function SupervisionQueue({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ pending: any[]; recent: any[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/supervision/queue').then(setD, () => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const decide = (id: string, decision: 'approved' | 'rejected') => { setErr(''); call('POST', `/v1/supervision/reviews/${id}/decide`, { decision, note: notes[id] }).then(() => load(), (e) => setErr(msg(e))); };
  return (
    <section class="hcard rec-form" aria-label={x.queue} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.queue} ({d.pending.length})</h3>
      <p class="muted">{x.queueHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {d.pending.length === 0 && <p class="muted">{x.empty}</p>}
      {d.pending.map((v) => <div class="ev" key={v.id}>
        <strong>{v.dealName}</strong> <small style={{ color: RISK_COLOR[v.risk as 'high'] }}>● {v.ruleName}</small> <small class={v.overdue ? 'err' : 'muted'}>· {v.overdue ? x.overdue : x.due} {new Date(v.dueAt).toLocaleString(locale)}</small>
        <div><small>{x.by} {v.requestedBy}{v.requestNote ? `: ${v.requestNote}` : ''}</small></div>
        {!v.mine && <div>
          <label class="fld">{x.note}<textarea aria-label={`${x.note}: ${v.dealName}`} rows={2} value={notes[v.id] ?? ''} onInput={(e) => setNotes({ ...notes, [v.id]: (e.target as HTMLTextAreaElement).value })} /></label>
          <div class="actions" style={{ gap: '8px' }}>
            <button type="button" class="btn" disabled={(notes[v.id] ?? '').trim().length < 10} onClick={() => decide(v.id, 'approved')}>{x.approve}</button>
            <button type="button" class="btn quiet" disabled={(notes[v.id] ?? '').trim().length < 10} onClick={() => decide(v.id, 'rejected')}>{x.reject}</button>
          </div>
        </div>}
      </div>)}
      {d.recent.length > 0 && <details style={{ marginTop: '8px' }}><summary class="muted" style={{ cursor: 'pointer' }}>{x.recent} ({d.recent.length})</summary>
        {d.recent.map((v) => <div class="ev" key={v.id}><strong>{v.dealName}</strong> <small>{x.st[v.status]} · {v.ruleName} · {x.by} {v.decidedBy}{v.decisionNote ? `: ${v.decisionNote}` : ''}</small></div>)}
      </details>}
    </section>
  );
}

/** A deal's Files tab: the company rules that apply to it. */
export function SupervisionCard({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ rules: (RuleOut & { stage: string; missing: string[]; review: { status: string; dueAt: string; overdue: boolean; decidedBy: string | null; decisionNote: string | null } | null })[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', `/v1/boxes/${boxId}/supervision`).then(setD, () => setD(null));
  useEffect(() => { void load(); }, [boxId]);
  if (!d || !d.rules.length) return null;
  return (
    <section class="rec-form" aria-label={x.deal} style={{ marginTop: '16px' }}>
      <h3>{x.deal}</h3>
      <p class="muted">{x.dealHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {d.rules.map((r) => <div class="ev" key={r.id}>
        <strong>{r.name}</strong> <small style={{ color: RISK_COLOR[r.risk] }}>● {x[r.risk]}</small> <small class="muted">· {r.description}</small>
        {r.requiredDocs.length > 0 && <div><small>{r.missing.length ? `${x.missing}: ${r.missing.map((k) => docName(k, locale)).join(', ')}` : `✓ ${x.allFiled}`}</small></div>}
        {r.reviewRequired && (r.review && r.review.status !== 'rejected'
          ? <div><small><strong>{x.st[r.review.status]}</strong>{r.review.status === 'pending' ? ` · ${r.review.overdue ? x.overdue : x.due} ${new Date(r.review.dueAt).toLocaleString(locale)}` : ''}{r.review.decidedBy ? ` · ${x.by} ${r.review.decidedBy}${r.review.decisionNote ? `: ${r.review.decisionNote}` : ''}` : ''}</small></div>
          : <div>
            {r.review?.status === 'rejected' && <div><small><strong>{x.st.rejected}</strong> · {x.by} {r.review.decidedBy}{r.review.decisionNote ? `: ${r.review.decisionNote}` : ''}</small></div>}
            {canEdit && <><label class="fld">{x.askNote}<textarea aria-label={`${x.askNote}: ${r.name}`} rows={2} value={notes[r.id] ?? ''} onInput={(e) => setNotes({ ...notes, [r.id]: (e.target as HTMLTextAreaElement).value })} /></label>
              <div class="actions"><button type="button" class="btn quiet" onClick={() => { setErr(''); call('POST', `/v1/boxes/${boxId}/supervision/${r.id}/request`, notes[r.id]?.trim() ? { note: notes[r.id] } : {}).then(() => load(), (e) => setErr(msg(e))); }}>{x.ask}</button></div></>}
          </div>)}
      </div>)}
    </section>
  );
}
