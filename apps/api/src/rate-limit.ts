import type { FastifyInstance } from 'fastify';

/**
 * Per-address request limits, held in memory (one server process per country).
 * Sign-in is the tightest, public pages are modest, and the signed-in API has a high ceiling
 * that only a script or a stuck loop would reach. Own limits on forms, webhooks and mail merge stay as they are.
 */
export interface Rule { name: string; windowMs: number; max: number; match: (method: string, path: string) => boolean }

export const RULES: Rule[] = [
  { name: 'sign', windowMs: 60_000, max: 40, match: (_m, p) => p.startsWith('/sign/') || p.startsWith('/v1/public/sign/') },
  { name: 'signin', windowMs: 10 * 60_000, max: 60, match: (_m, p) => p.startsWith('/auth/') },
  { name: 'public', windowMs: 60_000, max: 120, match: (m, p) => m === 'GET' && (p === '/privacy' || p === '/terms' || p === '/support' || p === '/v1/region' || p.startsWith('/brand/') || p.startsWith('/c/')) },
  { name: 'api', windowMs: 60_000, max: 1500, match: (_m, p) => p.startsWith('/v1/') && !p.startsWith('/v1/hooks/') },
];

function evictStale(hits: Map<string, number[]>, now: number, maxKeys: number): void {
  if (hits.size <= maxKeys) return;
  for (const [k, v] of hits) {
    if (v.length === 0 || now - v[v.length - 1]! > 600_000) hits.delete(k);
  }
  // Still over capacity: drop oldest keys without wiping active counters (avoids reset-under-attack).
  if (hits.size > maxKeys) {
    const overflow = hits.size - Math.floor(maxKeys * 0.75);
    let n = 0;
    for (const k of hits.keys()) {
      hits.delete(k);
      if (++n >= overflow) break;
    }
  }
}

export function createLimiter(rules: Rule[] = RULES) {
  const hits = new Map<string, number[]>();
  return (ip: string, method: string, path: string): { limited: boolean; retryAfter: number; rule?: string } => {
    const rule = rules.find((r) => r.match(method, path));
    if (!rule) return { limited: false, retryAfter: 0 };
    const now = Date.now();
    const key = `${rule.name}:${ip}`;
    const list = (hits.get(key) ?? []).filter((t) => now - t < rule.windowMs);
    if (list.length >= rule.max) {
      hits.set(key, list);
      return { limited: true, retryAfter: Math.max(1, Math.ceil((list[0]! + rule.windowMs - now) / 1000)), rule: rule.name };
    }
    list.push(now);
    hits.set(key, list);
    evictStale(hits, now, 20_000);
    return { limited: false, retryAfter: 0 };
  };
}

export function registerRateLimit(app: FastifyInstance, rules?: Rule[]): void {
  const check = createLimiter(rules);
  app.addHook('onRequest', async (req, reply) => {
    const r = check(req.ip, req.method, req.url.split('?')[0]!);
    if (!r.limited) return;
    req.log.warn({ rule: r.rule }, 'rate limited');
    reply.header('retry-after', String(r.retryAfter)).code(429).send({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } });
    return reply;
  });
}
