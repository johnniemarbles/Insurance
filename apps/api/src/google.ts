import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import type { Config } from '@pii/platform';

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  /** Google's profile photo, kept only when it is on Google's image host. */
  picture?: string;
}

/** The only part of Google sign-in the app depends on. Replaced by a fake in tests. */
export interface GoogleClient {
  authUrl(p: { state: string; nonce: string; codeChallenge: string; redirectUri: string; loginHint?: string }): string;
  exchange(p: { code: string; codeVerifier: string; redirectUri: string; nonce: string }): Promise<GoogleProfile>;
}

export const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string }
let jwksCache: { keys: Jwk[]; at: number } | null = null;

/** Test hook: pin the signing keys instead of fetching Google's. */
export function setGoogleKeysForTest(keys: Jwk[]): void {
  jwksCache = { keys, at: Date.now() };
}

async function googleKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('Could not fetch Google signing keys');
  const body = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys: body.keys, at: Date.now() };
  return body.keys;
}

const b64 = (s: string) => Buffer.from(s, 'base64url');

export async function verifyIdToken(idToken: string, clientId: string, nonce: string, now = Date.now()): Promise<GoogleProfile> {
  const [h, p, sig] = idToken.split('.');
  if (!h || !p || !sig) throw new Error('Malformed id_token');
  const header = JSON.parse(b64(h).toString()) as { kid: string; alg: string };
  if (header.alg !== 'RS256') throw new Error('Unexpected id_token algorithm');
  const jwk = (await googleKeys()).find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown id_token key');
  const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), createPublicKey({ key: jwk as never, format: 'jwk' }), b64(sig));
  if (!ok) throw new Error('Bad id_token signature');
  const c = JSON.parse(b64(p).toString()) as Record<string, unknown>;
  if (c.iss !== 'https://accounts.google.com' && c.iss !== 'accounts.google.com') throw new Error('Bad id_token issuer');
  if (c.aud !== clientId) throw new Error('Bad id_token audience');
  if (typeof c.exp !== 'number' || c.exp * 1000 < now) throw new Error('id_token expired');
  if (c.nonce !== nonce) throw new Error('Bad id_token nonce');
  if (typeof c.sub !== 'string' || typeof c.email !== 'string') throw new Error('id_token lacks identity');
  const picture = typeof c.picture === 'string' && c.picture.startsWith('https://lh3.googleusercontent.com/') ? c.picture : undefined;
  return { sub: c.sub, email: c.email, emailVerified: c.email_verified === true, name: typeof c.name === 'string' ? c.name : undefined, ...(picture ? { picture } : {}) };
}

export function realGoogleClient(config: Config): GoogleClient {
  const clientId = config.googleClientId!;
  const clientSecret = config.googleClientSecret!;
  return {
    authUrl({ state, nonce, codeChallenge, redirectUri, loginHint }) {
      const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      u.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'openid email profile', // sign-in only; Gmail scopes are requested separately, later, with their own consent
        state,
        nonce,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();
      return u.toString();
    },
    async exchange({ code, codeVerifier, redirectUri, nonce }) {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: codeVerifier }),
      });
      if (!res.ok) throw new Error('Google rejected the sign-in code');
      const body = (await res.json()) as { id_token?: string };
      if (!body.id_token) throw new Error('Google returned no id_token');
      return verifyIdToken(body.id_token, clientId, nonce);
    },
  };
}
