import { createHmac, timingSafeEqual } from 'node:crypto';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export interface CookieOptions {
  maxAgeSeconds?: number;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict';
  path?: string;
}

export function serializeCookie(name: string, value: string, o: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${o.path ?? '/'}`, 'HttpOnly', `SameSite=${o.sameSite ?? 'Lax'}`];
  if (o.secure !== false) parts.push('Secure');
  if (o.maxAgeSeconds !== undefined) parts.push(`Max-Age=${o.maxAgeSeconds}`);
  return parts.join('; ');
}

/** value.signature, where the signature is an HMAC-SHA256 over the value. For short-lived flow state, not secrets. */
export function signValue(secret: string, value: string): string {
  const mac = createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${mac}`;
}

export function verifySigned(secret: string, signed: string | undefined): string | null {
  if (!signed) return null;
  const i = signed.lastIndexOf('.');
  if (i < 0) return null;
  const value = signed.slice(0, i);
  const expected = Buffer.from(createHmac('sha256', secret).update(value).digest('base64url'));
  const given = Buffer.from(signed.slice(i + 1));
  return given.length === expected.length && timingSafeEqual(given, expected) ? value : null;
}
