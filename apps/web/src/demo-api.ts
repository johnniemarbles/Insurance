// The Gmail extension's own sidebar code is reused in the demo inbox. Inside the extension its api() goes through the
// extension's background worker; here it is a plain same-origin request carrying the signed-in cookie.
export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { method, credentials: 'same-origin', headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError(0, 'You appear to be offline.');
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (res.status >= 200 && res.status < 300) return json as T;
  throw new ApiError(res.status, json?.error?.message ?? `Error ${res.status}`, json?.error?.code);
}
