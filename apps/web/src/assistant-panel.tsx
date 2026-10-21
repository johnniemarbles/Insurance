// Home assistant: quick questions answered from data the app already loads. Nothing is sent to an AI service here.
// Free-form questions stay off until a company administrator turns the AI setting on (see ai.tsx).
import { useEffect, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { MicButton, SpeakButton } from './voice.tsx';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;

const T = {
  en: {
    eyebrow: 'Assistant', hi: (n: string) => `Welcome${n ? ', ' + n : ''}`, sub: 'Ask a quick question about your records.',
    expiries: 'Expiries in 30 days', waiting: 'Who is waiting?', none: 'Nothing to show.', forbidden: 'Not available for your role.',
    freeOff: 'Free-form questions are off. A company administrator can turn on the AI assistant in Settings.', loading: 'Looking…',
    expired: 'Expired', expires: 'Expires', stage: 'Stage', ask: 'Ask a question', send: 'Send', thinking: 'Thinking…', askOff: 'Free questions are off for your company.',
    sources: 'Records used', types: { client: 'client', deal: 'deal', note: 'note', policy: 'policy', family: 'family', task: 'task' } as Record<string, string>,
  },
  'fr-CA': {
    eyebrow: 'Assistant', hi: (n: string) => `Bienvenue${n ? ', ' + n : ''}`, sub: 'Posez une question rapide sur vos dossiers.',
    expiries: 'Échéances dans 30 jours', waiting: 'Qui attend?', none: 'Rien à afficher.', forbidden: 'Non disponible pour votre rôle.',
    freeOff: 'Les questions libres sont désactivées. Un administrateur peut activer l’assistant IA dans Paramètres.', loading: 'Recherche…',
    expired: 'Expiré', expires: 'Expire', stage: 'Étape', ask: 'Poser une question', send: 'Envoyer', thinking: 'Réflexion…', askOff: 'Les questions libres sont désactivées pour votre entreprise.',
    sources: 'Dossiers utilisés', types: { client: 'client', deal: 'affaire', note: 'note', policy: 'police', family: 'famille', task: 'tâche' } as Record<string, string>,
  },
} as const;

type Cite = { ref: string; type: string; label: string };
type Answer = { kind: 'list'; rows: string[] } | { kind: 'error'; text: string } | { kind: 'text'; text: string; cites?: Cite[] } | null;
type AiState = { enabled: boolean; available: boolean; copilot?: boolean } | null;

export function AssistantPanel({ call, locale, first }: { call: Call; locale: Locale; first?: string }) {
  const t = T[locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const [answer, setAnswer] = useState<Answer>(null);
  const [busy, setBusy] = useState(false);
  const [which, setWhich] = useState<'expiries' | 'waiting' | null>(null);
  const [ai, setAi] = useState<AiState>(null);
  const [question, setQuestion] = useState('');
  useEffect(() => {
    let live = true;
    // Ask PII (co-pilot) when the server has it on and it is set up for this person; otherwise the general assistant.
    void call('GET', '/v1/copilot/settings').then(
      (c) => { if (live) setAi({ enabled: c.allowedForMe === true, available: !!c.using, copilot: true }); },
      () => call('GET', '/v1/ai/settings').then((r) => { if (live) setAi({ enabled: (r.allowedForMe ?? r.enabled) === true, available: r.available === true }); }, () => { if (live) setAi({ enabled: false, available: false }); }));
    return () => { live = false; };
  }, [call]);

  const sendQuestion = async (e: Event) => {
    e.preventDefault();
    const q = question.trim();
    if (!q || busy) return;
    setBusy(true); setWhich(null); setAnswer(null);
    try {
      const r = await call('POST', ai?.copilot ? '/v1/copilot/ask' : '/v1/ai/ask', { question: q });
      setAnswer({ kind: 'text', text: r.answer, cites: r.citations });
      setQuestion('');
    } catch (e) {
      const st = (e as { status?: number }).status;
      setAnswer({ kind: 'error', text: st === 403 || !ai?.copilot ? t.askOff : (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const ask = async (q: 'expiries' | 'waiting') => {
    setWhich(q); setBusy(true); setAnswer(null);
    try {
      if (q === 'expiries') {
        const d = await call('GET', '/v1/onboarding/dashboard');
        const rows = (d.expiries ?? []).map((e: any) => `${e.partnerName} · ${e.label} · ${e.status === 'expired' ? t.expired : t.expires} ${e.expiresOn}`);
        setAnswer({ kind: 'list', rows: rows.length ? rows : [t.none] });
      } else {
        const c = await call('GET', '/v1/onboarding/cases');
        const rows = (c.cases ?? []).filter((x: any) => x.stage !== 'active').map((x: any) => `${x.partnerName} · ${t.stage}: ${x.stage}`);
        setAnswer({ kind: 'list', rows: rows.length ? rows : [t.none] });
      }
    } catch {
      setAnswer({ kind: 'error', text: t.forbidden });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="hcard asst" aria-labelledby="asst-h">
      <div class="asst-top">
        <div>
          <span class="asst-eyebrow">{t.eyebrow}</span>
          <h2 id="asst-h" class="asst-h">{t.hi(first ?? '')}</h2>
          <p class="asst-sub">{t.sub}</p>
        </div>
        <div class="asst-orb" aria-hidden="true" />
      </div>
      <div class="asst-actions" role="group" aria-label={t.eyebrow}>
        <button class={`asst-pill${which === 'expiries' ? ' on' : ''}`} onClick={() => void ask('expiries')} disabled={busy}>{t.expiries}</button>
        <button class={`asst-pill${which === 'waiting' ? ' on' : ''}`} onClick={() => void ask('waiting')} disabled={busy}>{t.waiting}</button>
      </div>
      {busy && <p class="asst-note" role="status">{t.loading}</p>}
      {answer?.kind === 'error' && <p class="asst-note" role="alert">{answer.text}</p>}
      {answer?.kind === 'list' && <ul class="asst-list">{answer.rows.map((r, i) => <li key={i}>{r}</li>)}</ul>}
      {answer?.kind === 'text' && <p class="asst-answer" style={{ whiteSpace: 'pre-wrap' }}>{answer.text}</p>}
      {answer?.kind === 'text' && <SpeakButton call={call} locale={locale} text={answer.text} />}
      {answer?.kind === 'text' && answer.cites && answer.cites.length > 0 && (
        <ul class="asst-list" aria-label={t.sources}>{answer.cites.map((c) => <li key={c.ref}>[{c.ref}] {c.label} <span class="muted">· {t.types[c.type] ?? c.type}</span></li>)}</ul>
      )}
      {ai?.enabled && ai.available ? (
        <form class="asst-ask" onSubmit={sendQuestion}>
          <label class="asst-label" for="asst-q">{t.ask}</label>
          <div class="asst-row">
            <input id="asst-q" type="text" maxLength={500} value={question} onInput={(e) => setQuestion((e.currentTarget as HTMLInputElement).value)} placeholder={t.ask} />
            <button class="asst-send" type="submit" disabled={busy || !question.trim()}>{busy ? t.thinking : t.send}</button>
          </div>
          <MicButton call={call} locale={locale} purpose="question" onText={(s) => setQuestion((cur) => (cur.trim() ? `${cur.trim()} ${s}` : s).slice(0, 500))} disabled={busy} />
        </form>
      ) : (
        <p class="asst-off">{t.freeOff}</p>
      )}
    </section>
  );
}
