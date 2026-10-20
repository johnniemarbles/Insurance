import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, notFound } from './errors.ts';
import { requireCrm, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { tell } from './routes-compliance.ts';
import type { AppDeps } from './app.ts';

/**
 * The compliance review of signed advice (PIA Compliance Manual §8 suitability monitoring and §14 sampling of client files):
 * the queue, the decision, a review asked for by compliance, and a per-advisor summary of needs-based selling.
 * Administrators and the compliance role use it; row-level security keeps each one to the files they may see.
 */
export function registerAdviceReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const gate = (ctx: RequestContext) => { if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can review advice'); };
  const nameOf = async (tx: Tx, id: string) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [id])).rows[0]?.n ?? '';

  app.get('/v1/compliance/advice-reviews', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { status: { enum: ['pending', 'passed', 'needs_action', 'all'] } } } },
  }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    gate(ctx);
    const { status = 'pending' } = req.query as { status?: string };
    return run(ctx, async (tx) => ({
      reviews: (await tx.query(
        `SELECT v.id, v.advice_id AS "adviceId", a.box_id AS "boxId", b.name AS "boxName", a.kind, a.title, a.client_name AS "clientName", a.signed_at AS "signedAt",
                coalesce(u.display_name, u.email::text) AS advisor, v.advisor_id = $2 AS "ownFile", v.reason, v.flags, v.status, v.findings, v.reviewer_name AS reviewer,
                v.created_at AS "createdAt", v.reviewed_at AS "reviewedAt"
           FROM advice_reviews v JOIN advice_records a ON a.id = v.advice_id JOIN boxes b ON b.id = a.box_id LEFT JOIN app_users u ON u.id = v.advisor_id
          WHERE ($1 = 'all' OR v.status = $1)
          ORDER BY (v.status = 'pending') DESC, (v.reason = 'flagged') DESC, v.created_at LIMIT 300`, [status, ctx.userId])).rows,
      canDecide: true,
    }));
  });

  app.post('/v1/compliance/advice-reviews/:id/decide', {
    schema: { params: idp, body: { type: 'object', required: ['outcome', 'findings'], additionalProperties: false, properties: { outcome: { enum: ['passed', 'needs_action'] }, findings: { type: 'string', minLength: 10, maxLength: 4000 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    gate(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { outcome: 'passed' | 'needs_action'; findings: string };
    const told = await run(ctx, async (tx) => {
      const v = (await tx.query<{ status: string; advisor_id: string; advice_id: string; box_id: string; title: string }>(
        `SELECT v.status, v.advisor_id, v.advice_id, a.box_id, a.title FROM advice_reviews v JOIN advice_records a ON a.id = v.advice_id WHERE v.id = $1`, [id])).rows[0];
      if (!v) throw notFound('Review not found');
      if (v.advisor_id === ctx.userId) throw forbidden('You cannot review advice you gave yourself. Ask another compliance person.');
      if (v.status !== 'pending') throw new HttpError(409, 'review_decided', 'This review has already been decided');
      await tx.query(`UPDATE advice_reviews SET status = $2, findings = $3, reviewer_id = $4, reviewer_name = $5, reviewed_at = now() WHERE id = $1`,
        [id, b.outcome, b.findings.trim(), ctx.userId, await nameOf(tx, ctx.userId)]);
      await audit(tx, ctx, 'advice_review_decided', 'box', v.box_id, { reviewId: id, adviceId: v.advice_id, outcome: b.outcome });
      return v;
    });
    await tell(deps, ctx.tenantId, [told.advisor_id], 'advice_review_decided', ctx.userId, { outcome: b.outcome, boxId: told.box_id, title: told.title, findings: b.findings.trim().slice(0, 300) });
    return reply.code(204).send();
  });

  // Compliance can put any signed advice in the queue, for example after a complaint.
  app.post('/v1/advice/:id/request-review', { schema: { params: idp } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    gate(ctx);
    const { id } = req.params as { id: string };
    const out = await run(ctx, async (tx) => {
      const a = (await tx.query<{ status: string; created_by: string; flags: string[]; box_id: string }>('SELECT status, created_by, flags, box_id FROM advice_records WHERE id = $1', [id])).rows[0];
      if (!a) throw notFound('Advice record not found');
      if (a.status !== 'signed') throw new HttpError(409, 'not_signed', 'Only signed advice is reviewed');
      const r = (await tx.query<{ id: string }>(
        `INSERT INTO advice_reviews (tenant_id, advice_id, advisor_id, reason, flags, requested_by) VALUES ($1,$2,$3,'requested',$4,$5) ON CONFLICT DO NOTHING RETURNING id`,
        [ctx.tenantId, id, a.created_by, a.flags, ctx.userId])).rows[0];
      if (!r) throw new HttpError(409, 'review_open', 'This advice is already waiting for a review');
      await audit(tx, ctx, 'advice_review_opened', 'box', a.box_id, { adviceId: id, reviewId: r.id, reason: 'requested' });
      return { id: r.id };
    });
    return reply.code(201).send(out);
  });

  // Needs-based selling at a glance: per advisor over the last twelve months, plus what needs compliance attention now.
  app.get('/v1/compliance/needs-analysis/summary', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    gate(ctx);
    return run(ctx, async (tx) => {
      const advisors = (await tx.query(
        `WITH adv AS (SELECT * FROM advice_records WHERE status = 'signed' AND signed_at > now() - interval '12 months')
         SELECT u.id AS "userId", coalesce(u.display_name, u.email::text) AS name, u.email::text AS email,
                count(*) FILTER (WHERE a.kind = 'needs_analysis')::int AS "needsSigned",
                count(*) FILTER (WHERE a.kind = 'recommendation')::int AS "recommendationsSigned",
                count(*) FILTER (WHERE a.kind = 'needs_analysis' AND coalesce((a.answers->>'replacing')::boolean, false))::int AS replacements,
                count(*) FILTER (WHERE cardinality(a.flags) > 0)::int AS flagged,
                (SELECT count(*)::int FROM advice_reviews v WHERE v.advisor_id = u.id AND v.status = 'pending') AS "reviewsPending",
                (SELECT count(*)::int FROM advice_reviews v WHERE v.advisor_id = u.id AND v.status = 'passed') AS "reviewsPassed",
                (SELECT count(*)::int FROM advice_reviews v WHERE v.advisor_id = u.id AND v.status = 'needs_action') AS "reviewsNeedsAction",
                (SELECT count(*)::int FROM gate_overrides o JOIN boxes b ON b.id = o.box_id
                  WHERE 'needs_analysis' = ANY(o.doc_types) AND b.owner_user_id = u.id AND o.created_at > now() - interval '12 months') AS "needsWaived"
           FROM adv a JOIN app_users u ON u.id = a.created_by
          GROUP BY u.id ORDER BY name`)).rows;
      const latest = `SELECT DISTINCT ON (a.box_id) a.box_id, a.valid_until FROM advice_records a JOIN boxes b ON b.id = a.box_id JOIN stages s ON s.id = b.stage_id
                       WHERE a.kind = 'needs_analysis' AND a.status = 'signed' AND NOT s.is_lost ORDER BY a.box_id, a.signed_at DESC`;
      const due = (await tx.query<{ expired: number; soon: number }>(
        `SELECT count(*) FILTER (WHERE valid_until < current_date)::int AS expired, count(*) FILTER (WHERE valid_until BETWEEN current_date AND current_date + 30)::int AS soon FROM (${latest}) x`)).rows[0]!;
      const pending = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM advice_reviews WHERE status = 'pending'`)).rows[0]!.n;
      // Pipelines that look like life sales (from a life template, or with a needs/application stage) but require no needs analysis.
      const pipelinesWithoutGate = (await tx.query(
        `SELECT p.id, p.name, n.name AS owner FROM pipelines p JOIN org_nodes n ON n.id = p.owner_node_id
          WHERE NOT EXISTS (SELECT 1 FROM stages s JOIN stage_doc_requirements r ON r.stage_id = s.id WHERE s.pipeline_id = p.id AND r.doc_type = 'needs_analysis')
            AND (p.template_code IN ('ca_life_health', 'us_life')
                 OR EXISTS (SELECT 1 FROM stages s WHERE s.pipeline_id = p.id AND (s.name ILIKE '%needs analysis%' OR s.name ILIKE '%analyse des besoins%' OR s.name ILIKE '%application%' OR s.name ILIKE '%proposition%' OR s.name ILIKE '%underwriting%')))
          ORDER BY p.name LIMIT 100`)).rows;
      return { advisors, reviewsPending: pending, expired: due.expired, expiringSoon: due.soon, pipelinesWithoutGate };
    });
  });
}
