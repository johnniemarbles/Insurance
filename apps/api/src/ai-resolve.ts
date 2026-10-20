// Which AI client answers for this person: their partner's own key when the company allows partner keys and one is
// set, otherwise PII's own key for the provider the company chose, otherwise the server's default client (the
// behaviour before providers could be chosen). Keys are decrypted only here, for the one call, and never returned.
import type { RequestContext } from '@pii/domain';
import { open, type KeyProvider } from '@pii/platform';
import type { Tx } from '@pii/db';
import { makeAiClient, modelFor, type AiClient, type AiProvider } from './ai.ts';

export interface AiDeps {
  ai?: AiClient;
  aiProviders?: Partial<Record<AiProvider, AiClient>>;
  aiFactory?: (provider: AiProvider, apiKey: string) => AiClient;
  keys?: KeyProvider;
}
export interface ResolvedAi { client: AiClient; provider: AiProvider | 'default'; source: 'pii' | 'partner' }

export const keyAad = (tenantId: string, nodeId: string) => `${tenantId}:${nodeId}:ai-partner-key`;

export async function aiSettings(tx: Tx): Promise<{ enabled: boolean; includeEmail: boolean; partnersEnabled: boolean; provider: AiProvider | null; allowPartnerKeys: boolean }> {
  const r = (await tx.query<{ enabled: boolean; include_email: boolean; partners_enabled: boolean; provider: AiProvider | null; allow_partner_keys: boolean }>(
    'SELECT enabled, include_email, partners_enabled, provider, allow_partner_keys FROM tenant_ai')).rows[0];
  return { enabled: r?.enabled ?? false, includeEmail: r?.include_email ?? false, partnersEnabled: r?.partners_enabled ?? false, provider: r?.provider ?? null, allowPartnerKeys: r?.allow_partner_keys ?? false };
}

/** The active partner key this person may use (their own partner's), if any. Never decrypted here. */
export async function partnerKeyFor(tx: Tx, ctx: RequestContext): Promise<{ id: string; node_id: string; provider: AiProvider; last4: string; created_at: Date; key_enc: Buffer; key_id: string } | null> {
  const r = await tx.query<{ id: string; node_id: string; provider: AiProvider; last4: string; created_at: Date; key_enc: Buffer; key_id: string }>(
    `SELECT id, node_id, provider, last4, created_at, key_enc, key_id FROM ai_partner_keys
      WHERE revoked_at IS NULL AND node_id = ANY ($1::uuid[]) ORDER BY array_position($1::uuid[], node_id) LIMIT 1`, [ctx.nodeIds]);
  return r.rows[0] ?? null;
}

export async function resolveAi(tx: Tx, ctx: RequestContext, deps: AiDeps): Promise<ResolvedAi | null> {
  const s = await aiSettings(tx);
  if (s.allowPartnerKeys && deps.keys) {
    const k = await partnerKeyFor(tx, ctx);
    if (k) {
      const key = open(deps.keys, { keyId: k.key_id, data: k.key_enc }, keyAad(ctx.tenantId, k.node_id)).toString('utf8');
      const client = deps.aiFactory ? deps.aiFactory(k.provider, key) : makeAiClient(k.provider, key, modelFor(process.env, k.provider));
      return { client, provider: k.provider, source: 'partner' };
    }
  }
  if (s.provider) {
    const c = deps.aiProviders?.[s.provider];
    if (c) return { client: c, provider: s.provider, source: 'pii' };
    return null; // the company chose a provider this server has no key for: say so rather than quietly using another
  }
  return deps.ai ? { client: deps.ai, provider: 'default', source: 'pii' } : null;
}
