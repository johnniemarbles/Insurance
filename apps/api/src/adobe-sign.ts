// Adobe Acrobat Sign REST API v6: upload a document, send it to a signer, read its status, download the signed PDF.
// Written from Adobe's published API guide; the calls are plain HTTPS so the tests can stand in for Adobe.
export interface AdobeConfig { apiAccessPoint: string; accessToken?: string; clientId?: string; clientSecret?: string; refreshToken?: string }
export type Fetch = typeof fetch;

/** Only Adobe's own hosts, so a stored address can never point the server at somewhere else. */
export const ADOBE_HOST = /^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(adobesign\.com|echosign\.com)$/i;
export const cleanApiPoint = (s: string): string => s.trim().replace(/\/+$/, '').replace(/\/api\/rest\/v6$/i, '');

export class AdobeError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

export function adobeClient(cfg: AdobeConfig, f: Fetch = fetch) {
  if (!ADOBE_HOST.test(cfg.apiAccessPoint)) throw new AdobeError(400, 'That is not an Adobe Acrobat Sign address');
  let token = cfg.accessToken ?? '';
  const base = `${cfg.apiAccessPoint}/api/rest/v6`;
  async function refresh(): Promise<void> {
    if (!cfg.refreshToken || !cfg.clientId || !cfg.clientSecret) throw new AdobeError(401, 'Adobe did not accept the saved sign-in, and there is no refresh token to renew it');
    const res = await f(`${cfg.apiAccessPoint}/oauth/v2/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: cfg.clientId, client_secret: cfg.clientSecret, refresh_token: cfg.refreshToken }), signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new AdobeError(401, `Adobe refused to renew the sign-in (${res.status})`);
    token = ((await res.json()) as { access_token?: string }).access_token ?? '';
    if (!token) throw new AdobeError(401, 'Adobe did not return an access token');
  }
  async function req(path: string, init: RequestInit = {}, retried = false): Promise<Response> {
    if (!token) await refresh();
    const res = await f(base + path, { ...init, headers: { ...(init.headers as Record<string, string> | undefined), authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30_000) });
    if (res.status === 401 && !retried) { token = ''; await refresh(); return req(path, init, true); }
    if (!res.ok) {
      let why = ''; try { const j = (await res.clone().json()) as { message?: string; code?: string }; why = j.message ?? j.code ?? ''; } catch { /* no body */ }
      throw new AdobeError(res.status, `Adobe answered ${res.status}${why ? `: ${why.slice(0, 200)}` : ''}`);
    }
    return res;
  }
  return {
    /** Who the connection signs in as. A cheap way to prove the saved details work. */
    async me(): Promise<{ email: string | null }> {
      const j = (await (await req('/users/me')).json()) as { email?: string };
      return { email: j.email ?? null };
    },
    /** Send a PDF to one signer. Returns Adobe's agreement id. */
    async send(i: { name: string; pdf: Uint8Array; signerEmail: string; message?: string }): Promise<string> {
      const fd = new FormData();
      fd.append('File-Name', `${i.name}.pdf`); fd.append('Mime-Type', 'application/pdf');
      fd.append('File', new Blob([i.pdf as unknown as ArrayBuffer], { type: 'application/pdf' }), `${i.name}.pdf`);
      const up = (await (await req('/transientDocuments', { method: 'POST', body: fd })).json()) as { transientDocumentId?: string };
      if (!up.transientDocumentId) throw new AdobeError(502, 'Adobe did not accept the document');
      const ag = (await (await req('/agreements', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fileInfos: [{ transientDocumentId: up.transientDocumentId }], name: i.name.slice(0, 255), signatureType: 'ESIGN', state: 'IN_PROCESS',
          participantSetsInfo: [{ order: 1, role: 'SIGNER', memberInfos: [{ email: i.signerEmail }] }],
          ...(i.message ? { message: i.message.slice(0, 1000) } : {}),
        }),
      })).json()) as { id?: string };
      if (!ag.id) throw new AdobeError(502, 'Adobe did not create the agreement');
      return ag.id;
    },
    async status(id: string): Promise<string> {
      const j = (await (await req(`/agreements/${encodeURIComponent(id)}`)).json()) as { status?: string };
      return j.status ?? 'UNKNOWN';
    },
    async signedPdf(id: string): Promise<Buffer> {
      return Buffer.from(await (await req(`/agreements/${encodeURIComponent(id)}/combinedDocument`)).arrayBuffer());
    },
  };
}
/** Adobe's status words, reduced to the three we act on. */
export const adobeOutcome = (s: string): 'signed' | 'closed' | 'open' =>
  s === 'SIGNED' || s === 'APPROVED' || s === 'COMPLETED' ? 'signed' : s === 'CANCELLED' || s === 'EXPIRED' || s === 'ABORTED' ? 'closed' : 'open';
