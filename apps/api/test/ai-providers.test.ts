import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiFromEnv } from '../src/ai.ts';

test('the AI provider follows the key that is set', async () => {
  assert.equal(aiFromEnv({}), undefined);
  assert.equal(aiFromEnv({ ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o' })!.model, 'claude-sonnet-5-5', 'Anthropic wins when both are set');
  const oa = aiFromEnv({ OPENAI_API_KEY: 'o' })!;
  assert.equal(oa.model, 'gpt-4.1-mini');
  const real = globalThis.fetch; let seen: { url: string; body: any; auth: string } | null = null;
  globalThis.fetch = (async (url: string, init: any) => { seen = { url, body: JSON.parse(init.body), auth: init.headers.authorization }; return new Response(JSON.stringify({ choices: [{ message: { content: ' hello ' } }] }), { status: 200 }); }) as typeof fetch;
  try {
    assert.equal(await oa.complete({ system: 's', user: 'u', maxTokens: 50 }), 'hello');
    assert.equal(seen!.url, 'https://api.openai.com/v1/chat/completions'); assert.equal(seen!.auth, 'Bearer o');
    assert.deepEqual(seen!.body.messages.map((m: any) => m.role), ['system', 'user']);
  } finally { globalThis.fetch = real; }
});
