import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { CASH_REPORT_THRESHOLD, ID_METHODS, SCREEN_LISTS, SCREEN_RESULTS, cashReportRequired, openScreeningHits, type RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import type { AppDeps } from './app.ts';

/** Client ID checks, PEP/sanctions screening and the large-cash log. Append-only records; PII never files a report itself. */
export function registerAmlRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const today = () => new Date().toISOString().slice(0, 10);
  const dateStr = { type: 'string', format: 'date' } as const;

  async function boxOwner(tx: Tx, id: string) {
    const b = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
    if (!b) throw notFound('Record not found');
    return b.owner_node_id;
  }
  const nameOf = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;

  app.get('/v1/boxes/:id/aml', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await boxOwner(tx, id);
      const idRecords = (await tx.query(`SELECT id, method, documents_seen AS "documentsSeen", result, verified_on::text AS "verifiedOn", verifier_name AS "verifier", note, created_at AS "createdAt" FROM client_id_records WHERE box_id = $1 ORDER BY created_at DESC LIMIT 50`, [id])).rows;
      const screenings = (await tx.query(`SELECT id, list, result, screened_on::text AS "screenedOn", reviewer_name AS "reviewer", note, created_at AS "createdAt" FROM screening_results WHERE box_id = $1 ORDER BY created_at DESC LIMIT 100`, [id])).rows;
      const cash = (await tx.query(`SELECT id, amount::float AS amount, currency, occurred_on::text AS "occurredOn", report_required AS "reportRequired", report_ref AS "reportRef", reported_at AS "reportedAt" FROM cash_transactions WHERE box_id = $1 ORDER BY created_at DESC LIMIT 100`, [id])).rows;
      const asc = [...screenings].reverse();
      return {
        idRecords, screenings, cash, threshold: CASH_REPORT_THRESHOLD, country: deps.config.region === 'us' ? 'US' : 'CA', canReview: canWaive(ctx),
        status: { idVerified: idRecords.some((r) => r.result === 'verified'), openHits: openScreeningHits(asc), reportsDue: cash.filter((c) => c.reportRequired && !c.reportedAt).length },
      };
    });
  });

  app.post('/v1/boxes/:id/id-records', {
    schema: { params: idp, body: { type: 'object', required: ['method', 'result'], additionalProperties: false, properties: {
      method: { enum: [...ID_METHODS] }, result: { enum: ['verified', 'failed'] }, verifiedOn: dateStr,
      documentsSeen: { type: 'array', maxItems: 5, items: { type: 'string', minLength: 1, maxLength: 100 } }, note: { type: 'string', maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { method: string; result: string; verifiedOn?: string; documentsSeen?: string[]; note?: string };
    if (b.result === 'verified' && b.method !== 'credit_file' && !(b.documentsSeen?.length)) throw invalid('List the document(s) you saw (type and issuer only, never the number)');
    if (b.documentsSeen?.some((d) => /\d{6,}/.test(d))) throw invalid('Do not enter ID numbers. Name the document type and issuer only.');
    const out = await run(ctx, async (tx) => {
      requireEdit(ctx, await boxOwner(tx, id));
      const r = await tx.query<{ id: string }>(
        `INSERT INTO client_id_records (tenant_id, box_id, method, documents_seen, result, verified_on, verifier_id, verifier_name, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, id, b.method, b.documentsSeen ?? [], b.result, b.verifiedOn ?? today(), ctx.userId, await nameOf(tx, ctx), b.note?.trim() || null]);
      await audit(tx, ctx, 'client_id_recorded', 'box', id, { method: b.method, result: b.result });
      return { id: r.rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  // A hit blocks gated stages until the compliance role records a review. Only the compliance role or an admin can clear one.
  app.post('/v1/boxes/:id/screenings', {
    schema: { params: idp, body: { type: 'object', required: ['list', 'result'], additionalProperties: false, properties: {
      list: { enum: [...SCREEN_LISTS] }, result: { enum: [...SCREEN_RESULTS] }, screenedOn: dateStr, note: { type: 'string', maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { list: string; result: string; screenedOn?: string; note?: string };
    if (b.result === 'cleared_after_review') {
      if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can clear a screening hit');
      if ((b.note?.trim().length ?? 0) < 10) throw invalid('Say how the hit was reviewed (at least 10 characters)');
    }
    const out = await run(ctx, async (tx) => {
      const owner = await boxOwner(tx, id);
      if (b.result !== 'cleared_after_review') requireEdit(ctx, owner); // a review by the compliance role needs sight of the record, not the right to edit it
      if (b.result === 'cleared_after_review') {
        const rows = (await tx.query<{ list: string; result: string; createdAt: string }>('SELECT list, result, created_at AS "createdAt" FROM screening_results WHERE box_id = $1 ORDER BY created_at', [id])).rows;
        if (!openScreeningHits(rows).includes(b.list as 'pep')) throw new HttpError(409, 'no_open_hit', 'There is no open hit on that list to clear');
      }
      const r = await tx.query<{ id: string }>(
        `INSERT INTO screening_results (tenant_id, box_id, list, result, screened_on, reviewer_id, reviewer_name, note) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [ctx.tenantId, id, b.list, b.result, b.screenedOn ?? today(), ctx.userId, await nameOf(tx, ctx), b.note?.trim() || null]);
      await audit(tx, ctx, 'screening_recorded', 'box', id, { list: b.list, result: b.result });
      return { id: r.rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/boxes/:id/cash', {
    schema: { params: idp, body: { type: 'object', required: ['amount', 'occurredOn'], additionalProperties: false, properties: { amount: { type: 'number', exclusiveMinimum: 0, maximum: 999999999999 }, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, occurredOn: dateStr } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { amount: number; currency?: string; occurredOn: string };
    const out = await run(ctx, async (tx) => {
      requireEdit(ctx, await boxOwner(tx, id));
      const need = cashReportRequired(b.amount); // $10,000 in the local currency (CAD in Canada, USD in the US); counsel confirms how foreign currency is converted
      const cur = b.currency ?? (deps.config.region === 'us' ? 'USD' : 'CAD');
      const r = await tx.query<{ id: string }>(
        `INSERT INTO cash_transactions (tenant_id, box_id, amount, currency, occurred_on, report_required, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, id, b.amount, cur, b.occurredOn, need, ctx.userId]);
      await audit(tx, ctx, 'cash_recorded', 'box', id, { amount: b.amount, currency: cur, reportRequired: need });
      return { id: r.rows[0]!.id, reportRequired: need };
    });
    return reply.code(201).send(out);
  });

  // Note that the report was filed with FINTRAC outside PII, and keep its reference.
  app.post('/v1/cash/:id/report', { schema: { params: idp, body: { type: 'object', required: ['reference'], additionalProperties: false, properties: { reference: { type: 'string', minLength: 1, maxLength: 100 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const { reference } = req.body as { reference: string };
    return run(ctx, async (tx) => {
      const c = (await tx.query<{ box_id: string; report_required: boolean; reported_at: string | null }>('SELECT box_id, report_required, reported_at FROM cash_transactions WHERE id = $1', [id])).rows[0];
      if (!c) throw notFound('Entry not found');
      requireEdit(ctx, await boxOwner(tx, c.box_id));
      if (!c.report_required) throw invalid('This entry is under the reporting threshold');
      if (c.reported_at) throw new HttpError(409, 'already_reported', 'A report reference is already recorded');
      await tx.query('UPDATE cash_transactions SET report_ref = $2, reported_at = now() WHERE id = $1', [id, reference.trim()]);
      await audit(tx, ctx, 'cash_report_noted', 'box', c.box_id, { cashId: id, reference: reference.trim() });
      return { ok: true };
    });
  });
}
