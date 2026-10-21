// Suitability check before submission (roadmap Phase 2, feature 5): on a deal's Advice tab, and compliance's queue.
// Hidden unless the server has SUITABILITY_ENABLED on (a 404 hides it).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
const msg = (e: unknown) => (e as Error).message;

const T = {
  en: {
    title: 'Suitability check', help: 'Before the application goes in, compare the signed recommendation with the needs analysis it answers and your company\'s rules. The check lists what a reviewer would question. It never approves anything: you decide, or ask compliance.',
    none: 'Sign a needs analysis and a recommendation linked to it first.', checking: (r: string, n: string) => `Checks “${r}” against “${n}”.`,
    run: 'Run the check', running: 'Checking…', rerun: 'Run it again',
    aiOff: 'The AI review is off for you, so only PII\'s own rules run.', aiFailed: 'The AI service did not answer, so only PII\'s own rules ran.',
    gap: 'Gap', question: 'Question', rule: 'PII rule', ai: 'AI', cites: 'From',
    refs: { N1: 'needs analysis', R1: 'recommendation', D1: 'replacement disclosure' } as Record<string, string>, passage: (n: string) => `rulebook passage ${n}`,
    noGaps: 'Nothing found. This counts as the suitability review for this recommendation.',
    decideNote: 'Your reason (at least 10 characters)', proceed: 'Proceed: I have addressed these', refer: 'Ask compliance',
    gapsNeedCompliance: 'Your company asks compliance to clear any gap.',
    st: { no_gaps: 'Nothing found', open: 'Waiting for your decision', proceeded: 'You proceeded', referred: 'With compliance', cleared: 'Cleared by compliance', returned: 'Sent back by compliance' } as Record<string, string>,
    stale: 'Older recommendation', by: 'by', reason: 'Reason', reviewerNote: 'Compliance', history: 'Earlier checks',
    queue: 'Suitability reviews', queueHelp: 'Checks advisors asked you to look at, and recent ones where an advisor proceeded past a gap.', referred: 'Waiting for you', proceededGaps: 'Proceeded past a gap (last 30 days)', empty: 'Nothing waiting.',
    reviewNote: 'Your note (at least 10 characters)', clear: 'Clear', ret: 'Send back',
  },
  'fr-CA': {
    title: 'Examen de la convenance', help: 'Avant l’envoi de la proposition, comparez la recommandation signée avec l’analyse des besoins à laquelle elle répond et les règles de votre entreprise. L’examen liste ce qu’un réviseur remettrait en question. Il n’approuve jamais rien : vous décidez, ou vous consultez la conformité.',
    none: 'Faites d’abord signer une analyse des besoins et une recommandation qui y est liée.', checking: (r: string, n: string) => `Compare « ${r} » avec « ${n} ».`,
    run: 'Lancer l’examen', running: 'Examen en cours…', rerun: 'Relancer',
    aiOff: 'L’examen par l’IA est désactivé pour vous : seules les règles de PII s’appliquent.', aiFailed: 'Le service d’IA n’a pas répondu : seules les règles de PII ont été appliquées.',
    gap: 'Écart', question: 'Question', rule: 'Règle PII', ai: 'IA', cites: 'Source',
    refs: { N1: 'analyse des besoins', R1: 'recommandation', D1: 'divulgation de remplacement' } as Record<string, string>, passage: (n: string) => `passage ${n} du recueil de règles`,
    noGaps: 'Rien trouvé. Cela compte comme l’examen de la convenance de cette recommandation.',
    decideNote: 'Votre raison (au moins 10 caractères)', proceed: 'Poursuivre : j’ai réglé ces points', refer: 'Consulter la conformité',
    gapsNeedCompliance: 'Votre entreprise demande que la conformité lève tout écart.',
    st: { no_gaps: 'Rien trouvé', open: 'En attente de votre décision', proceeded: 'Vous avez poursuivi', referred: 'À la conformité', cleared: 'Levé par la conformité', returned: 'Renvoyé par la conformité' } as Record<string, string>,
    stale: 'Recommandation antérieure', by: 'par', reason: 'Raison', reviewerNote: 'Conformité', history: 'Examens antérieurs',
    queue: 'Examens de la convenance', queueHelp: 'Les examens que les conseillers vous soumettent, et ceux où un conseiller a poursuivi malgré un écart.', referred: 'En attente de vous', proceededGaps: 'Poursuivis malgré un écart (30 derniers jours)', empty: 'Rien en attente.',
    reviewNote: 'Votre note (au moins 10 caractères)', clear: 'Lever', ret: 'Renvoyer',
  },
};
type X = (typeof T)['en'];
interface Finding { source: 'rule' | 'ai'; code: string; severity: 'gap' | 'question'; text: string; cites: string[] }
interface Check { id: string; status: string; findings: Finding[]; aiUsed: boolean; runBy: string; advisorNote: string | null; reviewer: string | null; reviewerNote: string | null; createdAt: string; current?: boolean; mine: boolean; dealName?: string }

const citeText = (x: X, c: string) => x.refs[c] ?? (c.startsWith('P') ? x.passage(c.slice(1)) : c);
function Findings({ x, list }: { x: X; list: Finding[] }) {
  return <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0' }}>{list.map((f, i) => (
    <li key={i} style={{ margin: '0 0 8px', paddingLeft: '10px', borderLeft: `3px solid ${f.severity === 'gap' ? 'var(--danger, #b42318)' : 'var(--warn, #b54708)'}` }}>
      <strong>{f.severity === 'gap' ? x.gap : x.question}</strong> <small class="muted">· {f.source === 'rule' ? x.rule : x.ai} · {x.cites}: {f.cites.map((c) => citeText(x, c)).join(', ')}</small>
      <div>{f.text}</div>
    </li>))}</ul>;
}

/** On a deal's Advice tab. */
export function SuitabilityCard({ boxId, call, locale, canEdit }: { boxId: string; call: Call; locale: Locale; canEdit: boolean }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ current: { recommendation: string; needsAnalysis: string } | null; checks: Check[]; gapsNeedCompliance: boolean; aiOn: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [aiFailed, setAiFailed] = useState(false);
  const load = () => call('GET', `/v1/boxes/${boxId}/suitability`).then(setD, () => setD(null));
  useEffect(() => { void load(); }, [boxId]);
  if (!d) return null;
  const latest = d.checks.find((c) => c.current) ?? null;
  const older = d.checks.filter((c) => c !== latest);
  const hasGap = !!latest?.findings.some((f) => f.severity === 'gap');
  const runIt = async () => { setBusy(true); setErr(''); try { const r = await call('POST', `/v1/boxes/${boxId}/suitability`); setAiFailed(r.aiAttempted && !r.aiUsed); setNote(''); await load(); } catch (e) { setErr(msg(e)); } finally { setBusy(false); } };
  const decide = async (action: 'proceed' | 'refer') => { setErr(''); try { await call('POST', `/v1/suitability/${latest!.id}/decide`, { action, note }); setNote(''); await load(); } catch (e) { setErr(msg(e)); } };
  return (
    <section class="rec-form" aria-label={x.title} style={{ marginTop: '14px' }}>
      <h3>{x.title}</h3>
      <p class="muted">{x.help}</p>
      {err && <div class="err" role="alert">{err}</div>}
      {!d.current ? <p class="muted">{x.none}</p> : <p>{x.checking(d.current.recommendation, d.current.needsAnalysis)}</p>}
      {d.current && !d.aiOn && <p class="muted">{x.aiOff}</p>}
      {aiFailed && <p class="muted" role="status">{x.aiFailed}</p>}
      {latest && <div class="hcard">
        <strong>{x.st[latest.status]}</strong> <small class="muted">· {new Date(latest.createdAt).toLocaleString(locale)} · {x.by} {latest.runBy}{latest.aiUsed ? ` · ${x.ai}` : ''}</small>
        {latest.findings.length ? <Findings x={x} list={latest.findings} /> : <p>{x.noGaps}</p>}
        {latest.advisorNote && <p style={{ margin: '4px 0' }}><small><strong>{x.reason}:</strong> {latest.advisorNote}</small></p>}
        {latest.reviewerNote && <p style={{ margin: '4px 0' }}><small><strong>{x.reviewerNote} ({latest.reviewer}):</strong> {latest.reviewerNote}</small></p>}
        {canEdit && latest.status === 'open' && <div>
          {hasGap && d.gapsNeedCompliance && <p class="muted">{x.gapsNeedCompliance}</p>}
          <label class="fld">{x.decideNote}<textarea aria-label={x.decideNote} rows={2} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} /></label>
          <div class="actions" style={{ gap: '8px' }}>
            {!(hasGap && d.gapsNeedCompliance) && <button type="button" class="btn" disabled={note.trim().length < 10} onClick={() => void decide('proceed')}>{x.proceed}</button>}
            <button type="button" class={hasGap && d.gapsNeedCompliance ? 'btn' : 'btn quiet'} disabled={note.trim().length < 10} onClick={() => void decide('refer')}>{x.refer}</button>
          </div>
        </div>}
      </div>}
      {canEdit && d.current && (!latest || ['returned', 'no_gaps', 'proceeded', 'cleared'].includes(latest.status)) && (
        <div class="actions"><button type="button" class={latest ? 'btn quiet' : 'btn'} disabled={busy} onClick={() => void runIt()}>{latest ? x.rerun : x.run}</button></div>
      )}
      {busy && <p class="muted" role="status">{x.running}</p>}
      {older.length > 0 && <details style={{ marginTop: '8px' }}><summary class="muted" style={{ cursor: 'pointer' }}>{x.history} ({older.length})</summary>
        {older.map((c) => <div class="ev" key={c.id}><strong>{x.st[c.status]}</strong> <small>{c.current ? '' : `${x.stale} · `}{new Date(c.createdAt).toLocaleDateString(locale)} · {x.by} {c.runBy}</small>{c.findings.length > 0 && <Findings x={x} list={c.findings} />}</div>)}
      </details>}
    </section>
  );
}

/** On the Compliance page: checks waiting for compliance, and recent ones that proceeded past a gap. */
export function SuitabilityQueue({ call, locale }: { call: Call; locale: Locale }) {
  const x = T[locale] ?? T.en;
  const [d, setD] = useState<{ referred: Check[]; proceededWithGaps: Check[] } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const load = () => call('GET', '/v1/suitability/queue').then(setD, () => setD(null));
  useEffect(() => { void load(); }, []);
  if (!d) return null;
  const act = async (id: string, action: 'clear' | 'return') => { setErr(''); try { await call('POST', `/v1/suitability/${id}/review`, { action, note: notes[id] }); await load(); } catch (e) { setErr(msg(e)); } };
  return (
    <section class="hcard rec-form" aria-label={x.queue} style={{ marginTop: '16px' }}>
      <h3 style={{ marginTop: 0 }}>{x.queue}</h3>
      <p class="muted">{x.queueHelp}</p>
      {err && <div class="err" role="alert">{err}</div>}
      <h4 style={{ margin: '8px 0 4px' }}>{x.referred} ({d.referred.length})</h4>
      {d.referred.length === 0 && <p class="muted">{x.empty}</p>}
      {d.referred.map((c) => <div class="ev" key={c.id}>
        <strong>{c.dealName}</strong> <small>{new Date(c.createdAt).toLocaleDateString(locale)} · {x.by} {c.runBy}</small>
        <Findings x={x} list={c.findings} />
        {c.advisorNote && <p style={{ margin: '4px 0' }}><small><strong>{x.reason}:</strong> {c.advisorNote}</small></p>}
        {!c.mine && <div>
          <label class="fld">{x.reviewNote}<textarea aria-label={`${x.reviewNote}: ${c.dealName}`} rows={2} value={notes[c.id] ?? ''} onInput={(e) => setNotes({ ...notes, [c.id]: (e.target as HTMLTextAreaElement).value })} /></label>
          <div class="actions" style={{ gap: '8px' }}>
            <button type="button" class="btn" disabled={(notes[c.id] ?? '').trim().length < 10} onClick={() => void act(c.id, 'clear')}>{x.clear}</button>
            <button type="button" class="btn quiet" disabled={(notes[c.id] ?? '').trim().length < 10} onClick={() => void act(c.id, 'return')}>{x.ret}</button>
          </div>
        </div>}
      </div>)}
      {d.proceededWithGaps.length > 0 && <>
        <h4 style={{ margin: '12px 0 4px' }}>{x.proceededGaps} ({d.proceededWithGaps.length})</h4>
        {d.proceededWithGaps.map((c) => <div class="ev" key={c.id}><strong>{c.dealName}</strong> <small>{x.by} {c.runBy}</small><Findings x={x} list={c.findings.filter((f) => f.severity === 'gap')} />{c.advisorNote && <small><strong>{x.reason}:</strong> {c.advisorNote}</small>}</div>)}
      </>}
    </section>
  );
}
