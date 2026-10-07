/** A minimal text-completion client. The real one calls Anthropic's Messages API; tests inject a fake. */
export interface AiClient {
  readonly model: string;
  complete(input: { system: string; user: string; maxTokens: number }): Promise<string>;
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

/** Anthropic if its key is set, else OpenAI if that key is set, else no AI (the AI features answer 503). */
export function aiFromEnv(env: Record<string, string | undefined> = process.env): AiClient | undefined {
  if (env.ANTHROPIC_API_KEY) return anthropicClient(env.ANTHROPIC_API_KEY, env.AI_MODEL ?? 'claude-sonnet-5-5');
  if (env.OPENAI_API_KEY) return openaiClient(env.OPENAI_API_KEY, env.AI_MODEL ?? 'gpt-4.1-mini');
  return undefined;
}
