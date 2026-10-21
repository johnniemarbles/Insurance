// Co-pilot settings (roadmap Phase 1): the company's AI provider and whether partners may use their own key (company
// admins), and a partner's own key (partner admins). Shown only when the server has COPILOT_ENABLED on: a 404 from
// the first call hides it. A key is never shown back, only its last four characters.
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { MicButton, SpeakButton } from './voice.tsx';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
type Provider = 'anthropic' | 'openai' | 'gemini';
export interface CopilotSettings {
  enabled: boolean; allowedForMe: boolean; provider: Provider | null; providersAvailable: Provider[]; allowPartnerKeys: boolean;
  myKey: { provider: Provider; last4: string; createdAt: string; yours: boolean } | null; canSetKey: boolean; canChange: boolean;
  using: { provider: Provider | 'default'; source: 'pii' | 'partner'; model: string } | null;
}
const NAMES: Record<string, string> = { anthropic: 'Anthropic (Claude)', openai: 'OpenAI', gemini: 'Google Gemini', default: 'PII default' };
const X = {
  en: {
    title: 'AI co-pilot', help: 'Which AI service answers questions in PII. It only ever sees the records the person asking can see.',
    provider: 'AI provider (PII\'s key)', serverDefault: 'Server default', allow: 'Let partners use their own AI key instead',
    allowHelp: 'With their own key, a partner\'s questions and client records go to that partner\'s AI account. They accept the same terms.',
    using: (p: string, s: string) => `In use for you: ${p}, ${s === 'partner' ? 'your partner\'s own key' : 'PII\'s key'}`,
    keyTitle: 'Your own AI key', keyHelp: 'Your company allows partners to use their own key. It is stored encrypted and never shown again.',
    keyNow: (p: string, l: string) => `${p} key ending ${l} is in use.`, keyBy: 'Set by your partner administrator.', paste: 'Paste the key', save: 'Save key', remove: 'Stop using this key',
    noProviders: 'No AI provider keys are set up on this server yet.',
  },
  'fr-CA': {
    title: 'Copilote IA', help: 'Le service d’IA qui répond aux questions dans PII. Il ne voit que les dossiers que la personne qui pose la question peut voir.',
    provider: 'Fournisseur d’IA (clé de PII)', serverDefault: 'Valeur par défaut du serveur', allow: 'Permettre aux partenaires d’utiliser leur propre clé d’IA',
    allowHelp: 'Avec leur propre clé, les questions et les dossiers clients d’un partenaire vont au compte d’IA de ce partenaire. Il accepte les mêmes conditions.',
    using: (p: string, s: string) => `Utilisé pour vous : ${p}, ${s === 'partner' ? 'clé de votre partenaire' : 'clé de PII'}`,
    keyTitle: 'Votre propre clé d’IA', keyHelp: 'Votre entreprise permet aux partenaires d’utiliser leur propre clé. Elle est chiffrée et n’est jamais réaffichée.',
    keyNow: (p: string, l: string) => `La clé ${p} se terminant par ${l} est utilisée.`, keyBy: 'Définie par l’administrateur de votre partenaire.', paste: 'Collez la clé', save: 'Enregistrer la clé', remove: 'Ne plus utiliser cette clé',
    noProviders: 'Aucune clé de fournisseur d’IA n’est configurée sur ce serveur.',
  },
};

export function useCopilot(call: Call): [CopilotSettings | null, () => void] {
  const [s, setS] = useState<CopilotSettings | null>(null);
  const load = useCallback(() => { call('GET', '/v1/copilot/settings').then(setS, () => setS(null)); }, [call]);
  useEffect(() => { load(); }, [load]);
  return [s, load];
}

/** Settings card: company admins pick the provider; partner admins set their own key when allowed. */
export function CopilotCard({ call, locale }: { call: Call; locale: Locale }) {
  const x = X[locale] ?? X.en;
  const [s, reload] = useCopilot(call);
  const [err, setErr] = useState('');
  const [prov, setProv] = useState<Provider>('anthropic');
  const [key, setKey] = useState('');
  if (!s || (!s.canChange && !s.canSetKey && !s.myKey)) return null;
  const act = async (fn: () => Promise<unknown>) => { setErr(''); try { await fn(); setKey(''); reload(); } catch (e) { setErr((e as Error).message); } };
  return (
    <section class="srow" aria-label={x.title}>
      <div class="srow-h"><strong>{x.title}</strong></div>
      <p class="muted">{x.help}</p>
      {err && <p class="err" role="alert">{err}</p>}
      {s.canChange && (
        <>
          {s.providersAvailable.length === 0 && <p class="muted">{x.noProviders}</p>}
          <label>{x.provider}</label>
          <select aria-label={x.provider} value={s.provider ?? ''} onChange={(e) => void act(() => call('PUT', '/v1/copilot/settings', { provider: (e.target as HTMLSelectElement).value || null, allowPartnerKeys: s.allowPartnerKeys }))}>
            <option value="">{x.serverDefault}</option>
            {s.providersAvailable.map((p) => <option key={p} value={p}>{NAMES[p]}</option>)}
          </select>
          <label class="check"><input type="checkbox" checked={s.allowPartnerKeys} onChange={(e) => void act(() => call('PUT', '/v1/copilot/settings', { provider: s.provider, allowPartnerKeys: (e.target as HTMLInputElement).checked }))} /> {x.allow}</label>
          <p class="muted" style={{ fontSize: '12.5px' }}>{x.allowHelp}</p>
        </>
      )}
      {s.using && <p class="muted" role="status">{x.using(NAMES[s.using.provider] ?? s.using.provider, s.using.source)}</p>}
      {(s.canSetKey || s.myKey) && (
        <div class="hcard" style={{ marginTop: '8px' }}>
          <strong>{x.keyTitle}</strong>
          <p class="muted" style={{ fontSize: '12.5px', margin: '4px 0' }}>{x.keyHelp}</p>
          {s.myKey && <p>{x.keyNow(NAMES[s.myKey.provider]!, s.myKey.last4)} {!s.canSetKey && <span class="muted">{x.keyBy}</span>}</p>}
          {s.canSetKey && (
            <>
              <select aria-label={x.provider} value={prov} onChange={(e) => setProv((e.target as HTMLSelectElement).value as Provider)}>
                {(['anthropic', 'openai', 'gemini'] as Provider[]).map((p) => <option key={p} value={p}>{NAMES[p]}</option>)}
              </select>
              <input aria-label={x.paste} type="password" autoComplete="off" placeholder={x.paste} value={key} onInput={(e) => setKey((e.target as HTMLInputElement).value)} />
              <div class="actions">
                <button type="button" class="btn" disabled={key.trim().length < 20} onClick={() => void act(() => call('PUT', '/v1/copilot/my-key', { provider: prov, apiKey: key.trim() }))}>{x.save}</button>
                {s.myKey && <button type="button" class="btn quiet" onClick={() => void act(() => call('DELETE', '/v1/copilot/my-key'))}>{x.remove}</button>}
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

const A = {
  en: { open: 'Ask PII', title: 'Ask PII', help: 'Answers come only from records you can see, with the records used listed below. Check them before acting.', ph: 'Ask about a client, a policy, renewals, your tasks…', send: 'Ask', thinking: 'Looking through your records…', used: 'Records used', records: 'My records', rulebook: 'Company rulebook', quoted: 'Passages quoted', rbHelp: 'Answers come only from your company\'s rulebook documents, quoting the section. No client records are sent.', close: 'Close', via: (p: string, s: string) => `Answered by ${p} (${s === 'partner' ? 'your partner\'s key' : 'PII\'s key'})`,
    types: { client: 'client', deal: 'deal', note: 'note', policy: 'policy', family: 'family', task: 'task' } as Record<string, string> },
  'fr-CA': { open: 'Demander à PII', title: 'Demander à PII', help: 'Les réponses viennent seulement des dossiers que vous pouvez voir; les dossiers utilisés sont listés. Vérifiez-les avant d’agir.', ph: 'Posez une question sur un client, une police, les renouvellements, vos tâches…', send: 'Demander', thinking: 'Recherche dans vos dossiers…', used: 'Dossiers utilisés', records: 'Mes dossiers', rulebook: 'Recueil de règles', quoted: 'Passages cités', rbHelp: 'Les réponses viennent seulement des documents du recueil de règles de votre entreprise, avec la section citée. Aucun dossier client n’est envoyé.', close: 'Fermer', via: (p: string, s: string) => `Réponse de ${p} (${s === 'partner' ? 'clé de votre partenaire' : 'clé de PII'})`,
    types: { client: 'client', deal: 'affaire', note: 'note', policy: 'police', family: 'famille', task: 'tâche' } as Record<string, string> },
};

/** Ask PII: a button on every page (when the co-pilot is on and set up for this person) that opens the question panel. */
export function AskPii({ call, locale }: { call: Call; locale: Locale }) {
  const x = A[locale] ?? A.en;
  const [s] = useCopilot(call);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [res, setRes] = useState<{ answer: string; citations: { ref: string; type?: string; label?: string; document?: string; section?: string | null; quote?: string }[]; provider: string; keySource: string } | null>(null);
  const [mode, setMode] = useState<'records' | 'rulebook'>('records');
  if (!s?.allowedForMe || !s.using) return null;
  const ask = async (e: Event) => {
    e.preventDefault();
    if (!q.trim() || busy) return;
    setBusy(true); setErr(''); setRes(null);
    try { setRes(await call('POST', mode === 'rulebook' ? '/v1/copilot/rulebook/ask' : '/v1/copilot/ask', { question: q.trim() })); } catch (e2) { setErr((e2 as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <button type="button" class="btn" style={{ position: 'fixed', right: '20px', bottom: '20px', top: 'auto', left: 'auto', height: 'auto', width: 'auto', zIndex: 40, boxShadow: '0 2px 10px rgba(10,31,92,.2)' }} onClick={() => setOpen(true)} aria-haspopup="dialog">{x.open}</button>
      {open && (
        <aside tabIndex={-1} class="drawer" role="dialog" aria-label={x.title} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
          <h2>{x.title}</h2>
          <p class="muted" style={{ fontSize: '12.5px' }}>{mode === 'rulebook' ? x.rbHelp : x.help}</p>
          <div class="seg" role="tablist" aria-label={x.title} style={{ margin: '0 0 8px' }}>
            <button type="button" role="tab" aria-selected={mode === 'records'} onClick={() => { setMode('records'); setRes(null); }}>{x.records}</button>
            <button type="button" role="tab" aria-selected={mode === 'rulebook'} onClick={() => { setMode('rulebook'); setRes(null); }}>{x.rulebook}</button>
          </div>
          <form onSubmit={ask}>
            <textarea aria-label={x.title} rows={3} maxLength={500} placeholder={x.ph} value={q} onInput={(e) => setQ((e.target as HTMLTextAreaElement).value)} />
            <div class="actions"><MicButton call={call} locale={locale} purpose="question" onText={(s) => setQ((cur) => (cur.trim() ? `${cur.trim()} ${s}` : s).slice(0, 500))} disabled={busy} /><button type="submit" class="btn" disabled={busy || q.trim().length < 2}>{x.send}</button></div>
          </form>
          {busy && <p class="muted" role="status">{x.thinking}</p>}
          {err && <p class="err" role="alert">{err}</p>}
          {res && (
            <section aria-label={mode === 'rulebook' ? x.quoted : x.used} class="hcard" style={{ marginTop: '8px' }}>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{res.answer}</p>
              <SpeakButton call={call} locale={locale} text={res.answer} />
              {res.citations.length > 0 && (
                <>
                  <h3 style={{ fontSize: '13px', margin: '10px 0 4px' }}>{mode === 'rulebook' ? x.quoted : x.used}</h3>
                  <ul class="maplist">{res.citations.map((c) => c.document
                    ? <li key={c.ref}>[{c.ref}] <strong>{c.document}</strong>{c.section ? ` › ${c.section}` : ''}<div class="muted" style={{ fontSize: '12.5px' }}>“{c.quote}”</div></li>
                    : <li key={c.ref}>[{c.ref}] {c.label} <span class="muted">· {x.types[c.type ?? ''] ?? c.type}</span></li>)}</ul>
                </>
              )}
              <p class="muted" style={{ fontSize: '11.5px', margin: '8px 0 0' }}>{x.via(NAMES[res.provider] ?? res.provider, res.keySource)}</p>
            </section>
          )}
          <div class="actions"><button type="button" class="btn quiet" onClick={() => setOpen(false)}>{x.close}</button></div>
        </aside>
      )}
    </>
  );
}
