// Supervision rules and escalation (roadmap Phase 2, feature 9). Switch: SUPERVISION_ENABLED (404 when off; the gate
// check does nothing). Compliance (or a tenant admin) writes the rules on the Compliance page. A rule that applies to a
// deal entering a stage adds paperwork (waivable like any other) and/or a compliance review. The advisor asks for the
// review from the deal's Files tab; it lands in compliance's queue with a deadline, escalates when overdue, and the
// deal can enter the stage once it is approved.
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { DOC_TYPES, DOC_TYPE_LABELS, isDocType, type DocType, type RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { gateStatus } from './gates.ts';
import { notify } from './notify.ts';
import { actingAs } from './effects.ts';
import { describeRule, provinceCode, ruleApplies, supervisionEnabled, type DealFacts, type Rule } from './supervision.ts';
import type { AppDeps } from './app.ts';

const RULE_COLS = 'id, name, active, risk, pipeline_id, stage_id, min_deal_value, min_coverage, product_line, province, replacing_only, required_docs, review_required, review_hours, escalate_to, updated_by_name, updated_at';
const label = (t: string) => (isDocType(t) ? DOC_TYPE_LABELS[t as DocType].en : t);

/** What the deal holds that rules can test: pipeline, value, recommended cover, product line, client province, replacement. */
export async function dealFacts(tx: Tx, boxId: string): Promise<DealFacts | null> {
  const b = (await tx.query<{ pipeline_id: string; value_amount: string | null }>('SELECT pipeline_id, value_amount FROM boxes WHERE id = $1', [boxId])).rows[0];
  if (!b) return null;
  const adv = async (kind: string) => (await tx.query<{ answers: Record<string, unknown> | null }>(
    `SELECT answers FROM advice_records WHERE box_id = $1 AND kind = $2 AND answers IS NOT NULL ORDER BY (status = 'signed') DESC, coalesce(signed_at, created_at) DESC LIMIT 1`, [boxId, kind])).rows[0]?.answers ?? null;
  const na = await adv('needs_analysis'), rec = await adv('recommendation');
  const intakeProv = (await tx.query<{ p: string | null }>(`SELECT answers->'about'->>'province' AS p FROM client_intakes WHERE box_id = $1 AND status IN ('submitted','applied') ORDER BY submitted_at DESC LIMIT 1`, [boxId])).rows[0]?.p ?? null;
  return {
    pipelineId: b.pipeline_id, valueAmount: b.value_amount == null ? null : Number(b.value_amount),
    coverage: typeof rec?.coverageAmount === 'number' ? rec.coverageAmount : null,
    productLine: typeof na?.productLine === 'string' ? na.productLine : null,
    province: provinceCode(intakeProv) ?? provinceCode(na?.advisorProvince),
    replacing: na?.replacing === true,
  };
}

/** Rules that apply when this deal enters this stage, and where each stands. */
export async function supervisionFor(tx: Tx, stageId: string, boxId: string) {
  const st = (await tx.query<{ id: string; is_won: boolean; name: string }>('SELECT id, is_won, name FROM stages WHERE id = $1', [stageId])).rows[0];
  const f = await dealFacts(tx, boxId);
  if (!st || !f) return { stageName: '', rules: [] as Rule[], docs: [] as string[], unreviewed: [] as Rule[] };
  const rules = (await tx.query<Rule>(`SELECT ${RULE_COLS} FROM supervision_rules WHERE active ORDER BY name`)).rows.filter((r) => ruleApplies(r, f, { id: st.id, isWon: st.is_won }));
  const docs = [...new Set(rules.flatMap((r) => r.required_docs))];
  const approved = new Set((await tx.query<{ rule_id: string }>(`SELECT rule_id FROM supervision_reviews WHERE box_id = $1 AND status = 'approved'`, [boxId])).rows.map((r) => r.rule_id));
  return { stageName: st.name, rules, docs, unreviewed: rules.filter((r) => r.review_required && !approved.has(r.id)) };
}

/** Called by the stage gates: refuse the move while a rule's paperwork is missing or its review is not approved. */
export async function checkSupervision(tx: Tx, stageId: string, boxId: string): Promise<void> {
  if (!supervisionEnabled()) return;
  const s = await supervisionFor(tx, stageId, boxId);
  if (!s.rules.length) return;
  if (s.docs.length) {
    const g = await gateStatus(tx, stageId, boxId, s.docs);
    const missing = (g?.missing ?? []).filter((t) => s.docs.includes(t));
    if (missing.length) {
      const by = s.rules.filter((r) => r.required_docs.some((t) => missing.includes(t))).map((r) => `“${r.name}”`).join(', ');
      throw new HttpError(409, 'gate_blocked', `To move to “${s.stageName}”, file: ${missing.map(label).join(', ')} (company rule ${by})`);
    }
  }
  if (s.unreviewed.length) {
    throw new HttpError(409, 'review_needed', `To move to “${s.stageName}”, compliance must review this deal under ${s.unreviewed.map((r) => `“${r.name}”`).join(', ')}. Ask for the review on the deal's Files tab.`);
  }
}

/** Compliance officers and company administrators, read with the sign-in role so any requester can reach them. */
async function complianceUsers(deps: AppDeps, tenantId: string): Promise<{ id: string; name: string }[]> {
  return (await deps.authPool.query<{ id: string; name: string }>(
    `SELECT DISTINCT u.id, coalesce(u.display_name, u.email::text) AS name FROM app_users u JOIN user_node_roles r ON r.user_id = u.id
      WHERE u.tenant_id = $1 AND u.status <> 'disabled'
        AND (r.role = 'compliance' OR (r.role = 'admin' AND r.node_id = (SELECT id FROM org_nodes WHERE tenant_id = $1 AND type = 'tenant')))
      ORDER BY 2 LIMIT 50`, [tenantId])).rows;
}

export function registerSupervisionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!supervisionEnabled()) throw notFound('Not found');
    const i = await deps.authenticate(req);
    requireCrm(i.ctx);
    return i;
  };
  const nameOf = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
  // null first: with type coercion on, a null would otherwise be read as 0 or ''.
  const money = { anyOf: [{ type: 'null' }, { type: 'number', minimum: 0, maximum: 1e12 }] } as const;
  const ruleProps = {
    name: { type: 'string', minLength: 3, maxLength: 120 }, active: { type: 'boolean' }, risk: { enum: ['low', 'medium', 'high'] },
    pipelineId: { anyOf: [{ type: 'null' }, uuid] }, stageId: { anyOf: [{ type: 'null' }, uuid] }, minDealValue: money, minCoverage: money,
    productLine: { anyOf: [{ type: 'null' }, { enum: ['life_health', 'annuity'] }] }, province: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^[A-Z]{2}$' }] },
    replacingOnly: { type: 'boolean' }, requiredDocs: { type: 'array', maxItems: 10, uniqueItems: true, items: { enum: [...DOC_TYPES] } },
    reviewRequired: { type: 'boolean' }, reviewHours: { type: 'integer', minimum: 1, maximum: 720 }, escalateTo: { anyOf: [{ type: 'null' }, uuid] },
  } as const;
  type RuleIn = { name?: string; active?: boolean; risk?: string; pipelineId?: string | null; stageId?: string | null; minDealValue?: number | null; minCoverage?: number | null; productLine?: string | null; province?: string | null; replacingOnly?: boolean; requiredDocs?: string[]; reviewRequired?: boolean; reviewHours?: number; escalateTo?: string | null };
  const COLMAP: Record<keyof RuleIn, string> = { name: 'name', active: 'active', risk: 'risk', pipelineId: 'pipeline_id', stageId: 'stage_id', minDealValue: 'min_deal_value', minCoverage: 'min_coverage',
    productLine: 'product_line', province: 'province', replacingOnly: 'replacing_only', requiredDocs: 'required_docs', reviewRequired: 'review_required', reviewHours: 'review_hours', escalateTo: 'escalate_to' };
  async function checkRefs(tx: Tx, ctx: RequestContext, b: RuleIn) {
    if (b.stageId && !(await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [b.stageId, b.pipelineId ?? null])).rowCount) throw invalid('Choose a stage in the chosen pipeline');
    if (b.escalateTo && !(await complianceUsers(deps, ctx.tenantId)).some((u) => u.id === b.escalateTo)) throw invalid('Escalate to someone in compliance or a company administrator');
  }
  const out = (r: Rule & { active: boolean; updated_by_name: string; updated_at: string }, names: Map<string, string>) => ({
    id: r.id, name: r.name, active: r.active, risk: r.risk, pipelineId: r.pipeline_id, stageId: r.stage_id, minDealValue: r.min_deal_value == null ? null : Number(r.min_deal_value),
    minCoverage: r.min_coverage == null ? null : Number(r.min_coverage), productLine: r.product_line, province: r.province, replacingOnly: r.replacing_only, requiredDocs: r.required_docs,
    reviewRequired: r.review_required, reviewHours: r.review_hours, escalateTo: r.escalate_to, updatedBy: r.updated_by_name, updatedAt: r.updated_at,
    description: describeRule(r, { pipeline: r.pipeline_id ? names.get(r.pipeline_id) : null, stage: r.stage_id ? names.get(r.stage_id) : null }),
  });
  const names = async (tx: Tx) => new Map([...(await tx.query<{ id: string; name: string }>('SELECT id, name FROM pipelines')).rows, ...(await tx.query<{ id: string; name: string }>('SELECT id, name FROM stages')).rows].map((r) => [r.id, r.name]));

  app.get('/v1/supervision/rules', async (req) => {
    const { ctx } = await begin(req);
    return run(ctx, async (tx) => {
      const n = await names(tx);
      const rules = (await tx.query(`SELECT ${RULE_COLS} FROM supervision_rules ORDER BY active DESC, name`)).rows.map((r) => out(r, n));
      const pipelines = (await tx.query<{ id: string; name: string; stages: { id: string; name: string }[] }>(
        `SELECT p.id, p.name, coalesce((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.position) FROM stages s WHERE s.pipeline_id = p.id), '[]') AS stages FROM pipelines p ORDER BY p.name`)).rows;
      return { rules, pipelines, people: await complianceUsers(deps, ctx.tenantId), canChange: canWaive(ctx) };
    });
  });

  app.post('/v1/supervision/rules', { schema: { body: { type: 'object', additionalProperties: false, required: ['name'], properties: ruleProps } } }, async (req, reply) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can write supervision rules');
    const b = req.body as RuleIn;
    if (!b.reviewRequired && !(b.requiredDocs ?? []).length) throw invalid('A rule needs paperwork, a compliance review, or both');
    const r = await run(ctx, async (tx) => {
      await checkRefs(tx, ctx, b);
      const keys = (Object.keys(b) as (keyof RuleIn)[]).filter((k) => b[k] !== undefined);
      const row = (await tx.query<{ id: string }>(
        `INSERT INTO supervision_rules (tenant_id, updated_by_name, ${keys.map((k) => COLMAP[k]).join(', ')}) VALUES ($1, $2, ${keys.map((_, i) => `$${i + 3}`).join(', ')}) RETURNING id`,
        [ctx.tenantId, await nameOf(tx, ctx), ...keys.map((k) => b[k])])).rows[0]!;
      await audit(tx, ctx, 'supervision_rule_created', 'tenant', ctx.tenantId, { rule: row.id, name: b.name });
      return row;
    });
    return reply.code(201).send(r);
  });

  app.patch('/v1/supervision/rules/:id', { schema: { params: idp, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: ruleProps } } }, async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can change supervision rules');
    const { id } = req.params as { id: string };
    const b = req.body as RuleIn;
    return run(ctx, async (tx) => {
      const cur = (await tx.query<{ pipeline_id: string | null }>('SELECT pipeline_id FROM supervision_rules WHERE id = $1', [id])).rows[0];
      if (!cur) throw notFound('Rule not found');
      await checkRefs(tx, ctx, { ...b, pipelineId: b.pipelineId !== undefined ? b.pipelineId : cur.pipeline_id });
      const keys = (Object.keys(b) as (keyof RuleIn)[]).filter((k) => b[k] !== undefined);
      await tx.query(`UPDATE supervision_rules SET ${keys.map((k, i) => `${COLMAP[k]} = $${i + 2}`).join(', ')}, updated_by_name = $${keys.length + 2}, updated_at = now() WHERE id = $1`,
        [id, ...keys.map((k) => b[k]), await nameOf(tx, ctx)]);
      await audit(tx, ctx, 'supervision_rule_changed', 'tenant', ctx.tenantId, { rule: id, fields: keys });
      return { ok: true };
    });
  });

  // On a deal: every rule that applies to it at some stage of its pipeline, with what each needs.
  app.get('/v1/boxes/:id/supervision', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const f = await dealFacts(tx, id);
      if (!f) throw notFound('Deal not found');
      const n = await names(tx);
      const stages = (await tx.query<{ id: string; is_won: boolean }>('SELECT id, is_won FROM stages WHERE pipeline_id = $1 ORDER BY position', [f.pipelineId])).rows;
      const rules = (await tx.query<Rule & { active: boolean; updated_by_name: string; updated_at: string }>(`SELECT ${RULE_COLS} FROM supervision_rules WHERE active ORDER BY name`)).rows;
      const reviews = (await tx.query(`SELECT id, rule_id AS "ruleId", status, requested_by_name AS "requestedBy", request_note AS "requestNote", due_at AS "dueAt", due_at < now() AND status = 'pending' AS overdue,
          decided_by_name AS "decidedBy", decision_note AS "decisionNote", decided_at AS "decidedAt", created_at AS "createdAt" FROM supervision_reviews WHERE box_id = $1 ORDER BY created_at DESC`, [id])).rows;
      const items = [];
      for (const r of rules) {
        const at = stages.filter((s) => ruleApplies(r, f, { id: s.id, isWon: s.is_won }));
        if (!at.length) continue;
        const g = r.required_docs.length ? await gateStatus(tx, at[0]!.id, id, r.required_docs) : null;
        items.push({ ...out(r, n), stage: n.get(at[0]!.id) ?? '', missing: (g?.missing ?? []).filter((t) => r.required_docs.includes(t)), review: reviews.find((v) => v.ruleId === r.id) ?? null });
      }
      return { rules: items, facts: f };
    });
  });

  app.post('/v1/boxes/:id/supervision/:ruleId/request', {
    schema: { params: { type: 'object', properties: { id: uuid, ruleId: uuid } }, body: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', maxLength: 1000 } } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const { id, ruleId } = req.params as { id: string; ruleId: string };
    const note = ((req.body as { note?: string } | undefined)?.note ?? '').trim() || null;
    const r = await run(ctx, async (tx) => {
      const bx = (await tx.query<{ owner_node_id: string; name: string }>('SELECT owner_node_id, name FROM boxes WHERE id = $1', [id])).rows[0];
      if (!bx) throw notFound('Deal not found');
      requireEdit(ctx, bx.owner_node_id);
      const rule = (await tx.query<Rule>(`SELECT ${RULE_COLS} FROM supervision_rules WHERE id = $1 AND active`, [ruleId])).rows[0];
      if (!rule || !rule.review_required) throw invalid('That rule does not ask for a review');
      const f = (await dealFacts(tx, id))!;
      const stages = (await tx.query<{ id: string; is_won: boolean }>('SELECT id, is_won FROM stages WHERE pipeline_id = $1', [f.pipelineId])).rows;
      if (!stages.some((s) => ruleApplies(rule, f, { id: s.id, isWon: s.is_won }))) throw invalid('That rule does not apply to this deal');
      if ((await tx.query(`SELECT 1 FROM supervision_reviews WHERE box_id = $1 AND rule_id = $2 AND status IN ('pending','approved')`, [id, ruleId])).rowCount) throw new HttpError(409, 'review_exists', 'A review under this rule is already pending or approved');
      const me = await nameOf(tx, ctx);
      const row = (await tx.query<{ id: string; due_at: string }>(
        `INSERT INTO supervision_reviews (tenant_id, box_id, rule_id, status, requested_by, requested_by_name, request_note, due_at) VALUES ($1,$2,$3,'pending',$4,$5,$6, now() + make_interval(hours => $7)) RETURNING id, due_at`,
        [ctx.tenantId, id, ruleId, ctx.userId, me, note, rule.review_hours])).rows[0]!;
      for (const u of await complianceUsers(deps, ctx.tenantId)) await notify(tx, { tenantId: ctx.tenantId, userId: u.id, actorId: ctx.userId, kind: 'compliance_review', boxId: id, data: { supervision: 'requested', rule: rule.name, deal: bx.name, name: me } });
      await audit(tx, ctx, 'supervision_review_requested', 'box', id, { review: row.id, rule: ruleId }, bx.owner_node_id);
      return row;
    });
    return reply.code(201).send({ id: r.id, dueAt: r.due_at });
  });

  app.get('/v1/supervision/queue', async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can see the review queue');
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT v.id, v.box_id AS "boxId", b.name AS "dealName", r.name AS "ruleName", r.risk, v.status, v.requested_by_name AS "requestedBy", v.request_note AS "requestNote",
                v.due_at AS "dueAt", v.due_at < now() AND v.status = 'pending' AS overdue, v.escalated_at AS "escalatedAt", v.decided_by_name AS "decidedBy", v.decision_note AS "decisionNote",
                v.decided_at AS "decidedAt", v.requested_by = $1 AS mine
           FROM supervision_reviews v JOIN boxes b ON b.id = v.box_id JOIN supervision_rules r ON r.id = v.rule_id
          WHERE v.status = 'pending' OR v.decided_at > now() - interval '7 days'
          ORDER BY (v.status = 'pending') DESC, (v.due_at < now()) DESC, CASE r.risk WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, v.due_at LIMIT 200`, [ctx.userId])).rows;
      return { pending: rows.filter((r) => r.status === 'pending'), recent: rows.filter((r) => r.status !== 'pending') };
    });
  });

  app.post('/v1/supervision/reviews/:id/decide', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['decision', 'note'], properties: { decision: { enum: ['approved', 'rejected'] }, note: { type: 'string', minLength: 10, maxLength: 1000 } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can decide a review');
    const { id } = req.params as { id: string };
    const b = req.body as { decision: 'approved' | 'rejected'; note: string };
    return run(ctx, async (tx) => {
      const v = (await tx.query<{ box_id: string; status: string; requested_by: string; rule: string; deal: string; owner_node_id: string }>(
        `SELECT v.box_id, v.status, v.requested_by, r.name AS rule, b.name AS deal, b.owner_node_id FROM supervision_reviews v JOIN supervision_rules r ON r.id = v.rule_id JOIN boxes b ON b.id = v.box_id WHERE v.id = $1 FOR UPDATE OF v`, [id])).rows[0];
      if (!v) throw notFound('Review not found');
      if (v.status !== 'pending') throw invalid('This review has already been decided');
      if (v.requested_by === ctx.userId) throw forbidden('Someone else must decide a review you asked for');
      const me = await nameOf(tx, ctx);
      await tx.query(`UPDATE supervision_reviews SET status = $2, decided_by = $3, decided_by_name = $4, decision_note = $5, decided_at = now() WHERE id = $1`, [id, b.decision, ctx.userId, me, b.note.trim()]);
      await notify(tx, { tenantId: ctx.tenantId, userId: v.requested_by, actorId: ctx.userId, kind: 'compliance_review', boxId: v.box_id, data: { supervision: b.decision, rule: v.rule, deal: v.deal, reviewer: me, note: b.note.trim().slice(0, 200) } });
      await audit(tx, ctx, `supervision_review_${b.decision}`, 'box', v.box_id, { review: id }, v.owner_node_id);
      return { status: b.decision };
    });
  });
}

/** Overdue reviews: tell the rule's escalation person (or every compliance officer) once. Runs in the background sweep. */
export async function sweepSupervision(deps: AppDeps): Promise<number> {
  if (!supervisionEnabled()) return 0;
  const due = (await deps.authPool.query<{ id: string; tenant_id: string; box_id: string; requested_by: string; node: string; escalate_to: string | null; rule: string }>(
    `SELECT v.id, v.tenant_id, v.box_id, v.requested_by, u.home_node_id AS node, r.escalate_to, r.name AS rule
       FROM supervision_reviews v JOIN supervision_rules r ON r.id = v.rule_id JOIN app_users u ON u.id = v.requested_by
      WHERE v.status = 'pending' AND v.due_at < now() AND v.escalated_at IS NULL ORDER BY v.due_at LIMIT 200`)).rows;
  let n = 0;
  for (const d of due) {
    try {
      const ctx = { ...actingAs(d.tenant_id, d.requested_by, d.node), isTenantAdmin: true };
      const res = await withRequestTx(deps.appPool, ctx, async (tx) => {
        const deal = (await tx.query<{ name: string }>('SELECT name FROM boxes WHERE id = $1', [d.box_id])).rows[0]?.name ?? '';
        const people = d.escalate_to ? [{ id: d.escalate_to }] : await complianceUsers(deps, d.tenant_id);
        for (const u of people) await notify(tx, { tenantId: d.tenant_id, userId: u.id, actorId: d.requested_by, kind: 'compliance_review', boxId: d.box_id, data: { supervision: 'overdue', rule: d.rule, deal } });
        await tx.query('UPDATE supervision_reviews SET escalated_at = now() WHERE id = $1', [d.id]);
        return { to: people.map((p) => p.id), deal };
      });
      const to = res.to, dealName = res.deal;
      if (deps.mailer && to.length) {
        const emails = (await deps.authPool.query<{ email: string }>('SELECT email::text AS email FROM app_users WHERE id = ANY($1)', [to])).rows;
        for (const e of emails) void deps.mailer.send({ to: e.email, subject: `Overdue compliance review: ${dealName}`, text: `The compliance review of “${dealName}” under the rule “${d.rule}” is past its deadline. Open the Compliance page in PII to decide it.`, html: `<p>The compliance review of “${dealName.replace(/[<>&]/g, '')}” under the rule “${d.rule.replace(/[<>&]/g, '')}” is past its deadline. Open the Compliance page in PII to decide it.</p>` }).catch(() => undefined);
      }
      n++;
    } catch (e) { if (process.env.PII_DEBUG_DB) console.error('supervision sweep', e); /* next review */ }
  }
  return n;
}
