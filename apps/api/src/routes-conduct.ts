// Conduct risk flags and the complaints log (roadmap Phase 3, feature 11). Switch: CONDUCT_FLAGS_ENABLED (404 when off).
// Flags are worked out every time compliance opens them, under the viewer's own access (a branch officer sees their
// branch only), from signed advice, policy records, complaints and the client file. Compliance records a decision per
// flag; the flag stays quiet until its numbers change. Complaints are logged on a deal by the advisor or compliance and
// resolved by compliance.
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { RULES, complaints, conductFlagsEnabled, earlyLapses, manyPolicies, missingReviews, premiumToIncome, replacementChurn, sortFlags, type Flag } from './conduct.ts';
import type { AppDeps } from './app.ts';

/** Every flag the viewer may see, worked out now. */
export async function conductFlags(tx: Tx): Promise<Flag[]> {
  const R = RULES;
  const churn = (await tx.query<{ node: string; name: string; recs: number; replacements: number }>(
    `SELECT b.owner_node_id AS node, n.name,
            count(DISTINCT b.id) FILTER (WHERE a.kind = 'recommendation')::int AS recs,
            count(DISTINCT b.id) FILTER (WHERE a.kind = 'replacement_disclosure' OR (a.kind = 'needs_analysis' AND a.answers->>'replacing' = 'true'))::int AS replacements
       FROM advice_records a JOIN boxes b ON b.id = a.box_id JOIN org_nodes n ON n.id = b.owner_node_id
      WHERE a.status = 'signed' AND a.signed_at > now() - make_interval(months => $1) GROUP BY 1, 2`, [R.replacement_churn.months])).rows;
  // Policy records are company-wide: keep the producers the viewer supervises.
  const lapses = (await tx.query<{ node: string; name: string; issued: number; early: number }>(
    `SELECT p.producer_node_id AS node, n.name, count(*)::int AS issued,
            count(*) FILTER (WHERE p.status IN ('lapsed', 'cancelled', 'surrendered') AND p.updated_at < p.effective_date + make_interval(months => $1)
                                    AND p.updated_at > now() - make_interval(months => $2))::int AS early
       FROM policy_records p JOIN org_nodes n ON n.id = p.producer_node_id
      WHERE p.effective_date > current_date - interval '36 months' AND org_node_at_or_below(p.tenant_id, p.producer_node_id) GROUP BY 1, 2`,
    [R.early_lapse.withinMonths, R.early_lapse.lookbackMonths])).rows;
  const many = (await tx.query<{ contact: string; name: string; policies: number }>(
    `SELECT c.id AS contact, coalesce(c.full_name, c.email::text, '') AS name, count(DISTINCT pp.policy_id)::int AS policies
       FROM policy_parties pp JOIN policy_records p ON p.id = pp.policy_id JOIN contacts c ON c.id = pp.contact_id
      WHERE pp.role IN ('owner', 'joint_owner', 'insured', 'joint_insured') AND pp.ended_at IS NULL AND p.effective_date > current_date - make_interval(months => $1)
      GROUP BY 1, 2 HAVING count(DISTINCT pp.policy_id) >= $2`, [R.many_policies.months, R.many_policies.minPolicies])).rows;
  const premium = (await tx.query<{ box: string; name: string; monthlyPremium: number; annualIncome: number }>(
    `SELECT b.id AS box, b.name, (r.answers->>'monthlyPremium')::float AS "monthlyPremium",
            coalesce((n.answers->>'annualIncome')::float, 0) + coalesce((n.answers->>'spouseIncome')::float, 0) AS "annualIncome"
       FROM boxes b
       JOIN LATERAL (SELECT answers, linked_advice_id FROM advice_records WHERE box_id = b.id AND kind = 'recommendation' AND status = 'signed' ORDER BY signed_at DESC LIMIT 1) r ON true
       JOIN advice_records n ON n.id = r.linked_advice_id
      WHERE r.answers ? 'monthlyPremium' AND coalesce(r.answers->>'clientDecision', '') <> 'declined'`)).rows;
  const comp = (await tx.query<{ node: string; name: string; count: number; openLate: number }>(
    `SELECT b.owner_node_id AS node, n.name, count(*) FILTER (WHERE c.received_on > current_date - make_interval(months => $1))::int AS count,
            count(*) FILTER (WHERE c.status = 'open' AND c.received_on < current_date - $2::int)::int AS "openLate"
       FROM client_complaints c JOIN boxes b ON b.id = c.box_id JOIN org_nodes n ON n.id = b.owner_node_id GROUP BY 1, 2`, [R.complaints.months, R.complaints.openDays])).rows;
  const missing = (await tx.query<{ contact: string; name: string; policies: number }>(
    `SELECT c.id AS contact, coalesce(c.full_name, c.email::text, '') AS name, count(DISTINCT p.id)::int AS policies
       FROM policy_parties pp JOIN policy_records p ON p.id = pp.policy_id JOIN contacts c ON c.id = pp.contact_id
      WHERE pp.role IN ('owner', 'joint_owner') AND pp.ended_at IS NULL AND p.status IN ('active', 'reinstated')
        AND p.effective_date < current_date - make_interval(months => $1)
        AND NOT EXISTS (SELECT 1 FROM box_contacts bc JOIN advice_records a ON a.box_id = bc.box_id
                         WHERE bc.contact_id = c.id AND a.kind = 'needs_analysis' AND a.status = 'signed' AND a.signed_at > now() - make_interval(months => $2))
      GROUP BY 1, 2`, [R.missing_review.policyOlderMonths, R.missing_review.noAnalysisMonths])).rows;
  return sortFlags([...replacementChurn(churn), ...earlyLapses(lapses), ...manyPolicies(many), ...premiumToIncome(premium), ...complaints(comp), ...missingReviews(missing)]);
}

export function registerConductRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!conductFlagsEnabled()) throw notFound('Not found');
    const i = await deps.authenticate(req);
    requireCrm(i.ctx);
    return i;
  };
  const officer = (ctx: RequestContext) => { if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can see conduct flags'); };
  const nameOf = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;

  app.get('/v1/conduct/flags', async (req) => {
    const { ctx } = await begin(req);
    officer(ctx);
    return run(ctx, async (tx) => {
      const flags = await conductFlags(tx);
      const reviews = (await tx.query<{ subject_type: string; subject_id: string; code: string; fingerprint: string; decision: string; note: string; decided_by_name: string; created_at: string }>(
        `SELECT DISTINCT ON (subject_type, subject_id, code) subject_type, subject_id, code, fingerprint, decision, note, decided_by_name, created_at
           FROM conduct_flag_reviews ORDER BY subject_type, subject_id, code, created_at DESC`)).rows;
      const byKey = new Map(reviews.map((r) => [`${r.subject_type}:${r.subject_id}:${r.code}`, r]));
      const out = flags.map((f) => {
        const r = byKey.get(`${f.subjectType}:${f.subjectId}:${f.code}`);
        const current = !!r && r.fingerprint === f.fingerprint;
        return { ...f, open: !current, lastReview: r ? { decision: r.decision, note: r.note, by: r.decided_by_name, at: r.created_at, sameNumbers: current } : null };
      });
      return { flags: out, rules: RULES, open: out.filter((f) => f.open).length };
    });
  });

  app.post('/v1/conduct/flags/review', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['subjectType', 'subjectId', 'code', 'fingerprint', 'decision', 'note'], properties: {
      subjectType: { enum: ['advisor', 'client', 'deal'] }, subjectId: uuid, code: { type: 'string', pattern: '^[a-z_]{3,40}$' }, fingerprint: { type: 'string', maxLength: 200 },
      decision: { enum: ['no_concern', 'action_taken'] }, note: { type: 'string', minLength: 10, maxLength: 2000 } } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const b = req.body as { subjectType: string; subjectId: string; code: string; fingerprint: string; decision: string; note: string };
    const out = await run(ctx, async (tx) => {
      // Only a flag the viewer can see now, with the numbers they saw.
      if (!(await conductFlags(tx)).some((f) => f.subjectType === b.subjectType && f.subjectId === b.subjectId && f.code === b.code && f.fingerprint === b.fingerprint)) {
        throw invalid('That flag is not showing any more, or its numbers changed. Reload and try again.');
      }
      const r = (await tx.query<{ id: string }>(`INSERT INTO conduct_flag_reviews (tenant_id, subject_type, subject_id, code, fingerprint, decision, note, decided_by, decided_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, b.subjectType, b.subjectId, b.code, b.fingerprint, b.decision, b.note.trim(), ctx.userId, await nameOf(tx, ctx)])).rows[0]!;
      await audit(tx, ctx, 'conduct_flag_reviewed', b.subjectType === 'advisor' ? 'org_node' : b.subjectType === 'deal' ? 'box' : 'contact', b.subjectId, { code: b.code, decision: b.decision });
      return r;
    });
    return reply.code(201).send(out);
  });

  // ---- complaints on a deal ----
  app.get('/v1/boxes/:id/complaints', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM boxes WHERE id = $1', [id])).rowCount) throw notFound('Deal not found');
      const rows = (await tx.query(`SELECT id, received_on::text AS "receivedOn", channel, category, summary, recorded_by_name AS "recordedBy", status, outcome, resolved_on::text AS "resolvedOn", resolved_by_name AS "resolvedBy"
          FROM client_complaints WHERE box_id = $1 ORDER BY received_on DESC, created_at DESC LIMIT 50`, [id])).rows;
      return { complaints: rows, canResolve: canWaive(ctx) };
    });
  });

  app.post('/v1/boxes/:id/complaints', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['receivedOn', 'channel', 'category', 'summary'], properties: {
      receivedOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, channel: { enum: ['email', 'phone', 'letter', 'in_person', 'regulator', 'carrier', 'other'] },
      category: { enum: ['advice', 'service', 'disclosure', 'claims', 'premium', 'privacy', 'conduct', 'other'] }, summary: { type: 'string', minLength: 10, maxLength: 2000 } } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { receivedOn: string; channel: string; category: string; summary: string };
    if (b.receivedOn > new Date().toISOString().slice(0, 10)) throw invalid('The date received cannot be in the future');
    const out = await run(ctx, async (tx) => {
      const bx = (await tx.query<{ owner_node_id: string; owner_user_id: string | null }>('SELECT owner_node_id, owner_user_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!bx) throw notFound('Deal not found');
      if (!canWaive(ctx)) requireEdit(ctx, bx.owner_node_id);
      const r = (await tx.query<{ id: string }>(`INSERT INTO client_complaints (tenant_id, box_id, advisor_id, received_on, channel, category, summary, recorded_by, recorded_by_name) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [ctx.tenantId, id, bx.owner_user_id, b.receivedOn, b.channel, b.category, b.summary.trim(), ctx.userId, await nameOf(tx, ctx)])).rows[0]!;
      await audit(tx, ctx, 'complaint_recorded', 'box', id, { complaint: r.id, category: b.category }, bx.owner_node_id);
      return r;
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/complaints/:id/resolve', { schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['outcome'], properties: { outcome: { type: 'string', minLength: 10, maxLength: 2000 } } } } }, async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can resolve a complaint');
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const c = (await tx.query<{ box_id: string; status: string }>('SELECT box_id, status FROM client_complaints WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw notFound('Complaint not found');
      if (c.status !== 'open') throw invalid('This complaint is already resolved');
      await tx.query(`UPDATE client_complaints SET status = 'resolved', outcome = $2, resolved_on = current_date, resolved_by_name = $3 WHERE id = $1`, [id, (req.body as { outcome: string }).outcome.trim(), await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'complaint_resolved', 'box', c.box_id, { complaint: id });
      return { status: 'resolved' };
    });
  });
}
