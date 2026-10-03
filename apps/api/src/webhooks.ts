import { createHmac } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP } from 'node:net';
import { open as openSealed } from '@pii/platform';
import type { AppDeps } from './app.ts';

const isPrivate = (ip: string): boolean => {
  if (ip.startsWith('::ffff:')) return isPrivate(ip.slice(7));
  if (isIP(ip) === 6) { const l = ip.toLowerCase(); return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe8') || l.startsWith('fe9') || l.startsWith('fea') || l.startsWith('feb'); }
  const [a, b] = ip.split('.').map(Number) as [number, number];
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
};

/** A webhook may only point at a public https address (loopback http is allowed in tests). Returns the address to connect to. */
export async function safeTarget(raw: string, allowLocal: boolean): Promise<{ url: URL; address: string }> {
  const url = new URL(raw);
  const local = allowLocal && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'https:' && !local) throw new Error('Webhook addresses must start with https://');
  if (url.username || url.password) throw new Error('Webhook addresses cannot contain a password');
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.length === 0) throw new Error('That address does not resolve');
  if (!local && addrs.some((a) => isPrivate(a.address))) throw new Error('Webhook addresses must be public');
  return { url, address: addrs[0]!.address };
}

function post(target: { url: URL; address: string }, body: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const mod = target.url.protocol === 'https:' ? https : http;
    const req = mod.request(
      { host: target.address, port: target.url.port || undefined, path: target.url.pathname + target.url.search, method: 'POST', servername: target.url.hostname, timeout: 5000,
        headers: { ...headers, Host: target.url.host, 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(body)) } },
      (res) => { res.resume(); resolve(res.statusCode ?? 0); },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

export type WebhookEvent = 'box.created' | 'box.stage_changed' | 'digest.weekly';

/** Send an event to subscribers and report each response status. */
export async function emitEventNow(deps: AppDeps, tenantId: string, pipelineId: string, event: WebhookEvent, data: Record<string, unknown>, only?: string[]): Promise<number[]> {
    // `only` is used for test messages and the weekly summary: it names the subscriptions to send to, whatever their event list says.
    const subs = (await deps.authPool.query<{ id: string; url: string; secret_enc: Buffer; key_id: string }>(
      only
        ? 'SELECT id, url, secret_enc, key_id FROM webhook_subscriptions WHERE pipeline_id = $1 AND tenant_id = $2 AND id = ANY($3::uuid[])'
        : 'SELECT id, url, secret_enc, key_id FROM webhook_subscriptions WHERE pipeline_id = $1 AND tenant_id = $2 AND active AND $3 = ANY(events)',
      [pipelineId, tenantId, only ?? event],
    )).rows;
    const statuses: number[] = [];
    const at = new Date().toISOString();
    const body = JSON.stringify({ event, at, pipelineId, ...data });
    for (const s of subs) {
      let status = 0;
      try {
        const secret = openSealed(deps.keys!, { keyId: s.key_id, data: s.secret_enc }, `${tenantId}:${s.id}`).toString('utf8');
        const ts = String(Math.floor(Date.now() / 1000));
        const sig = createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
        status = await post(await safeTarget(s.url, deps.config.appEnv === 'test'), body, { 'X-PII-Event': event, 'X-PII-Timestamp': ts, 'X-PII-Signature': `sha256=${sig}` });
      } catch { status = 0; }
      statuses.push(status);
      const ok = status >= 200 && status < 400; // Google Apps Script answers a received post with a redirect
      if (event === 'digest.weekly') await deps.authPool.query('UPDATE webhook_subscriptions SET last_digest_at = now() WHERE id = $1', [s.id]).catch(() => undefined);
      await deps.authPool.query(
        'UPDATE webhook_subscriptions SET last_status = $2, last_at = now(), failures = CASE WHEN $3 THEN 0 ELSE failures + 1 END, active = CASE WHEN $3 THEN active ELSE failures + 1 < 10 END WHERE id = $1',
        [s.id, status, ok],
      ).catch(() => undefined);
    }
    return statuses;
}

/** Tell subscribers about an event. Never throws and never blocks the request that caused it. */
export function emitEvent(deps: AppDeps, tenantId: string, pipelineId: string, event: WebhookEvent, data: Record<string, unknown>): void {
  void emitEventNow(deps, tenantId, pipelineId, event, data).catch(() => undefined);
}
