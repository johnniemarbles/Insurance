import { mountPii } from './mount.tsx';
import type { Transport } from './types.ts';

const transport: Transport = async (method, path, body) => {
  try {
    const res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : null };
  } catch {
    return { status: 0, json: null };
  }
};
const el = document.getElementById('pii-root')!;
mountPii(el, { transport, onSignIn: () => { location.href = '/auth/google/start'; } });
