import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { RETENTION_DEFAULT, RETENTION_KINDS, RETENTION_LABELS, RETENTION_MAX, RETENTION_MIN, lifecycleState, retentionKindForDoc, retentionYears, type RequestContext, type RetentionKind } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import type { AppDeps } from './app.ts';

/** Retention policy, legal holds and the report of what is held, retained or due for review.
 *  This reports and protects. It does not delete anything: destruction waits for counsel's sign-off and the choice of Canadian storage. */
export function registerRetentionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const need = (ctx: RequestContext) => { if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can manage retention'); };
  const nameOf = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;

  async function policies(tx: Tx) {
    const rows = (await tx.query<{ record_kind: RetentionKind; years: number }>('SELECT record_kind, years FROM retention_policies')).rows;
    const custom = new Map(rows.map((r) => [r.record_kind, r.years]));
    return RETENTION_KINDS.map((k) => ({ kind: k, label: RETENTION_LABELS[k], years: retentionYears(k, custom.get(k)), default: RETENTION_DEFAULT[k], min: RETENTION_MIN[k], max: RETENTION_MAX, custom: custom.has(k) }));
  }

  app.get('/v1/compliance/retention', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx); need(ctx);
    return run(ctx, async (tx) => {
      const pol = await policies(tx);
      const years = Object.fromEntries(pol.map((p) => [p.kind, p.years])) as Record<RetentionKind, number>;
      // One row per closed client file and clock, with how many records it holds on that clock.
      const files = (await tx.query<{ id: string; name: string; closed_at: Date; advice: number; aml: number; consent: number; docs: { doc_type: string | null; n: number }[]; held: boolean }>(
        `SELECT b.id, b.name, b.stage_entered_at AS closed_at,
                (SELECT count(*)::int FROM advice_records WHERE box_id = b.id) AS advice,
                (SELECT (SELECT count(*) FROM client_id_records WHERE box_id = b.id) + (SELECT count(*) FROM screening_results WHERE box_id = b.id) + (SELECT count(*) FROM cash_transactions WHERE box_id = b.id))::int AS aml,
                (SELECT count(*)::int FROM client_consents WHERE box_id = b.id) AS consent,
                coalesce((SELECT json_agg(json_build_object('doc_type', t, 'n', n)) FROM (SELECT doc_type AS t, count(*)::int AS n FROM box_documents WHERE box_id = b.id GROUP BY doc_type) d), '[]'::json) AS docs,
                EXISTS (SELECT 1 FROM legal_holds h WHERE h.box_id = b.id AND h.released_at IS NULL) AS held
           FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE s.is_won OR s.is_lost ORDER BY b.stage_entered_at LIMIT 2000`)).rows;
      const rows: { boxId: string; name: string; kind: RetentionKind; records: number; closedAt: string; retainUntil: string | null; state: string }[] = [];
      for (const f of files) {
        const counts: Record<RetentionKind, number> = { advice: f.advice, aml: f.aml, consent: f.consent, ce_certificate: 0 };
        for (const d of f.docs) counts[retentionKindForDoc(d.doc_type)] += d.n;
        for (const k of RETENTION_KINDS) {
          if (!counts[k]) continue;
          const l = lifecycleState(new Date(f.closed_at), years[k], f.held);
          rows.push({ boxId: f.id, name: f.name, kind: k, records: counts[k], closedAt: new Date(f.closed_at).toISOString().slice(0, 10), retainUntil: l.retainUntil?.toISOString().slice(0, 10) ?? null, state: l.state });
        }
      }
      const holds = (await tx.query(`SELECT h.id, h.box_id AS "boxId", b.name, h.reason, h.placed_by_name AS "placedBy", h.placed_at AS "placedAt" FROM legal_holds h JOIN boxes b ON b.id = h.box_id WHERE h.released_at IS NULL ORDER BY h.placed_at DESC LIMIT 200`)).rows;
      const soon = new Date(); soon.setUTCFullYear(soon.getUTCFullYear() + 1);
      const summary = {
        due: rows.filter((r) => r.state === 'due').length, held: rows.filter((r) => r.state === 'held').length,
        dueWithin12Months: rows.filter((r) => r.state === 'retained' && r.retainUntil && new Date(r.retainUntil) <= soon).length,
      };
      return { policies: pol, holds, summary, files: rows.filter((r) => r.state !== 'retained' || (r.retainUntil && new Date(r.retainUntil) <= soon)).slice(0, 500),
        note: 'Reporting only. Nothing is deleted automatically; destruction needs counsel’s sign-off and a Canadian storage vault.' };
    });
  });

  app.put('/v1/compliance/retention/:kind', {
    schema: { params: { type: 'object', properties: { kind: { enum: [...RETENTION_KINDS] } } }, body: { type: 'object', required: ['years'], additionalProperties: false, properties: { years: { type: 'integer', minimum: 1, maximum: RETENTION_MAX } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx); need(ctx);
    const { kind } = req.params as { kind: RetentionKind };
    const { years } = req.body as { years: number };
    if (years < RETENTION_MIN[kind]) throw invalid(`A company may lengthen this period but not go below ${RETENTION_MIN[kind]} years`);
    await run(ctx, async (tx) => {
      await tx.query(`INSERT INTO retention_policies (tenant_id, record_kind, years, set_by_name) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id, record_kind) DO UPDATE SET years = EXCLUDED.years, set_by_name = EXCLUDED.set_by_name, updated_at = now()`,
        [ctx.tenantId, kind, years, await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'retention_policy_set', 'retention', null, { kind, years });
    });
    return reply.code(204).send();
  });

  app.post('/v1/boxes/:id/legal-hold', { schema: { params: idp, body: { type: 'object', required: ['reason'], additionalProperties: false, properties: { reason: { type: 'string', maxLength: 500 } } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx); need(ctx);
    const { id } = req.params as { id: string };
    const reason = (req.body as { reason: string }).reason.trim();
    if (reason.length < 10) throw invalid('Give a reason of at least 10 characters');
    const out = await run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM boxes WHERE id = $1', [id])).rowCount) throw notFound('Record not found');
      if ((await tx.query('SELECT 1 FROM legal_holds WHERE box_id = $1 AND released_at IS NULL', [id])).rowCount) throw new HttpError(409, 'already_held', 'This file is already under a legal hold');
      const r = await tx.query<{ id: string }>('INSERT INTO legal_holds (tenant_id, box_id, reason, placed_by_name) VALUES ($1,$2,$3,$4) RETURNING id', [ctx.tenantId, id, reason, await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'legal_hold_placed', 'box', id, { reason });
      return { id: r.rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/legal-holds/:id/release', { schema: { params: idp, body: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', maxLength: 500 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx); need(ctx);
    const { id } = req.params as { id: string };
    const note = ((req.body ?? {}) as { note?: string }).note?.trim() || null;
    return run(ctx, async (tx) => {
      const h = (await tx.query<{ box_id: string; released_at: string | null }>('SELECT box_id, released_at FROM legal_holds WHERE id = $1', [id])).rows[0];
      if (!h) throw notFound('Hold not found');
      if (h.released_at) throw new HttpError(409, 'already_released', 'Already released');
      await tx.query('UPDATE legal_holds SET released_at = now(), released_by_name = $2, release_note = $3 WHERE id = $1', [id, await nameOf(tx, ctx), note]);
      await audit(tx, ctx, 'legal_hold_released', 'box', h.box_id, { holdId: id });
      return { ok: true };
    });
  });
}
