import { useEffect, useState } from 'preact/hooks';
import { useDialogFocus } from './a11y.ts';
import type { Locale } from './types.ts';

type Call = (method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Kind = 'summary' | 'next_action' | 'reply_draft';
interface Insight { kind: Kind; body: string; usedEmail: boolean; createdAt: string }
interface Settings { enabled: boolean; includeEmail: boolean; available: boolean; canChange: boolean }

const X = {
  'en': {
    section: 'Assistant', summary: 'Summarize', next_action: 'Next step', reply_draft: 'Draft a reply', working: 'Thinking…', copy: 'Copy', copied: 'Copied', ask: 'Anything to include? (optional)',
    off: 'The assistant is off for your company. A company administrator can turn it on from “Needs attention”.', fromEmail: 'Used linked email', notEmail: 'Based on notes and tasks only', aiNote: 'AI-written. Check before you use it.',
    title: 'Needs attention', help: 'Records that look stuck, based on simple rules: time in stage, overdue tasks, a passed close date, and no next step.', none: 'Nothing looks stuck. Nice.', days: (n: number) => `${n} days in stage`,
    why: { stalled: 'Stalled', overdue: 'Overdue task', past_close: 'Past close date', no_next_step: 'No next step', unowned: 'No owner' } as Record<string, string>,
    adminTitle: 'AI assistant', adminHelp: 'Summaries, next-step ideas and reply drafts. When you use it, the record’s name, stage, value, notes and tasks are sent to Anthropic’s AI service to write the answer; nothing is used to train models. Off by default.',
    enable: 'Turn on the assistant for my company', email: 'Also let it read emails that people have linked to a record', unavailable: 'The server has no AI service connected yet.', close: 'Close',
  },
  'fr-CA': {
    section: 'Assistant', summary: 'Résumer', next_action: 'Prochaine étape', reply_draft: 'Rédiger une réponse', working: 'Réflexion…', copy: 'Copier', copied: 'Copié', ask: 'Quelque chose à inclure? (facultatif)',
    off: 'L’assistant est désactivé pour votre entreprise. Un administrateur peut l’activer depuis « À surveiller ».', fromEmail: 'Courriels liés utilisés', notEmail: 'Fondé sur les notes et les tâches seulement', aiNote: 'Rédigé par IA. Vérifiez avant d’utiliser.',
    title: 'À surveiller', help: 'Dossiers qui semblent bloqués, selon des règles simples : temps dans l’étape, tâches en retard, date de clôture dépassée et aucune prochaine étape.', none: 'Rien ne semble bloqué. Parfait.', days: (n: number) => `${n} jours dans l’étape`,
    why: { stalled: 'Bloqué', overdue: 'Tâche en retard', past_close: 'Clôture dépassée', no_next_step: 'Aucune prochaine étape', unowned: 'Sans responsable' } as Record<string, string>,
    adminTitle: 'Assistant IA', adminHelp: 'Résumés, idées de prochaine étape et brouillons de réponse. À l’utilisation, le nom du dossier, l’étape, la valeur, les notes et les tâches sont envoyés au service d’IA d’Anthropic pour rédiger la réponse; rien n’est utilisé pour entraîner des modèles. Désactivé par défaut.',
    enable: 'Activer l’assistant pour mon entreprise', email: 'Lui permettre aussi de lire les courriels liés à un dossier', unavailable: 'Aucun service d’IA n’est encore connecté au serveur.', close: 'Fermer',
  },
};

/** Summary, next step and reply draft for one record. Hidden when the server has no AI service. */
export function AiBox({ boxId, call, locale }: { boxId: string; call: Call; locale: Locale }) {
  const x = X[locale];
  const [s, setS] = useState<Settings | null>(null);
  const [items, setItems] = useState<Partial<Record<Kind, Insight>>>({});
  const [busy, setBusy] = useState<Kind | ''>('');
  const [extra, setExtra] = useState('');
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    call('GET', '/v1/ai/settings').then(setS, () => undefined);
    call('GET', `/v1/boxes/${boxId}/ai`).then((r) => { const m: Partial<Record<Kind, Insight>> = {}; for (const i of r.insights as Insight[]) m[i.kind] = i; setItems(m); }, () => undefined);
  }, [call, boxId]);
  if (!s || !s.available) return null;
  const go = async (kind: Kind) => {
    setErr(''); setBusy(kind);
    try { const r = await call('POST', `/v1/boxes/${boxId}/ai`, { kind, ...(kind === 'reply_draft' && extra.trim() ? { instruction: extra.trim() } : {}) }); setItems((m) => ({ ...m, [kind]: r as Insight })); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(''); }
  };
  const copy = async (v: string) => { try { await navigator.clipboard.writeText(v); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked: the text stays selectable */ } };
  return (
    <section class="aibox" aria-label={x.section}>
      <h3>✨ {x.section}</h3>
      {!s.enabled ? <p class="muted">{x.off}</p> : (
        <>
          <div class="erow wrap2">
            {(['summary', 'next_action', 'reply_draft'] as Kind[]).map((k) => <button class="btn quiet" disabled={!!busy} onClick={() => void go(k)}>{busy === k ? x.working : x[k]}</button>)}
          </div>
          <input placeholder={x.ask} aria-label={x.ask} value={extra} onInput={(e) => setExtra((e.target as HTMLInputElement).value)} />
          {err && <p class="err" role="alert">{err}</p>}
          {(['summary', 'next_action', 'reply_draft'] as Kind[]).filter((k) => items[k]).map((k) => (
            <div class="ev ai" key={k}>
              <strong>{x[k]}</strong>
              <div style={{ whiteSpace: 'pre-wrap' }}>{items[k]!.body}</div>
              <small>{items[k]!.usedEmail ? x.fromEmail : x.notEmail} · {x.aiNote} · {new Date(items[k]!.createdAt).toLocaleString(locale)}</small>
              {k === 'reply_draft' && <div class="actions"><button class="btn quiet" onClick={() => void copy(items[k]!.body)}>{copied ? x.copied : x.copy}</button></div>}
            </div>
          ))}
        </>
      )}
    </section>
  );
}

interface Risk { id: string; name: string; stage: string; value: number | null; days: number; overdue: number; reasons: string[] }

/** Stuck records for the current pipeline, plus the company switch for the assistant. */
export function AttentionPanel({ pipelineId, call, locale, onOpenBox, onClose }: { pipelineId: string; call: Call; locale: Locale; onOpenBox: (id: string) => void; onClose: () => void }) {
  const dlg = useDialogFocus<HTMLElement>();
  const x = X[locale];
  const [risks, setRisks] = useState<Risk[] | null>(null);
  const [s, setS] = useState<Settings | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    call('GET', `/v1/pipelines/${pipelineId}/at-risk`).then((r) => setRisks(r.risks), (e) => setErr((e as Error).message));
    call('GET', '/v1/ai/settings').then(setS, () => undefined);
  }, [call, pipelineId]);
  const save = async (enabled: boolean, includeEmail: boolean) => { setErr(''); try { setS(await call('PUT', '/v1/ai/settings', { enabled, includeEmail })); } catch (e) { setErr((e as Error).message); } };
  return (
    <aside ref={dlg} tabIndex={-1} class="drawer wide" role="dialog" aria-label={x.title}>
      <h2>{x.title}</h2>
      <p class="muted">{x.help}</p>
      {err && <p class="err" role="alert">{err}</p>}
      {risks && risks.length === 0 && <p class="muted">{x.none}</p>}
      {(risks ?? []).map((r) => (
        <button class="ev riskrow" key={r.id} onClick={() => onOpenBox(r.id)}>
          <strong>{r.name}</strong> <small class="muted">{r.stage} · {x.days(r.days)}{r.value ? ` · ${r.value.toLocaleString(locale)}` : ''}</small>
          <div>{r.reasons.map((k) => <span class="chip">{x.why[k] ?? k}</span>)}</div>
        </button>
      ))}
      {s && (s.canChange || s.enabled) && (
        <>
          <h3>{x.adminTitle}</h3>
          <p class="muted">{x.adminHelp}</p>
          {!s.available && <p class="muted">{x.unavailable}</p>}
          {s.canChange && (
            <>
              <label class="check"><input type="checkbox" checked={s.enabled} onChange={(e) => void save((e.target as HTMLInputElement).checked, s.includeEmail)} /> {x.enable}</label>
              <label class="check"><input type="checkbox" disabled={!s.enabled} checked={s.includeEmail} onChange={(e) => void save(s.enabled, (e.target as HTMLInputElement).checked)} /> {x.email}</label>
            </>
          )}
        </>
      )}
      <div class="actions"><button class="btn quiet" onClick={onClose}>{x.close}</button></div>
    </aside>
  );
}
