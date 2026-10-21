// File review sampling (roadmap Phase 3, feature 10). Switch: FILE_REVIEWS_ENABLED (404 when off).
// Each compliance officer gets a monthly sample of the deals they supervise (drawn on the 1st by the background sweep,
// or now with "Draw this month's sample"); compliance can also add a deal by hand. The officer works the checklist,
// writes findings and a fix-by date; the advisor marks them fixed on the deal; the officer closes or reopens. Late fixes
// are reminded once. Everything runs under the officer's own access: they only ever sample deals they can see.
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { tenantSettingInt } from './needs-analysis.ts';
import { notify } from './notify.ts';
import { contextOf } from './routes-eid.ts';
import { currentAdvice, suitabilityFiled } from './routes-suitability.ts';
import { suitabilityEnabled } from './suitability.ts';
import { CHECKLIST, cleanChecklist, drawSample, fileReviewsEnabled, period, riskScore, type Answer } from './file-reviews.ts';
import type { AppDeps } from './app.ts';

const FACTS = `
  coalesce(b.value_amount, 0)::float AS value,
  (SELECT (a.answers->>'coverageAmount')::float FROM advice_records a WHERE a.box_id = b.id AND a.kind = 'recommendation' AND a.answers ? 'coverageAmount' ORDER BY (a.status = 'signed') DESC, a.created_at DESC LIMIT 1) AS cover,
  EXISTS (SELECT 1 FROM advice_records a WHERE a.box_id = b.id AND a.kind = 'needs_analysis' AND a.answers->>'replacing' = 'true') AS replacing,
  (SELECT coalesce(sum(cardinality(a.flags)), 0)::int FROM advice_records a WHERE a.box_id = b.id AND a.status = 'signed') AS flags,
  (SELECT count(*)::int FROM (SELECT DISTINCT ON (s.list) s.result FROM screening_results s WHERE s.box_id = b.id ORDER BY s.list, s.created_at DESC) x WHERE x.result = 'hit') AS hits,
  (SELECT count(*)::int FROM cash_transactions c WHERE c.box_id = b.id AND c.report_required) AS cash,
  EXISTS (SELECT 1 FROM client_id_records r WHERE r.box_id = b.id AND r.result = 'verified') AS id_ok,
  EXISTS (SELECT 1 FROM client_consents k WHERE k.box_id = b.id AND k.kind = 'collection_use' AND k.withdrawn_at IS NULL) AS consent_ok,
  coalesce((SELECT u.created_at > now() - interval '90 days' FROM app_users u WHERE u.id = b.owner_user_id), false) AS new_advisor,
  (SELECT count(*)::int FROM file_reviews f JOIN boxes b2 ON b2.id = f.box_id WHERE b.owner_user_id IS NOT NULL AND b2.owner_user_id = b.owner_user_id
      AND f.status IN ('findings', 'fixed', 'closed') AND f.created_at > now() - interval '12 months') AS past`;
type FactRow = { id: string; name: string; owner_user_id: string | null; value: number; cover: number | null; replacing: boolean; flags: number; hits: number; cash: number; id_ok: boolean; consent_ok: boolean; new_advisor: boolean; past: number };
const scoreOf = (r: FactRow) => riskScore({ replacing: r.replacing, amount: Math.max(r.value ?? 0, r.cover ?? 0) || null, adviceFlags: r.flags, openHits: r.hits, cashReports: r.cash, newAdvisor: r.new_advisor, pastFindings: r.past, idVerified: r.id_ok, privacyConsent: r.consent_ok });

/** What PII can suggest for the checklist from the deal as it stands. */
async function suggestions(tx: Tx, boxId: string): Promise<Record<string, Answer>> {
  const f = (await tx.query<{ id_ok: boolean; consent_ok: boolean; na_current: boolean; replacing: boolean; disclosure: boolean; screened: boolean; hits: number; notes: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM client_id_records r WHERE r.box_id = $1 AND r.result = 'verified') AS id_ok,
            EXISTS (SELECT 1 FROM client_consents k WHERE k.box_id = $1 AND k.kind = 'collection_use' AND k.withdrawn_at IS NULL) AS consent_ok,
            EXISTS (SELECT 1 FROM advice_records a WHERE a.box_id = $1 AND a.kind = 'needs_analysis' AND a.status = 'signed' AND (a.valid_until IS NULL OR a.valid_until >= current_date)) AS na_current,
            EXISTS (SELECT 1 FROM advice_records a WHERE a.box_id = $1 AND a.kind = 'needs_analysis' AND a.status = 'signed' AND a.answers->>'replacing' = 'true') AS replacing,
            EXISTS (SELECT 1 FROM advice_records a WHERE a.box_id = $1 AND a.kind = 'replacement_disclosure' AND a.status = 'signed') AS disclosure,
            EXISTS (SELECT 1 FROM screening_results s WHERE s.box_id = $1) AS screened,
            (SELECT count(*)::int FROM (SELECT DISTINCT ON (s.list) s.result FROM screening_results s WHERE s.box_id = $1 ORDER BY s.list, s.created_at DESC) x WHERE x.result = 'hit') AS hits,
            EXISTS (SELECT 1 FROM notes n WHERE n.box_id = $1) AS notes`, [boxId])).rows[0]!;
  const yn = (v: boolean): Answer => (v ? 'yes' : 'no');
  return {
    id_on_file: yn(f.id_ok), privacy_consent: yn(f.consent_ok), needs_analysis_current: yn(f.na_current),
    recommendation_linked: yn(!!(await currentAdvice(tx, boxId))), replacement_disclosure: f.replacing ? yn(f.disclosure) : 'na',
    suitability_decided: suitabilityEnabled() ? yn(await suitabilityFiled(tx, boxId)) : 'na',
    screening_clear: yn(f.screened && f.hits === 0), meeting_notes: yn(f.notes),
  };
}

/** Draw (or top up) one officer's sample for this month, under their own access. Returns how many were added. */
export async function drawFor(deps: AppDeps, ctx: RequestContext, size: number, rand?: () => number): Promise<number> {
  const p = period();
  return withRequestTx(deps.appPool, ctx, async (tx) => {
    const have = (await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM file_reviews WHERE reviewer_id = $1 AND period = $2 AND reason <> 'requested'`, [ctx.userId, p])).rows[0]!.n;
    if (have >= size) return 0;
    const cands = (await tx.query<FactRow>(
      `SELECT b.id, b.name, b.owner_user_id, ${FACTS}
         FROM boxes b JOIN stages s ON s.id = b.stage_id
        WHERE NOT s.is_lost AND b.owner_user_id IS DISTINCT FROM $1
          AND (b.stage_entered_at > now() - interval '60 days' OR b.updated_at > now() - interval '60 days'
               OR EXISTS (SELECT 1 FROM advice_records a WHERE a.box_id = b.id AND a.status = 'signed' AND a.signed_at > now() - interval '90 days'))
          AND NOT EXISTS (SELECT 1 FROM file_reviews f WHERE f.box_id = b.id AND f.created_at > now() - interval '12 months')
        ORDER BY b.updated_at DESC LIMIT 500`, [ctx.userId])).rows;
    if (!cands.length) return 0;
    const me = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
    const scored = cands.map((c) => ({ ...c, ...scoreOf(c) }));
    let added = 0;
    for (const { pick, reason } of drawSample(scored, size - have, rand)) {
      const r = await tx.query(`INSERT INTO file_reviews (tenant_id, box_id, period, reviewer_id, reviewer_name, advisor_id, reason, risk_score, risk_reasons) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (box_id, period) DO NOTHING`,
        [ctx.tenantId, pick.id, p, ctx.userId, me, pick.owner_user_id, reason, pick.score, pick.reasons]);
      added += r.rowCount ?? 0;
    }
    await audit(tx, ctx, 'file_reviews_drawn', 'tenant', ctx.tenantId, { period: p, added });
    return added;
  });
}

export function registerFileReviewRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!fileReviewsEnabled()) throw notFound('Not found');
    const i = await deps.authenticate(req);
    requireCrm(i.ctx);
    return i;
  };
  const officer = (ctx: RequestContext) => { if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can review files'); };
  const reviewOf = async (tx: Tx, id: string) => {
    const r = (await tx.query<{ id: string; box_id: string; status: string; reviewer_id: string; advisor_id: string | null; name: string; owner_node_id: string; fix_by: string | null }>(
      `SELECT f.id, f.box_id, f.status, f.reviewer_id, f.advisor_id, b.name, b.owner_node_id, f.fix_by::text AS fix_by FROM file_reviews f JOIN boxes b ON b.id = f.box_id WHERE f.id = $1 FOR UPDATE OF f`, [id])).rows[0];
    if (!r) throw notFound('File review not found');
    return r;
  };
  const cols = `f.id, f.box_id AS "boxId", b.name AS "dealName", f.period, f.reviewer_name AS "reviewer", f.reason, f.risk_score AS "riskScore", f.risk_reasons AS "riskReasons", f.status,
    f.checklist, f.findings, f.fix_by::text AS "fixBy", f.fix_by < current_date AND f.status = 'findings' AS late, f.reviewed_at AS "reviewedAt", f.fixed_note AS "fixedNote", f.fixed_by_name AS "fixedBy",
    f.fixed_at AS "fixedAt", f.closed_note AS "closedNote", f.closed_at AS "closedAt", (SELECT coalesce(u.display_name, u.email::text) FROM app_users u WHERE u.id = f.advisor_id) AS advisor`;

  app.get('/v1/file-reviews', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { period: { type: 'string', pattern: '^\\d{4}-\\d{2}$' } } } } }, async (req) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const p = (req.query as { period?: string }).period ?? period();
    return run(ctx, async (tx) => {
      const mine = (await tx.query(`SELECT ${cols} FROM file_reviews f JOIN boxes b ON b.id = f.box_id WHERE (f.period = $1 OR f.status IN ('open','findings','fixed')) AND (f.reviewer_id = $2 OR $3)
          ORDER BY (f.status = 'fixed') DESC, (f.status = 'open') DESC, f.risk_score DESC, b.name LIMIT 300`, [p, ctx.userId, ctx.isTenantAdmin])).rows;
      return { period: p, reviews: mine, sampleSize: await tenantSettingInt(tx, 'compliance.fileSampleSize', 5), checklist: CHECKLIST.map((c) => c.key) };
    });
  });

  app.post('/v1/file-reviews/draw', async (req) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const size = await run(ctx, (tx) => tenantSettingInt(tx, 'compliance.fileSampleSize', 5));
    return { added: await drawFor(deps, ctx, Math.max(size, 1)) };
  });

  app.post('/v1/boxes/:id/file-review', { schema: { params: idp } }, async (req, reply) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const { id } = req.params as { id: string };
    const out = await run(ctx, async (tx) => {
      const b = (await tx.query<FactRow & { owner_node_id: string }>(`SELECT b.id, b.name, b.owner_user_id, b.owner_node_id, ${FACTS} FROM boxes b WHERE b.id = $1`, [id])).rows[0];
      if (!b) throw notFound('Deal not found');
      if (b.owner_user_id === ctx.userId) throw forbidden('Someone else must review your own deal');
      const s = scoreOf(b);
      const me = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      const r = (await tx.query<{ id: string }>(`INSERT INTO file_reviews (tenant_id, box_id, period, reviewer_id, reviewer_name, advisor_id, reason, risk_score, risk_reasons) VALUES ($1,$2,$3,$4,$5,$6,'requested',$7,$8)
          ON CONFLICT (box_id, period) DO NOTHING RETURNING id`, [ctx.tenantId, id, period(), ctx.userId, me, b.owner_user_id, s.score, s.reasons])).rows[0];
      if (!r) throw invalid('This deal is already in this month\'s sample');
      await audit(tx, ctx, 'file_review_added', 'box', id, { review: r.id }, b.owner_node_id);
      return r;
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/file-reviews/:id', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const r = (await tx.query(`SELECT ${cols} FROM file_reviews f JOIN boxes b ON b.id = f.box_id WHERE f.id = $1`, [id])).rows[0];
      if (!r) throw notFound('File review not found');
      return { ...r, suggested: await suggestions(tx, r.boxId as string) };
    });
  });

  app.post('/v1/file-reviews/:id/decide', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['checklist', 'outcome', 'findings'], properties: {
      checklist: { type: 'object' }, outcome: { enum: ['passed', 'findings'] }, findings: { type: 'string', minLength: 10, maxLength: 4000 }, fixBy: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { checklist: unknown; outcome: 'passed' | 'findings'; findings: string; fixBy?: string };
    const checklist = cleanChecklist(b.checklist);
    if (CHECKLIST.some((c) => !checklist[c.key])) throw invalid('Answer every checklist item (yes, no or not applicable)');
    if (b.outcome === 'findings' && (!b.fixBy || b.fixBy <= new Date().toISOString().slice(0, 10))) throw invalid('Set a fix-by date after today');
    if (b.outcome === 'passed' && Object.values(checklist).includes('no')) throw invalid('A checklist item is answered "no": record findings instead');
    return run(ctx, async (tx) => {
      const r = await reviewOf(tx, id);
      if (r.reviewer_id !== ctx.userId) throw forbidden('Only the assigned reviewer decides this review');
      if (r.status !== 'open') throw invalid('This review has already been decided');
      await tx.query(`UPDATE file_reviews SET status = $2, checklist = $3, findings = $4, fix_by = $5, reviewed_at = now() WHERE id = $1`,
        [id, b.outcome, JSON.stringify(checklist), b.findings.trim(), b.outcome === 'findings' ? b.fixBy : null]);
      if (b.outcome === 'findings') await notify(tx, { tenantId: ctx.tenantId, userId: r.advisor_id, actorId: ctx.userId, kind: 'compliance_review', boxId: r.box_id, data: { fileReview: 'findings', deal: r.name, fixBy: b.fixBy } });
      await audit(tx, ctx, `file_review_${b.outcome}`, 'box', r.box_id, { review: id, no: Object.entries(checklist).filter(([, v]) => v === 'no').map(([k]) => k) }, r.owner_node_id);
      return { status: b.outcome };
    });
  });

  // On the deal: the advisor sees reviews of it, and marks findings fixed.
  app.get('/v1/boxes/:id/file-reviews', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => ({ reviews: (await tx.query(`SELECT ${cols} FROM file_reviews f JOIN boxes b ON b.id = f.box_id WHERE f.box_id = $1 AND f.status <> 'open' ORDER BY f.created_at DESC LIMIT 20`, [id])).rows }));
  });

  app.post('/v1/file-reviews/:id/fixed', { schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['note'], properties: { note: { type: 'string', minLength: 10, maxLength: 2000 } } } } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const note = (req.body as { note: string }).note.trim();
    return run(ctx, async (tx) => {
      const r = await reviewOf(tx, id);
      requireEdit(ctx, r.owner_node_id);
      if (r.reviewer_id === ctx.userId) throw forbidden('The reviewer cannot mark their own findings fixed');
      if (r.status !== 'findings') throw invalid('There are no open findings on this review');
      const me = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      await tx.query(`UPDATE file_reviews SET status = 'fixed', fixed_note = $2, fixed_by_name = $3, fixed_at = now() WHERE id = $1`, [id, note, me]);
      await notify(tx, { tenantId: ctx.tenantId, userId: r.reviewer_id, actorId: ctx.userId, kind: 'compliance_review', boxId: r.box_id, data: { fileReview: 'fixed', deal: r.name, name: me } });
      await audit(tx, ctx, 'file_review_fixed', 'box', r.box_id, { review: id }, r.owner_node_id);
      return { status: 'fixed' };
    });
  });

  app.post('/v1/file-reviews/:id/close', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['action'], properties: { action: { enum: ['close', 'reopen'] }, note: { type: 'string', maxLength: 2000 }, fixBy: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    officer(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as { action: 'close' | 'reopen'; note?: string; fixBy?: string };
    return run(ctx, async (tx) => {
      const r = await reviewOf(tx, id);
      if (r.reviewer_id !== ctx.userId) throw forbidden('Only the assigned reviewer closes this review');
      if (r.status !== 'fixed') throw invalid('This review is not waiting for you to check a fix');
      if (b.action === 'close') {
        await tx.query(`UPDATE file_reviews SET status = 'closed', closed_note = $2, closed_at = now() WHERE id = $1`, [id, b.note?.trim() || null]);
      } else {
        if ((b.note ?? '').trim().length < 10) throw invalid('Say what is still not fixed (at least 10 characters)');
        if (!b.fixBy || b.fixBy <= new Date().toISOString().slice(0, 10)) throw invalid('Set a new fix-by date after today');
        await tx.query(`UPDATE file_reviews SET status = 'findings', findings = findings || E'\\n\\nReopened: ' || $2, fix_by = $3, fixed_note = NULL, fixed_by_name = NULL, fixed_at = NULL WHERE id = $1`, [id, b.note!.trim(), b.fixBy]);
        await notify(tx, { tenantId: ctx.tenantId, userId: r.advisor_id, actorId: ctx.userId, kind: 'compliance_review', boxId: r.box_id, data: { fileReview: 'reopened', deal: r.name, fixBy: b.fixBy } });
      }
      await audit(tx, ctx, `file_review_${b.action === 'close' ? 'closed' : 'reopened'}`, 'box', r.box_id, { review: id }, r.owner_node_id);
      return { status: b.action === 'close' ? 'closed' : 'findings' };
    });
  });
}

/**
 * The monthly draw (from the 1st, for every compliance officer whose sample for the month is not drawn yet) and the late
 * reminders (findings past their fix-by date: the advisor and the reviewer are told once).
 */
export async function sweepFileReviews(deps: AppDeps): Promise<{ drawn: number; late: number }> {
  if (!fileReviewsEnabled()) return { drawn: 0, late: 0 };
  let drawn = 0, late = 0;
  const officers = (await deps.authPool.query<{ tenant_id: string; user_id: string }>(
    `SELECT DISTINCT r.tenant_id, r.user_id FROM user_node_roles r JOIN app_users u ON u.id = r.user_id WHERE r.role::text = 'compliance' AND u.status::text <> 'disabled' LIMIT 2000`)).rows;
  for (const o of officers) {
    try {
      const ctx = await contextOf(deps, o.tenant_id, o.user_id);
      if (!ctx) continue;
      const size = await withRequestTx(deps.appPool, ctx, (tx) => tenantSettingInt(tx, 'compliance.fileSampleSize', 5));
      if (size > 0) drawn += await drawFor(deps, ctx, size);
    } catch (e) { if (process.env.ALERT_DEBUG) console.error('file review draw', e); }
  }
  const due = (await deps.authPool.query<{ id: string; tenant_id: string; box_id: string; reviewer_id: string; advisor_id: string | null; fix_by: string }>(
    `SELECT id, tenant_id, box_id, reviewer_id, advisor_id, fix_by::text AS fix_by FROM file_reviews WHERE status = 'findings' AND fix_by < current_date LIMIT 500`)).rows;
  for (const d of due) {
    try {
      const ctx = await contextOf(deps, d.tenant_id, d.reviewer_id);
      if (!ctx) continue;
      await withRequestTx(deps.appPool, ctx, async (tx) => {
        const name = (await tx.query<{ name: string }>('SELECT name FROM boxes WHERE id = $1', [d.box_id])).rows[0]?.name ?? '';
        for (const uid of [d.advisor_id, d.reviewer_id]) {
          if (!uid) continue;
          if (!(await tx.query('INSERT INTO reminder_marks (tenant_id, user_id, key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [d.tenant_id, uid, `file-review-late:${d.id}:${d.fix_by}`])).rowCount) continue;
          await tx.query(`INSERT INTO notifications (tenant_id, user_id, kind, box_id, actor_id, data) VALUES ($1,$2,'compliance_review',$3,NULL,$4)`, [d.tenant_id, uid, d.box_id, JSON.stringify({ fileReview: 'late', deal: name, fixBy: d.fix_by })]);
          late++;
        }
      });
    } catch (e) { if (process.env.ALERT_DEBUG) console.error('file review late', e); }
  }
  return { drawn, late };
}
