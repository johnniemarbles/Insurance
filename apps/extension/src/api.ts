import type { ApiResponse } from './messages';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string) { super(message); }
}

export async function api<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
  let r: ApiResponse | undefined;
  try { r = (await chrome.runtime.sendMessage({ type: 'pii:api', method, path, body })) as ApiResponse | undefined; } catch { r = undefined; }
  if (!r) throw new ApiError(0, 'PII was updated. Refresh this Gmail tab to continue.');
  if (r.status >= 200 && r.status < 300) return r.json as T;
  throw new ApiError(r.status, r.json?.error?.message ?? `Error ${r.status}`, r.json?.error?.code);
}
