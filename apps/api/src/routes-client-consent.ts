import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { CONSENT_CHANNELS, CONSENT_KINDS, CONSENT_WORDING, WORDING_VERSION, consentStates, type RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import type { AppDeps } from './app.ts';

/** Client consents: what the client agreed to, in which wording, how, and whether they have since withdrawn. Plus the Principal Broker's overview. */
export function registerClientConsentRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const nameOf = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
  async function boxOwner(tx: Tx, id: string) {
    const b = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
    if (!b) throw notFound('Record not found');
    return b.owner_node_id;
  }

  app.get('/v1/boxes/:id/consents', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await boxOwner(tx, id);
      const consents = (await tx.query(`SELECT id, kind, wording_version AS "wordingVersion", channel, granted_on::text AS "grantedOn", recorded_by_name AS "recordedBy", note, withdrawn_at AS "withdrawnAt", withdrawn_by_name AS "withdrawnBy", withdrawn_note AS "withdrawnNote", created_at AS "createdAt" FROM client_consents WHERE box_id = $1 ORDER BY created_at DESC LIMIT 100`, [id])).rows;
      const st = consentStates([...consents].reverse());
      const hold = (await tx.query(`SELECT id, reason, placed_by_name AS "placedBy", placed_at AS "placedAt" FROM legal_holds WHERE box_id = $1 AND released_at IS NULL`, [id])).rows[0] ?? null;
      return { consents, active: st.active, withdrawn: st.withdrawn, wording: { version: WORDING_VERSION, draft: true, kinds: CONSENT_KINDS.map((k) => ({ kind: k, text: CONSENT_WORDING[k] })) }, hold, canHold: canWaive(ctx) };
    });
  });

  app.post('/v1/boxes/:id/consents', {
    schema: { params: idp, body: { type: 'object', required: ['kind', 'channel'], additionalProperties: false, properties: { kind: { enum: [...CONSENT_KINDS] }, channel: { enum: [...CONSENT_CHANNELS] }, grantedOn: { type: 'string', format: 'date' }, note: { type: 'string', maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { kind: string; channel: string; grantedOn?: string; note?: string };
    const out = await run(ctx, async (tx) => {
      requireEdit(ctx, await boxOwner(tx, id));
      const rows = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>('SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 ORDER BY created_at', [id])).rows;
      if (consentStates(rows).active.includes(b.kind)) throw new HttpError(409, 'already_active', 'That consent is already on file and has not been withdrawn');
      const r = await tx.query<{ id: string }>(
        `INSERT INTO client_consents (tenant_id, box_id, kind, wording_version, channel, granted_on, recorded_by, recorded_by_name, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, id, b.kind, WORDING_VERSION, b.channel, b.grantedOn ?? new Date().toISOString().slice(0, 10), ctx.userId, await nameOf(tx, ctx), b.note?.trim() || null]);
      await audit(tx, ctx, 'consent_recorded', 'box', id, { kind: b.kind, channel: b.channel, wording: WORDING_VERSION });
      return { id: r.rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/consents/:id/withdraw', { schema: { params: idp, body: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', maxLength: 500 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const { note } = (req.body ?? {}) as { note?: string };
    return run(ctx, async (tx) => {
      const c = (await tx.query<{ box_id: string; kind: string; withdrawn_at: string | null }>('SELECT box_id, kind, withdrawn_at FROM client_consents WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Consent not found');
      requireEdit(ctx, await boxOwner(tx, c.box_id));
      if (c.withdrawn_at) throw new HttpError(409, 'already_withdrawn', 'Already withdrawn');
      await tx.query('UPDATE client_consents SET withdrawn_at = now(), withdrawn_by_name = $2, withdrawn_note = $3 WHERE id = $1', [id, await nameOf(tx, ctx), note?.trim() || null]);
      await audit(tx, ctx, 'consent_withdrawn', 'box', c.box_id, { consentId: id, kind: c.kind });
      return { ok: true };
    });
  });

  // The Principal Broker's single view: what needs attention today. Counts only; the lists sit on their own screens.
  app.get('/v1/compliance/overview', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => {
      const n = async (sql: string) => ((await tx.query<{ n: number }>(sql)).rows[0]?.n ?? 0) as number;
      return {
        expiring90: await n(`SELECT count(*)::int AS n FROM compliance_items i JOIN org_nodes o ON o.id = i.node_id AND o.is_active WHERE i.expires_on IS NOT NULL AND i.expires_on BETWEEN current_date AND current_date + 90`),
        expired: await n(`SELECT count(*)::int AS n FROM compliance_items i JOIN org_nodes o ON o.id = i.node_id AND o.is_active WHERE i.expires_on IS NOT NULL AND i.expires_on < current_date`),
        waivers90d: await n(`SELECT count(*)::int AS n FROM gate_overrides WHERE created_at > now() - interval '90 days'`),
        withdrawals30d: await n(`SELECT count(*)::int AS n FROM client_consents WHERE withdrawn_at > now() - interval '30 days'`),
        openHolds: await n(`SELECT count(*)::int AS n FROM legal_holds WHERE released_at IS NULL`),
        cashReportsDue: await n(`SELECT count(*)::int AS n FROM cash_transactions WHERE report_required AND reported_at IS NULL`),
        openScreeningHits: await n(`SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (box_id, list) result FROM screening_results ORDER BY box_id, list, created_at DESC) x WHERE result = 'hit'`),
      };
    });
  });
}
