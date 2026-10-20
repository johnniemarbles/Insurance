/** A minimal text-completion client. The real one calls Anthropic's Messages API; tests inject a fake. */
export interface AiClient {
  readonly model: string;
  complete(input: { system: string; user: string; maxTokens: number }): Promise<string>;
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
  return provider === 'anthropic' ? anthropicClient(apiKey, model) : provider === 'openai' ? openaiClient(apiKey, model) : geminiClient(apiKey, model);
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
  // Local acceptance runs only (APP_ENV=dev): stand-in providers that answer from the records they are given, citing [C1].
  if (env.AI_FAKE_PROVIDERS === '1' && env.APP_ENV === 'dev') {
    for (const p of AI_PROVIDERS) out[p] = { model: `fake-${p}`, complete: async ({ user }) => { const first = /\[C1\] ([^\n]+)/.exec(user)?.[1]; return first ? `From your records: ${first.slice(0, 160)} [C1]` : 'Nothing found.'; } };
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
