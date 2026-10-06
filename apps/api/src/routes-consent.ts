import type { FastifyInstance } from 'fastify';
import { firstLoginNotice, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import type { AppDeps } from './app.ts';
import type { Identity } from './auth.ts';

export async function currentNoticeVersion(tx: Tx): Promise<string> {
  const { rows } = await tx.query<{ notice_version: string }>('SELECT notice_version FROM tenant_settings LIMIT 1');
  return rows[0]?.notice_version ?? 'v1';
}

export async function hasAcceptedFirstLogin(tx: Tx, ctx: RequestContext): Promise<boolean> {
  const version = await currentNoticeVersion(tx);
  const { rowCount } = await tx.query(`SELECT 1 FROM consent_records WHERE user_id = $1 AND kind = 'first_login' AND notice_version = $2 LIMIT 1`, [ctx.userId, version]);
  return (rowCount ?? 0) > 0;
}

export function registerConsentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const region = deps.config.region;

  async function notice(id: Identity, tx: Tx) {
    const locs = await tx.query<{ name: string }>(
      `SELECT name FROM org_nodes WHERE type = 'location' AND id IN (SELECT ancestor_id FROM org_reach WHERE descendant_id = ANY($1::uuid[])) ORDER BY name`,
      [id.ctx.nodeIds],
    );
    return firstLoginNotice({
      locale: id.user.locale,
      region,
      stored: deps.config.dataCountry,
      companyName: id.user.tenantName,
      locationName: locs.rows.map((r) => r.name).join(', ') || undefined,
      privacyEmail: deps.config.privacyEmail,
      policyUrl: deps.config.policyUrl,
    });
  }

  app.get('/v1/consent/first-login', async (req) => {
    const id = await deps.authenticate(req);
    return withRequestTx(deps.appPool, id.ctx, async (tx) => ({
      version: await currentNoticeVersion(tx),
      locale: id.user.locale,
      text: await notice(id, tx),
      accepted: await hasAcceptedFirstLogin(tx, id.ctx),
    }));
  });

  app.post('/v1/consent/first-login', async (req, reply) => {
    const id = await deps.authenticate(req);
    await withRequestTx(deps.appPool, id.ctx, async (tx) => {
      if (await hasAcceptedFirstLogin(tx, id.ctx)) return;
      const version = await currentNoticeVersion(tx);
      await tx.query(
        `INSERT INTO consent_records (tenant_id, user_id, kind, notice_version, locale, region) VALUES ($1, $2, 'first_login', $3, $4, $5)`,
        [id.ctx.tenantId, id.ctx.userId, version, id.user.locale, region],
      );
      await audit(tx, id.ctx, 'consent_accepted', 'user', id.ctx.userId, { kind: 'first_login', version });
    });
    return reply.code(204).send();
  });
}
