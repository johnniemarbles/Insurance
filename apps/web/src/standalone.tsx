import { mountPii } from './mount.tsx';
import type { ComposeApi, Transport, TransportResult, PiiRoute, RegionChoice } from './types.ts';

const call = async (method: string, path: string, body: unknown, headers: Record<string, string>, credentials: RequestCredentials): Promise<TransportResult> => {
  try {
    const res = await fetch(path, { method, credentials, headers: body ? { 'content-type': 'application/json', ...headers } : headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: 0, json: null };
  }
};

const el = document.getElementById('pii-root')!;
const GMAIL = 'https://mail.google.com';
const embedded = new URLSearchParams(location.search).get('embed') === '1' && window.parent !== window;

if (!embedded) {
  const transport: Transport = (method, path, body) => call(method, path, body, {}, 'same-origin');
  mountPii(el, { transport, onSignIn: () => { location.href = '/auth/google/start'; } });
} else {
  // Shown inside Gmail by the extension. The extension hands over a short-lived token; no cookie is used in the frame.
  // Never post anything secret to the parent: Gmail's own page scripts can hear it.
  let token: string | null = null;
  let blocked: TransportResult | null = null;
  let waiter: ((ok: boolean) => void) | null = null;
  const up = (m: Record<string, unknown>) => window.parent.postMessage({ pii: m.pii, ...m }, GMAIL);
  const renew = () => new Promise<boolean>((resolve) => {
    const t = setTimeout(() => { waiter = null; resolve(false); }, 10_000);
    waiter = (ok) => { clearTimeout(t); waiter = null; resolve(ok); };
    up({ pii: 'need-token' });
  });
  const take = (d: { token?: string; error?: { status: number; json: unknown } }) => {
    const wasBlocked = blocked !== null;
    token = d.token ?? null;
    blocked = d.token ? null : (d.error ? { status: d.error.status, json: d.error.json } : { status: 401, json: null });
    if (wasBlocked && token) location.reload(); // the person signed in while this frame was waiting
    waiter?.(!!token);
  };
  // A call for another country (head-office views) goes to that country's server through the extension, which holds that sign-in.
  let ownRegion: string | undefined;
  const relayed = new Map<string, (r: TransportResult) => void>();
  let relaySeq = 0;
  const relay = (method: string, path: string, body: unknown, region: string) => new Promise<TransportResult>((resolve) => {
    const reqId = `a${Date.now()}-${++relaySeq}`;
    const t = setTimeout(() => { relayed.delete(reqId); resolve({ status: 0, json: null }); }, 30_000);
    relayed.set(reqId, (r) => { clearTimeout(t); relayed.delete(reqId); resolve(r); });
    up({ pii: 'api', reqId, method, path, body, region });
  });
  const transport: Transport = async (method, path, body, region) => {
    if (region && ownRegion && region !== ownRegion) return relay(method, path, body, region);
    if (blocked) return blocked;
    if (!token) return { status: 401, json: null };
    let r = await call(method, path, body, { authorization: `Bearer ${token}` }, 'omit');
    if (r.status === 401 && (await renew()) && token) r = await call(method, path, body, { authorization: `Bearer ${token}` }, 'omit');
    return r;
  };
  // Gmail's compose window lives in the extension: ask it to send and wait for its answer (review mode can take ten minutes).
  const pending = new Map<string, (r: Awaited<ReturnType<ComposeApi['send']>>) => void>();
  let seq = 0;
  const compose: ComposeApi = {
    send: (m) => new Promise((resolve) => {
      const reqId = `c${Date.now()}-${++seq}`;
      const t = setTimeout(() => { pending.delete(reqId); resolve({ ok: false, error: 'Gmail did not answer' }); }, 11 * 60_000);
      pending.set(reqId, (r) => { clearTimeout(t); pending.delete(reqId); resolve(r); });
      up({ pii: 'compose', reqId, to: m.to, subject: m.subject, html: m.html, review: m.review === true });
    }),
  };
  let mounted = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== GMAIL || !e.data || typeof e.data.pii !== 'string') return;
    if (e.data.pii === 'init' && !mounted) {
      mounted = true;
      take(e.data);
      const route = e.data.route as PiiRoute | undefined;
      ownRegion = typeof e.data.region === 'string' ? e.data.region : undefined;
      const regions = Array.isArray(e.data.regions) ? (e.data.regions as RegionChoice[]).filter((r) => r && typeof r.id === 'string' && typeof r.label === 'string') : undefined;
      mountPii(el, {
        transport, extVersion: String(e.data.extVersion ?? ''), route,
        regions, region: typeof e.data.region === 'string' ? e.data.region : undefined,
        // The extension reloads this frame from the other country's server.
        switchRegion: regions && regions.length > 1 ? (id) => up({ pii: 'region', region: id }) : undefined,
        compose: e.data.compose === true ? compose : undefined,
        onSignIn: (region, keep, opts) => up({ pii: 'signin', region, keep, fresh: opts?.fresh }),
        navigate: (page, id) => up({ pii: 'navigate', page, id }),
      });
    } else if (e.data.pii === 'token') take(e.data);
    else if (e.data.pii === 'api-result' && typeof e.data.reqId === 'string') relayed.get(e.data.reqId)?.({ status: Number(e.data.status ?? 0), json: e.data.json ?? null });
    else if (e.data.pii === 'compose-result' && typeof e.data.reqId === 'string') pending.get(e.data.reqId)?.(e.data.result ?? { ok: false, error: 'No answer from Gmail' });
  });
  up({ pii: 'ready' });
}
