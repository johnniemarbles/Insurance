import { test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerCarrierActivationRoutes } from '../src/routes-carrier-activation.ts';
import { registerCarrierAuthorizationEvidenceRoutes } from '../src/routes-carrier-authorization-evidence.ts';
import { registerCarrierHoldRoutes } from '../src/routes-carrier-holds.ts';
import { registerCarrierProductRevocationRoutes } from '../src/routes-carrier-product-revocation.ts';
import { registerCarrierBusinessStagingRoutes } from '../src/routes-carrier-business-staging.ts';
import type { AppDeps } from '../src/app.ts';
import { HttpError } from '../src/errors.ts';

const id = '00000000-0000-4000-8000-000000000001';
const base = '/v1/compliance/carrier-contracts/' + id;
test('carrier mutation endpoints reject malformed and unexpected input before database access', async () => {
  const app = Fastify();
  const deps = {
    authenticate: async () => ({ ctx: { userId: id, tenantId: id } }),
    appPool: undefined,
  } as unknown as AppDeps;
  registerCarrierActivationRoutes(app, deps);
  registerCarrierAuthorizationEvidenceRoutes(app, deps);
  registerCarrierHoldRoutes(app, deps);
  registerCarrierProductRevocationRoutes(app, deps);
  registerCarrierBusinessStagingRoutes(app, deps);
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof HttpError) return reply.code(error.status).send({ code: error.code });
    return reply.code(500).send({ code: 'unexpected' });
  });
  const cases: Array<{ url: string; payload: unknown }> = [
    { url: base + '/activate', payload: [] },
    { url: base + '/activate', payload: { productCode: 'AUTO', isAdmin: true } },
    { url: base + '/authorization-evidence', payload: [] },
    { url: base + '/authorization-evidence', payload: { kind: 'training', extra: true } },
    { url: '/v1/compliance/carrier-authorization-evidence/' + id + '/revoke', payload: [] },
    { url: '/v1/compliance/carrier-authorization-evidence/' + id + '/revoke', payload: { reason: 'valid reason', extra: true } },
    { url: base + '/holds', payload: [] },
    { url: base + '/holds', payload: { reason: 'valid reason', extra: true } },
    { url: base + '/holds/' + id + '/release', payload: [] },
    { url: base + '/holds/' + id + '/release', payload: { reason: 'valid reason', extra: true } },
    { url: base + '/products/AUTO/revoke', payload: [] },
    { url: base + '/products/AUTO/revoke', payload: { reason: 'valid reason', extra: true } },
    { url: base + '/business-staging', payload: [] },
    { url: base + '/business-staging', payload: { productCode: 'AUTO', externalReference: 'R1', extra: true } },
  ];
  try {
    for (const item of cases) {
      const response = await app.inject({ method: 'POST', url: item.url, payload: item.payload });
      assert.equal(response.statusCode, 422, item.url + ': ' + response.body);
      assert.equal(response.json().code, 'invalid');
    }
  } finally {
    await app.close();
  }
});
