export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
export const unauthorized = () => new HttpError(401, 'unauthorized', 'Sign-in required');
export const forbidden = (m = 'Not allowed') => new HttpError(403, 'forbidden', m);
export const notFound = (m = 'Not found') => new HttpError(404, 'not_found', m);
export const conflict = (m: string) => new HttpError(409, 'conflict', m);
export const invalid = (m: string) => new HttpError(422, 'invalid', m);

/** Translate database errors (triggers, constraints, row-level security) into API errors. */
export function mapDbError(err: unknown): HttpError | null {
  const e = err as { code?: string; message?: string };
  if (!e || typeof e.code !== 'string') return null;
  const msg = e.message ?? '';
  if (e.code === 'P0001') {
    if (msg.startsWith('Cycle rejected')) return conflict('That link would create a loop in the organization');
    if (msg.startsWith('Partner depth cap')) return invalid('That would exceed the maximum partner depth');
    if (msg.startsWith('location_link') || msg.startsWith('partner_link')) return invalid('Those two kinds of node cannot be linked');
    if (msg.startsWith('Quebec-facing') || msg.startsWith('Every lesson needs')) return invalid(msg);
    if (msg.startsWith('Residency violation')) return new HttpError(500, 'residency', 'Residency check failed');
  }
  if (e.code === '23505') return conflict('That already exists');
  if (e.code === '23503') return invalid('A referenced record does not exist');
  if (e.code === '42501') return forbidden();
  return null;
}
