/** A minimal text-completion client. The real one calls Anthropic's Messages API; tests inject a fake. */
export interface AiClient {
  readonly model: string;
  complete(input: { system: string; user: string; maxTokens: number }): Promise<string>;
  /** Speech to text, for providers that take audio (OpenAI, Gemini). The audio is sent once and never stored by PII. */
  transcribe?(input: { audio: Buffer; mime: string; language?: string }): Promise<string>;
  /** Reads images with a text prompt (Gemini only, used for the driver's licence check). Images are sent once, never stored. */
  see?(input: { system: string; user: string; images: { mime: string; data: Buffer }[]; maxTokens: number }): Promise<string>;
}

/** Audio types a meeting recording may be, and their usual file extension. */
export const AUDIO_TYPES: Record<string, string> = { 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/webm': 'webm', 'audio/ogg': 'ogg' };
const TRANSCRIBE_DEFAULT = { openai: 'gpt-4o-mini-transcribe' };

function openaiTranscriber(apiKey: string, env: Record<string, string | undefined> = process.env) {
  const model = (env.AI_TRANSCRIBE_MODEL_OPENAI ?? '').trim() || TRANSCRIBE_DEFAULT.openai;
  return async ({ audio, mime, language }: { audio: Buffer; mime: string; language?: string }) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type: mime }), `meeting.${AUDIO_TYPES[mime] ?? 'mp3'}`);
    form.append('model', model);
    if (language) form.append('language', language.slice(0, 2));
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { authorization: `Bearer ${apiKey}` }, body: form, signal: AbortSignal.timeout(300_000) });
    if (!res.ok) throw new Error(`Transcription service answered ${res.status}`);
    return (((await res.json()) as { text?: string }).text ?? '').trim();
  };
}
function geminiTranscriber(apiKey: string, model: string) {
  return async ({ audio, mime }: { audio: Buffer; mime: string }) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Transcribe this recording word for word. Label speakers as Speaker 1, Speaker 2. Output only the transcript.' }, { inlineData: { mimeType: mime, data: audio.toString('base64') } }] }], generationConfig: { maxOutputTokens: 8192 } }),
      signal: AbortSignal.timeout(300_000),
    });
    if (!res.ok) throw new Error(`Transcription service answered ${res.status}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  };
}

function geminiSeer(apiKey: string, model: string) {
  return async ({ system, user, images, maxTokens }: { system: string; user: string; images: { mime: string; data: Buffer }[]; maxTokens: number }) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }, ...images.map((i) => ({ inlineData: { mimeType: i.mime, data: i.data.toString('base64') } }))] }],
        generationConfig: { maxOutputTokens: maxTokens, responseMimeType: 'application/json' } }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`AI service answered ${res.status}`);
    const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
  };
}

export const AI_PROVIDERS = ['anthropic', 'openai', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];

/** Sensible defaults when no model is set. Prefer setting AI_MODEL_<PROVIDER> explicitly in each environment. */
const ANTHROPIC_DEFAULT = 'claude-sonnet-5-5';
const OPENAI_DEFAULT = 'gpt-4.1-mini';
const GEMINI_DEFAULT = 'gemini-2.5-flash';
const DEFAULTS: Record<AiProvider, string> = { anthropic: ANTHROPIC_DEFAULT, openai: OPENAI_DEFAULT, gemini: GEMINI_DEFAULT };
const MODEL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/;

/** Reject garbage or injection-looking model ids before they hit a provider. */
export function resolveAiModel(env: Record<string, string | undefined>, provider: 'anthropic' | 'openai'): string {
  const raw = (env.AI_MODEL ?? '').trim();
  if (raw) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/.test(raw)) {
      throw new Error('AI_MODEL has an invalid format');
    }
    return raw;
  }
  return provider === 'anthropic' ? ANTHROPIC_DEFAULT : OPENAI_DEFAULT;
}

export function anthropicClient(apiKey: string, model: string): AiClient {
  return {
    model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`AI service answered ${res.status}`);
      const j = (await res.json()) as { content?: { type: string; text?: string }[] };
      return (j.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('').trim();
    },
  };
}

/** The same interface over OpenAI's Chat Completions API, for a deployment that has an OpenAI key instead. */
export function openaiClient(apiKey: string, model: string): AiClient {
  return {
    model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, max_completion_tokens: maxTokens, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`AI service answered ${res.status}`);
      const j = (await res.json()) as { choices?: { message?: { content?: string | null } }[] };
      return (j.choices?.[0]?.message?.content ?? '').trim();
    },
  };
}

/** Google Gemini through its generateContent API. */
export function geminiClient(apiKey: string, model: string): AiClient {
  return {
    model,
    async complete({ system, user, maxTokens }) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`AI service answered ${res.status}`);
      const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      return (j.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('').trim();
    },
  };
}

/** A client for one provider with a given key (PII's own key, or a partner's). */
export function makeAiClient(provider: AiProvider, apiKey: string, model: string): AiClient {
  if (provider === 'anthropic') return anthropicClient(apiKey, model); // Anthropic takes no audio: no transcribe
  if (provider === 'openai') return { ...openaiClient(apiKey, model), transcribe: openaiTranscriber(apiKey) };
  return { ...geminiClient(apiKey, model), transcribe: geminiTranscriber(apiKey, model), see: geminiSeer(apiKey, model) };
}

/** The model for a provider: AI_MODEL_<PROVIDER>, then that provider's default. Invalid ids are refused. */
export function modelFor(env: Record<string, string | undefined>, provider: AiProvider): string {
  const raw = (env[`AI_MODEL_${provider.toUpperCase()}`] ?? '').trim();
  if (raw && !MODEL_ID.test(raw)) throw new Error(`AI_MODEL_${provider.toUpperCase()} has an invalid format`);
  return raw || DEFAULTS[provider];
}

/** Does a pasted key look like one for this provider? (A format check only; the first call proves it works.) */
export function keyLooksRight(provider: AiProvider, key: string): boolean {
  const k = key.trim();
  if (k.length < 20 || k.length > 300 || /\s/.test(k)) return false;
  return provider === 'anthropic' ? k.startsWith('sk-ant-') : provider === 'openai' ? k.startsWith('sk-') : k.startsWith('AIza');
}

/** PII's own clients, one per provider whose key is set (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY). */
export function aiProvidersFromEnv(env: Record<string, string | undefined> = process.env): Partial<Record<AiProvider, AiClient>> {
  const out: Partial<Record<AiProvider, AiClient>> = {};
  // Local acceptance runs only (APP_ENV=dev): stand-in providers that answer from the first record or passage they are given, citing it.
  if (env.AI_FAKE_PROVIDERS === '1' && env.APP_ENV === 'dev') {
    for (const p of AI_PROVIDERS) {
      out[p] = { model: `fake-${p}`, complete: async ({ user }) => {
        if (user.includes('<transcript>')) return JSON.stringify({ summary: 'Raj wants to review his life cover after the mortgage renewal.', followUps: [{ title: 'Send Raj the term 20 quote', dueInDays: 3 }], needsChanges: ['Mortgage balance is now 480,000'], complianceNotes: ['Recording consent confirmed at the start of the call'] });
        const m = /\[([CRA]1)\] ([^\n]+)/.exec(user); return m ? `From your records: ${m[2]!.slice(0, 160)} [${m[1]}]` : 'Nothing found.'; } };
      if (p !== 'anthropic') out[p]!.transcribe = async () => 'Speaker 1: Thanks for meeting, Raj. Speaker 2: I renewed my mortgage and want to check my life cover.';
      // The licence check: always reads Raj Singh, born 1980-04-12; an image under 1 KB reads as unclear.
      if (p === 'gemini') out[p]!.see = async ({ images }) => {
        const clear = images.every((i) => i.data.length >= 1024);
        return JSON.stringify({ isDriversLicence: true, issuingRegion: 'CA-ON', fullName: clear ? 'RAJ KUMAR SINGH' : null, dateOfBirth: clear ? '1980-04-12' : null, expiryDate: '2030-06-30', looksGenuine: clear, selfieMatches: clear ? 'yes' : 'unclear', concerns: clear ? [] : ['The photo is too small to read'] });
      };
    }
    return out;
  }
  const keys: Record<AiProvider, string | undefined> = { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY, gemini: env.GEMINI_API_KEY };
  for (const p of AI_PROVIDERS) {
    if (!keys[p]) continue;
    try { out[p] = makeAiClient(p, keys[p]!, modelFor(env, p)); } catch (err) { console.warn(`AI provider ${p} disabled:`, (err as Error).message); }
  }
  return out;
}

/** Anthropic if its key is set, else OpenAI if that key is set, else no AI (the AI features answer 503). */
export function aiFromEnv(env: Record<string, string | undefined> = process.env): AiClient | undefined {
  try {
    if (env.ANTHROPIC_API_KEY) return anthropicClient(env.ANTHROPIC_API_KEY, resolveAiModel(env, 'anthropic'));
    if (env.OPENAI_API_KEY) return openaiClient(env.OPENAI_API_KEY, resolveAiModel(env, 'openai'));
  } catch (err) {
    console.warn('AI disabled:', (err as Error).message);
    return undefined;
  }
  return undefined;
}
