import { mountPii } from './mount.tsx';
import type { Transport, TransportResult, PiiRoute } from './types.ts';

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
  const transport: Transport = async (method, path, body) => {
    if (blocked) return blocked;
    if (!token) return { status: 401, json: null };
    let r = await call(method, path, body, { authorization: `Bearer ${token}` }, 'omit');
    if (r.status === 401 && (await renew()) && token) r = await call(method, path, body, { authorization: `Bearer ${token}` }, 'omit');
    return r;
  };
  let mounted = false;
  window.addEventListener('message', (e) => {
    if (e.source !== window.parent || e.origin !== GMAIL || !e.data || typeof e.data.pii !== 'string') return;
    if (e.data.pii === 'init' && !mounted) {
      mounted = true;
      take(e.data);
      const route = e.data.route as PiiRoute | undefined;
      mountPii(el, {
        transport, extVersion: String(e.data.extVersion ?? ''), route,
        onSignIn: (region, keep, opts) => up({ pii: 'signin', region, keep, fresh: opts?.fresh }),
        navigate: (page, id) => up({ pii: 'navigate', page, id }),
      });
    } else if (e.data.pii === 'token') take(e.data);
  });
  up({ pii: 'ready' });
}
