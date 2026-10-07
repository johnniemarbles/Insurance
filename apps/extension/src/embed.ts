// Shows the PII screens from the server inside Gmail, in a frame. The extension only brings the frame, a short-lived token and a few
// Gmail actions; everything inside the frame is the server's page, so most UI changes need no extension update.
export interface EmbedOptions {
  base: string;
  extVersion: string;
  route: { page: string; id?: string };
  /** Asks the server for a token through the extension's normal checks (including the right-Gmail-account check). */
  getToken(): Promise<{ status: number; json: any }>;
  onSignIn(region?: string, keep?: boolean, opts?: { fresh?: boolean }): void;
  navigate(page: string, id?: string): void;
}

export function mountEmbedded(host: HTMLElement, o: EmbedOptions): () => void {
  const f = document.createElement('iframe');
  f.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#fff';
  f.src = `${o.base}/app?embed=1`;
  host.append(f);
  const post = (m: Record<string, unknown>) => f.contentWindow?.postMessage(m, o.base);
  const tok = async () => {
    const r = await o.getToken();
    return r.status === 200 && typeof r.json?.token === 'string' ? { token: r.json.token as string } : { error: { status: r.status, json: r.json } };
  };
  let waiting = false;
  const onMsg = async (e: MessageEvent) => {
    if (e.source !== f.contentWindow || e.origin !== o.base || !e.data || typeof e.data.pii !== 'string') return;
    const d = e.data as { pii: string; region?: string; keep?: boolean; fresh?: boolean; page?: unknown; id?: unknown };
    if (d.pii === 'ready') { const t = await tok(); waiting = !('token' in t); post({ pii: 'init', extVersion: o.extVersion, route: o.route, ...t }); }
    else if (d.pii === 'need-token') { const t = await tok(); waiting = !('token' in t); post({ pii: 'token', ...t }); }
    else if (d.pii === 'signin') o.onSignIn(typeof d.region === 'string' ? d.region : undefined, d.keep === true, { fresh: d.fresh === true });
    else if (d.pii === 'navigate' && typeof d.page === 'string') o.navigate(d.page, typeof d.id === 'string' ? d.id : undefined);
  };
  // Back from signing in: hand over a token so the frame can continue.
  const onFocus = async () => { if (waiting) { const t = await tok(); waiting = !('token' in t); if ('token' in t) post({ pii: 'token', ...t }); } };
  window.addEventListener('message', onMsg);
  window.addEventListener('focus', onFocus);
  return () => { window.removeEventListener('message', onMsg); window.removeEventListener('focus', onFocus); f.remove(); };
}
