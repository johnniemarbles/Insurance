// Voice, part 1: a microphone button that turns speech into text the person checks before anything is sent, a
// dictation card that turns a spoken note into a note and suggested tasks to review, and a speaker button that reads
// text aloud with the device's own voices (no text leaves the device). Everything hides when the server has
// VOICE_ENABLED off (the settings call answers 404). The microphone also needs the company's AI switch.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Locale } from './types.ts';
import { localVoice, micRoute, speakable } from './voice-text.ts';

type Call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<any>;
export interface VoiceSettings { readAloud: boolean; speak: boolean; maxSeconds: number }
type Purpose = 'question' | 'note' | 'task' | 'letter';

const V = {
  en: {
    speak: 'Speak', stop: (s: string) => `Stop ${s}`, working: 'Turning speech into text…', speakHelp: 'Speak, then check the words before sending. Recordings are not kept.',
    denied: 'PII cannot use the microphone. Allow it for this site in the browser, then try again.', noMic: 'No microphone was found.',
    short: 'That was too short. Press Speak, talk, then press Stop.', unsupported: 'This browser cannot record audio.',
    inWindow: 'Speak in the small PII window. Your words come back here.', popupBlocked: 'Chrome blocked the PII voice window. Allow pop-ups for this site, then press Speak again.',
    listen: 'Listen', stopListen: 'Stop', dictate: 'Dictate a note', dictateHelp: 'Speak your note. PII writes it out and suggests tasks; nothing is saved until you press Save. Use your own voice only: to record a client, use Meeting notes.',
    draft: 'Writing the note…', note: 'Note', tasks: 'Suggested tasks', due: 'due', save: 'Save note and tasks', discard: 'Discard', saved: (n: number) => `Note saved${n ? ` with ${n} task${n === 1 ? '' : 's'}` : ''}.`,
    noDraft: 'The note could not be tidied, so here are your words as spoken. You can still edit and save them.',
  },
  'fr-CA': {
    speak: 'Parler', stop: (s: string) => `Arrêter ${s}`, working: 'Transcription en cours…', speakHelp: 'Parlez, puis vérifiez les mots avant d’envoyer. Les enregistrements ne sont pas conservés.',
    denied: 'PII ne peut pas utiliser le microphone. Autorisez-le pour ce site dans le navigateur, puis réessayez.', noMic: 'Aucun microphone trouvé.',
    short: 'C’était trop court. Appuyez sur Parler, parlez, puis sur Arrêter.', unsupported: 'Ce navigateur ne peut pas enregistrer de son.',
    inWindow: 'Parlez dans la petite fenêtre PII. Vos mots reviendront ici.', popupBlocked: 'Chrome a bloqué la fenêtre vocale PII. Autorisez les fenêtres surgissantes pour ce site, puis appuyez de nouveau sur Parler.',
    listen: 'Écouter', stopListen: 'Arrêter', dictate: 'Dicter une note', dictateHelp: 'Dictez votre note. PII la rédige et suggère des tâches; rien n’est enregistré avant que vous appuyiez sur Enregistrer. Votre voix seulement : pour enregistrer un client, utilisez Notes de rencontre.',
    draft: 'Rédaction de la note…', note: 'Note', tasks: 'Tâches suggérées', due: 'échéance', save: 'Enregistrer la note et les tâches', discard: 'Annuler', saved: (n: number) => `Note enregistrée${n ? ` avec ${n} tâche${n === 1 ? '' : 's'}` : ''}.`,
    noDraft: 'La note n’a pas pu être mise au propre; voici vos mots tels que dits. Vous pouvez les modifier et les enregistrer.',
  },
};
const tx = (l: Locale) => V[l === 'fr-CA' ? 'fr-CA' : 'en'];

// One settings call per page load, shared by every button.
let cached: { call: Call; p: Promise<VoiceSettings | null> } | null = null;
export function useVoice(call: Call): VoiceSettings | null {
  const [s, setS] = useState<VoiceSettings | null>(null);
  useEffect(() => {
    let live = true;
    if (!cached || cached.call !== call) cached = { call, p: call('GET', '/v1/voice/settings').then((r) => r as VoiceSettings, () => null) };
    void cached.p.then((r) => { if (live) setS(r); });
    return () => { live = false; };
  }, [call]);
  return s;
}

const RECORD_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/ogg'];
const pickType = () => (typeof MediaRecorder === 'undefined' ? null : RECORD_TYPES.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? '');
const b64 = async (b: Blob) => { const u = new Uint8Array(await b.arrayBuffer()); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Press to record, press again to stop (stops by itself at the limit); the words come back through onText. */
export function MicButton({ call, locale, purpose, boxId, onText, disabled }: { call: Call; locale: Locale; purpose: Purpose; boxId?: string; onText: (text: string) => void; disabled?: boolean }) {
  const t = tx(locale);
  const v = useVoice(call);
  const [state, setState] = useState<'idle' | 'rec' | 'busy' | 'window'>('idle');
  const [secs, setSecs] = useState(0);
  const [err, setErr] = useState('');
  const rec = useRef<{ r: MediaRecorder; stream: MediaStream; started: number; timer: number } | null>(null);
  const win = useRef<(() => void) | null>(null);
  useEffect(() => () => { const c = rec.current; if (c) { clearInterval(c.timer); c.stream.getTracks().forEach((k) => k.stop()); } win.current?.(); }, []);
  // Where to record: here; or, inside Gmail when the frame may not use the microphone, in a small PII window.
  const route = micRoute({ host: location.hostname, framed: window.parent !== window, policyAllows: (document as unknown as { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy?.allowsFeature('microphone') });
  if (!v?.speak || route === 'none') return null;
  const max = v.maxSeconds || 60;

  const send = async (dataBase64: string, mime: string, seconds: number) => {
    setState('busy');
    try {
      const res = await call('POST', '/v1/voice/transcribe', { mime: mime || 'audio/webm', dataBase64, seconds, purpose, language: locale === 'fr-CA' ? 'fr-CA' : 'en', ...(boxId ? { boxId } : {}) });
      onText(String(res.text ?? ''));
    } catch (e) { setErr((e as Error).message); } finally { setState('idle'); }
  };

  // The PII voice window records and hands the audio back to this page (same site only); this page sends it, signed in as usual.
  const startWindow = () => {
    setErr('');
    const id = Array.from(crypto.getRandomValues(new Uint8Array(12)), (x) => x.toString(16).padStart(2, '0')).join('');
    const w = window.open(`/voice-recorder?id=${id}&lang=${locale === 'fr-CA' ? 'fr-CA' : 'en'}&max=${max}`, `pii-voice-${id}`, 'popup,width=440,height=320');
    if (!w) { setErr(t.popupBlocked); return; }
    const done = () => { window.removeEventListener('message', onMsg); clearInterval(poll); win.current = null; };
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { pii?: string; id?: string; mime?: string; data?: string; seconds?: number } | null;
      if (e.origin !== location.origin || e.source !== w || d?.pii !== 'voice-audio' || d.id !== id || typeof d.data !== 'string') return;
      done();
      if ((d.seconds ?? 0) < 1) { setState('idle'); setErr(t.short); return; }
      void send(d.data, String(d.mime ?? ''), Math.min(max, Math.round(Number(d.seconds) || 0)));
    };
    const poll = window.setInterval(() => { if (w.closed) { done(); setState((st) => (st === 'window' ? 'idle' : st)); } }, 500);
    window.addEventListener('message', onMsg);
    win.current = () => { done(); if (!w.closed) w.close(); };
    setState('window');
  };

  const stop = () => { const c = rec.current; if (c && c.r.state === 'recording') c.r.stop(); };
  const start = async () => {
    setErr('');
    const type = pickType();
    if (type === null || !navigator.mediaDevices?.getUserMedia) { setErr(t.unsupported); return; }
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) { setErr((e as DOMException).name === 'NotFoundError' ? t.noMic : t.denied); return; }
    const r = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    r.onstop = async () => {
      const c = rec.current; rec.current = null;
      if (c) { clearInterval(c.timer); stream.getTracks().forEach((k) => k.stop()); }
      const seconds = Math.min(max, Math.round((Date.now() - (c?.started ?? Date.now())) / 1000));
      const blob = new Blob(chunks, { type: r.mimeType || type || 'audio/webm' });
      if (seconds < 1 || blob.size < 200) { setState('idle'); setErr(t.short); return; }
      await send(await b64(blob), blob.type, seconds);
    };
    const started = Date.now();
    const timer = window.setInterval(() => { const s = Math.round((Date.now() - started) / 1000); setSecs(s); if (s >= max) stop(); }, 250);
    rec.current = { r, stream, started, timer };
    setSecs(0); setState('rec');
    r.start();
  };

  return (
    <span class="mic-wrap">
      <button type="button" class={`mic${state === 'rec' || state === 'window' ? ' on' : ''}`} aria-pressed={state === 'rec' || state === 'window'} disabled={disabled || state === 'busy'} title={t.speakHelp}
        onClick={() => (state === 'rec' ? stop() : state === 'window' ? win.current?.() : route === 'window' ? startWindow() : void start())}>
        <span aria-hidden="true">{state === 'rec' || state === 'window' ? '■' : '🎤'}</span> {state === 'rec' ? t.stop(`${clock(secs)} / ${clock(max)}`) : state === 'window' ? t.stop('').trim() : t.speak}
      </button>
      {state === 'busy' && <span class="muted mic-note" role="status">{t.working}</span>}
      {state === 'window' && <span class="muted mic-note" role="status">{t.inWindow}</span>}
      {err && <span class="err mic-note" role="alert">{err}</span>}
    </span>
  );
}

/** Reads text aloud on the device; hidden when the device has no local voice for the language. */
export function SpeakButton({ call, locale, text }: { call: Call; locale: Locale; text: string }) {
  const t = tx(locale);
  const v = useVoice(call);
  const [voice, setVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (typeof speechSynthesis === 'undefined') return;
    const pick = () => setVoice(localVoice(speechSynthesis.getVoices(), locale));
    pick();
    speechSynthesis.addEventListener?.('voiceschanged', pick);
    return () => { speechSynthesis.removeEventListener?.('voiceschanged', pick); speechSynthesis.cancel(); };
  }, [locale]);
  useEffect(() => () => { if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel(); }, [text]);
  if (!v?.readAloud || !voice || !text.trim()) return null;
  const toggle = () => {
    if (on) { speechSynthesis.cancel(); setOn(false); return; }
    const u = new SpeechSynthesisUtterance(speakable(text));
    u.voice = voice; u.lang = voice.lang;
    u.onend = () => setOn(false); u.onerror = () => setOn(false);
    speechSynthesis.cancel(); speechSynthesis.speak(u); setOn(true);
  };
  return <button type="button" class={`mic speak${on ? ' on' : ''}`} aria-pressed={on} onClick={toggle}><span aria-hidden="true">{on ? '■' : '🔊'}</span> {on ? t.stopListen : t.listen}</button>;
}

const inDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

/** On a deal: speak a note; review the tidied note and suggested tasks; save through the usual note and task routes. */
export function DictateNote({ call, locale, boxId, onSaved }: { call: Call; locale: Locale; boxId: string; onSaved?: () => void }) {
  const t = tx(locale);
  const v = useVoice(call);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [plain, setPlain] = useState(false);
  const [tasks, setTasks] = useState<{ title: string; dueInDays: number | null; keep: boolean }[]>([]);
  const [saved, setSaved] = useState<number | null>(null);
  if (!v?.speak) return null;
  const heard = async (text: string) => {
    if (!text.trim()) return;
    setBusy(true); setErr(''); setSaved(null); setPlain(false);
    try {
      const d = await call('POST', '/v1/voice/note-draft', { boxId, text, language: locale === 'fr-CA' ? 'fr-CA' : 'en' });
      setNote(d.note); setTasks((d.tasks ?? []).map((k: { title: string; dueInDays: number | null }) => ({ ...k, keep: true })));
    } catch { setNote(text); setTasks([]); setPlain(true); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!note?.trim()) return;
    setErr('');
    try {
      await call('POST', `/v1/boxes/${boxId}/notes`, { body: note.trim() });
      const keep = tasks.filter((k) => k.keep && k.title.trim());
      for (const k of keep) await call('POST', `/v1/boxes/${boxId}/tasks`, { title: k.title.trim(), ...(k.dueInDays != null ? { dueAt: new Date(`${inDays(k.dueInDays)}T09:00:00`).toISOString() } : {}) });
      setSaved(keep.length); setNote(null); setTasks([]); onSaved?.();
    } catch (e) { setErr((e as Error).message); }
  };
  const row = { display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 400 } as const;
  const cb = { width: 'auto', margin: 0, minHeight: 0 } as const;
  return (
    <section class="rec-form dictate" aria-label={t.dictate}>
      <div class="dictate-h"><h3>{t.dictate}</h3><MicButton call={call} locale={locale} purpose="note" boxId={boxId} onText={(s) => void heard(s)} disabled={busy} /></div>
      <p class="muted">{t.dictateHelp}</p>
      {busy && <p class="muted" role="status">{t.draft}</p>}
      {err && <p class="err" role="alert">{err}</p>}
      {saved != null && note === null && <p role="status" class="hcard" style={{ borderColor: 'var(--ok)' }}>{t.saved(saved)}</p>}
      {note !== null && (
        <div>
          {plain && <p class="muted" style={{ fontSize: '12.5px' }}>{t.noDraft}</p>}
          <label>{t.note}</label>
          <textarea aria-label={t.note} rows={4} value={note} onInput={(e) => setNote((e.target as HTMLTextAreaElement).value)} />
          {tasks.length > 0 && <fieldset style={{ border: 0, padding: 0, margin: '8px 0' }}><legend style={{ fontSize: '13px', fontWeight: 600 }}>{t.tasks}</legend>
            {tasks.map((k, i) => <label key={i} style={row}><input type="checkbox" style={cb} checked={k.keep} onChange={() => setTasks(tasks.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)))} />{k.title}{k.dueInDays != null ? <span class="muted"> · {t.due} {inDays(k.dueInDays)}</span> : null}</label>)}
          </fieldset>}
          <div class="actions">
            <button type="button" class="btn" disabled={!note.trim()} onClick={() => void save()}>{t.save}</button>
            <button type="button" class="btn quiet" onClick={() => { setNote(null); setTasks([]); }}>{t.discard}</button>
          </div>
        </div>
      )}
    </section>
  );
}
