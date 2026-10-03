import type { FastifyRequest } from 'fastify';
import { buildRequestContext, type RequestContext } from '@pii/domain';
import { findLoginCandidates, markLogin, type Db, type LoginCandidate } from '@pii/db';
import { HttpError, unauthorized } from './errors.ts';

export interface Identity {
  ctx: RequestContext;
  user: LoginCandidate;
}

/** Turns a request into an identity. Real Google sign-in replaces this in Phase 1 (ticket 1.1); same shape. */
export type Authenticator = (req: FastifyRequest) => Promise<Identity>;

export function pickCandidate(candidates: LoginCandidate[], tenantId: string | undefined): LoginCandidate {
  const list = tenantId ? candidates.filter((c) => c.tenantId === tenantId) : candidates;
  if (list.length === 0) throw unauthorized();
  if (list.length > 1) throw new HttpError(409, 'tenant_required', 'This email belongs to more than one company; choose one');
  return list[0]!;
}

export function candidateToIdentity(user: LoginCandidate): Identity {
  return {
    user,
    ctx: buildRequestContext({
      tenantId: user.tenantId,
      userId: user.userId,
      homeNodeId: user.homeNodeId,
      tenantRootNodeId: user.tenantRootNodeId,
      roles: user.roles,
    }),
  };
}

/** Development only: trust the x-dev-user-email header. Refused outside dev/test by loadConfig. */
export function devAuthenticator(authPool: Db): Authenticator {
  return async (req) => {
    const email = req.headers['x-dev-user-email'];
    if (typeof email !== 'string' || !email) throw unauthorized();
    const tenantHeader = req.headers['x-dev-tenant-id'];
    const candidates = await findLoginCandidates(authPool, email.trim().toLowerCase());
    const user = pickCandidate(candidates, typeof tenantHeader === 'string' ? tenantHeader : undefined);
    if (user.status === 'invited') await markLogin(authPool, user.userId);
    return candidateToIdentity(user);
  };
}
