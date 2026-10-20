// Suitability check before submission (roadmap Phase 2, feature 5). Switch: SUITABILITY_ENABLED (404 when off).
// The advisor runs the check on a deal's Advice tab. PII's rules always run; when the co-pilot is on for this person,
// the AI service also reads the signed needs analysis, the signed recommendation, any replacement disclosure and the
// best matching rulebook passages, and adds findings that must cite them. The advisor then proceeds with a written
// reason or asks compliance; compliance clears it or sends it back. Compliance can require a decided check before a
// stage ("Suitability review" in the stage's required paperwork). The check never approves anything by itself.
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { NeedsAnswers, RecommendationAnswers, RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { aiSettings, resolveAi } from './ai-resolve.ts';
import { copilotEnabled } from './routes-copilot.ts';
import { allowedFor } from './routes-copilot-tools.ts';
import { orQuery } from './copilot-docs.ts';
import { SUITABILITY_SYSTEM, parseAiFindings, ruleFindings, rulebookTerms, suitabilityEnabled, type Finding } from './suitability.ts';
import type { AppDeps } from './app.ts';

const DECIDED = ['no_gaps', 'proceeded', 'cleared'];
const cut = (s: string | null | undefined, n: number) => { const t = (s ?? '').replace(/[ \t]+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

/** The deal's current signed recommendation and the current signed needs analysis it answers, if both exist. */
export async function currentAdvice(tx: Tx, boxId: string) {
  return (await tx.query<{ rec_id: string; rec_title: string; rec_body: string; rec_answers: RecommendationAnswers | null; na_id: string; na_title: string; na_body: string; na_answers: NeedsAnswers | null }>(
    `SELECT r.id AS rec_id, r.title AS rec_title, r.body AS rec_body, r.answers AS rec_answers, n.id AS na_id, n.title AS na_title, n.body AS na_body, n.answers AS na_answers
       FROM advice_records r
       JOIN advice_records n ON n.id = r.linked_advice_id AND n.box_id = r.box_id AND n.kind = 'needs_analysis' AND n.status = 'signed'
                            AND (n.valid_until IS NULL OR n.valid_until >= current_date)
      WHERE r.box_id = $1 AND r.kind = 'recommendation' AND r.status = 'signed'
      ORDER BY r.signed_at DESC LIMIT 1`, [boxId])).rows[0] ?? null;
}

/** For the paperwork gates: a decided check of the deal's current recommendation is on file. */
export async function suitabilityFiled(tx: Tx, boxId: string): Promise<boolean> {
  const cur = await currentAdvice(tx, boxId);
  if (!cur) return false;
  return !!(await tx.query(`SELECT 1 FROM suitability_checks WHERE box_id = $1 AND recommendation_id = $2 AND status = ANY($3) LIMIT 1`, [boxId, cur.rec_id, DECIDED])).rowCount;
}

async function gapsNeedCompliance(tx: Tx): Promise<boolean> {
  const v = (await tx.query<{ value: unknown }>(`SELECT value FROM setting_values WHERE key = 'compliance.suitabilityGapsNeedCompliance' AND scope_type = 'tenant' LIMIT 1`)).rows[0]?.value;
  return v === true;
}

export function registerSuitabilityRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!suitabilityEnabled()) throw notFound('Not found');
    const id = await deps.authenticate(req);
    requireCrm(id.ctx);
    return id;
  };
  const nameOf = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
  const cols = (me: string) => `s.id, s.box_id AS "boxId", s.recommendation_id AS "recommendationId", s.findings, s.ai_used AS "aiUsed", s.ai_provider AS "aiProvider", s.status,
    s.run_by_name AS "runBy", s.advisor_note AS "advisorNote", s.advisor_decided_at AS "advisorDecidedAt", s.reviewer_name AS "reviewer", s.reviewer_note AS "reviewerNote",
    s.reviewed_at AS "reviewedAt", s.created_at AS "createdAt", s.run_by = ${me} AS "mine"`;

  app.get('/v1/suitability/status', async (req) => {
    const { ctx } = await begin(req);
    return { enabled: true, canReview: canWaive(ctx) };
  });

  app.get('/v1/boxes/:id/suitability', { schema: { params: idp } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const b = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!b) throw notFound('Deal not found');
      const cur = await currentAdvice(tx, id);
      const checks = (await tx.query(`SELECT ${cols('$2')} FROM suitability_checks s WHERE s.box_id = $1 ORDER BY s.created_at DESC LIMIT 20`, [id, ctx.userId])).rows
        .map((c) => ({ ...c, current: !!cur && c.recommendationId === cur.rec_id }));
      const s = await aiSettings(tx);
      return { current: cur ? { recommendationId: cur.rec_id, recommendation: cur.rec_title, needsAnalysis: cur.na_title } : null, checks,
        canReview: canWaive(ctx), gapsNeedCompliance: await gapsNeedCompliance(tx), aiOn: copilotEnabled() && allowedFor(ctx, s) };
    });
  });

  app.post('/v1/boxes/:id/suitability', { schema: { params: idp } }, async (req, reply) => {
    const identity = await begin(req);
    const { ctx } = identity;
    const { id } = req.params as { id: string };
    const g = await run(ctx, async (tx) => {
      const b = (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM boxes WHERE id = $1', [id])).rows[0];
      if (!b) throw notFound('Deal not found');
      requireEdit(ctx, b.owner_node_id);
      const cur = await currentAdvice(tx, id);
      if (!cur) throw invalid('A suitability check needs a signed recommendation linked to a current signed needs analysis on this deal');
      const disc = (await tx.query<{ title: string; body: string }>(`SELECT title, body FROM advice_records WHERE box_id = $1 AND kind = 'replacement_disclosure' AND status = 'signed' ORDER BY signed_at DESC LIMIT 1`, [id])).rows[0] ?? null;
      const rules = ruleFindings(cur.na_answers, cur.rec_answers, { replacementDisclosureSigned: !!disc });
      let ai = null as Awaited<ReturnType<typeof resolveAi>>;
      if (copilotEnabled() && allowedFor(ctx, await aiSettings(tx))) ai = await resolveAi(tx, ctx, deps);
      const tsq = ai ? orQuery(rulebookTerms(cur.na_answers, cur.rec_answers)) : null;
      const passages = tsq ? (await tx.query<{ heading: string | null; body: string; title: string }>(
        `SELECT p.heading, p.body, d.title FROM rulebook_passages p JOIN rulebook_documents d ON d.id = p.document_id
          WHERE d.retired_at IS NULL AND p.tsv @@ to_tsquery('simple', $1) ORDER BY ts_rank_cd(p.tsv, to_tsquery('simple', $1)) DESC LIMIT 6`, [tsq])).rows : [];
      return { b, cur, disc, rules, ai, passages };
    });
    let aiFindings: Finding[] = [];
    let aiUsed = false;
    if (g.ai) {
      const refs = new Set(['N1', 'R1', ...(g.disc ? ['D1'] : []), ...g.passages.map((_, i) => `P${i + 1}`)]);
      const block = [
        `[N1] Needs analysis: ${g.cur.na_title}\n${cut(g.cur.na_body, 3000)}${g.cur.na_answers ? `\nAnswers: ${JSON.stringify(g.cur.na_answers).slice(0, 4000)}` : ''}`,
        `[R1] Recommendation: ${g.cur.rec_title}\n${cut(g.cur.rec_body, 3000)}${g.cur.rec_answers ? `\nAnswers: ${JSON.stringify(g.cur.rec_answers).slice(0, 2000)}` : ''}`,
        ...(g.disc ? [`[D1] Replacement disclosure: ${g.disc.title}\n${cut(g.disc.body, 2000)}`] : []),
        ...g.passages.map((p, i) => `[P${i + 1}] Rulebook, ${p.title}${p.heading ? ` › ${p.heading}` : ''}: ${cut(p.body, 1200)}`),
      ].join('\n\n');
      try {
        const raw = await g.ai.client.complete({ system: SUITABILITY_SYSTEM, user: `<records>\n${block}\n</records>\n\nAnswer in English.`, maxTokens: 1200 });
        aiFindings = parseAiFindings(raw, refs);
        aiUsed = true;
      } catch (e) { req.log.warn({ err: (e as Error).message }, 'suitability: AI call failed; rules only'); }
    }
    const findings = [...g.rules, ...aiFindings];
    const out = await run(ctx, async (tx) => {
      const r = (await tx.query<{ id: string; status: string }>(
        `INSERT INTO suitability_checks (tenant_id, box_id, recommendation_id, needs_analysis_id, findings, ai_used, ai_provider, status, run_by, run_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id, status`,
        [ctx.tenantId, id, g.cur.rec_id, g.cur.na_id, JSON.stringify(findings), aiUsed, aiUsed ? g.ai!.provider : null, findings.length ? 'open' : 'no_gaps', ctx.userId, await nameOf(tx, ctx)])).rows[0]!;
      if (aiUsed) {
        await tx.query(`INSERT INTO copilot_log (tenant_id, user_id, kind, provider, key_source, model, question_chars, records_sent, records_cited) VALUES ($1,$2,'suitability',$3,$4,$5,0,$6,$7)`,
          [ctx.tenantId, ctx.userId, g.ai!.provider, g.ai!.source, g.ai!.client.model.slice(0, 100), 2 + (g.disc ? 1 : 0) + g.passages.length, new Set(aiFindings.flatMap((f) => f.cites)).size]);
      }
      await audit(tx, ctx, 'suitability_checked', 'box', id, { check: r.id, gaps: findings.filter((f) => f.severity === 'gap').length, questions: findings.filter((f) => f.severity === 'question').length, aiUsed }, g.b.owner_node_id);
      return r;
    });
    return reply.code(201).send({ id: out.id, status: out.status, findings, aiUsed, aiAttempted: !!g.ai });
  });

  // The advisor decides: proceed with a written reason, or ask compliance. With the company rule on, a "gap" needs compliance.
  app.post('/v1/suitability/:id/decide', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['action', 'note'], properties: {
      action: { enum: ['proceed', 'refer'] }, note: { type: 'string', minLength: 10, maxLength: 2000 } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { action: 'proceed' | 'refer'; note: string };
    return run(ctx, async (tx) => {
      const s = (await tx.query<{ box_id: string; status: string; findings: Finding[]; owner_node_id: string }>(
        `SELECT s.box_id, s.status, s.findings, b.owner_node_id FROM suitability_checks s JOIN boxes b ON b.id = s.box_id WHERE s.id = $1 FOR UPDATE OF s`, [id])).rows[0];
      if (!s) throw notFound('Check not found');
      requireEdit(ctx, s.owner_node_id);
      if (s.status !== 'open') throw invalid('This check is not waiting for your decision');
      if (b.action === 'proceed' && s.findings.some((f) => f.severity === 'gap') && await gapsNeedCompliance(tx)) {
        throw new HttpError(409, 'needs_compliance', 'Your company asks compliance to clear any gap. Ask compliance instead.');
      }
      const status = b.action === 'proceed' ? 'proceeded' : 'referred';
      await tx.query(`UPDATE suitability_checks SET status = $2, advisor_note = $3, advisor_decided_at = now() WHERE id = $1`, [id, status, b.note.trim()]);
      await audit(tx, ctx, b.action === 'proceed' ? 'suitability_proceeded' : 'suitability_referred', 'box', s.box_id, { check: id }, s.owner_node_id);
      return { status };
    });
  });

  // Compliance clears a referred check, or sends it back (the advisor fixes the records and runs a new check).
  app.post('/v1/suitability/:id/review', {
    schema: { params: idp, body: { type: 'object', additionalProperties: false, required: ['action', 'note'], properties: {
      action: { enum: ['clear', 'return'] }, note: { type: 'string', minLength: 10, maxLength: 2000 } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can review a suitability check');
    const { id } = req.params as { id: string };
    const b = req.body as { action: 'clear' | 'return'; note: string };
    return run(ctx, async (tx) => {
      const s = (await tx.query<{ box_id: string; status: string; run_by: string; owner_node_id: string }>(
        `SELECT s.box_id, s.status, s.run_by, b.owner_node_id FROM suitability_checks s JOIN boxes b ON b.id = s.box_id WHERE s.id = $1 FOR UPDATE OF s`, [id])).rows[0];
      if (!s) throw notFound('Check not found');
      if (s.status !== 'referred') throw invalid('This check is not waiting for compliance');
      if (s.run_by === ctx.userId) throw forbidden('Someone else must review a check you ran');
      const status = b.action === 'clear' ? 'cleared' : 'returned';
      await tx.query(`UPDATE suitability_checks SET status = $2, reviewer_id = $3, reviewer_name = $4, reviewer_note = $5, reviewed_at = now() WHERE id = $1`,
        [id, status, ctx.userId, await nameOf(tx, ctx), b.note.trim()]);
      await audit(tx, ctx, `suitability_${status}`, 'box', s.box_id, { check: id }, s.owner_node_id);
      return { status };
    });
  });

  // Compliance's queue: checks waiting for them, and recent ones where the advisor proceeded past a gap.
  app.get('/v1/suitability/queue', async (req) => {
    const { ctx } = await begin(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can see the suitability queue');
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT ${cols('$1')}, b.name AS "dealName" FROM suitability_checks s JOIN boxes b ON b.id = s.box_id
          WHERE s.status = 'referred' OR (s.status = 'proceeded' AND s.advisor_decided_at > now() - interval '30 days' AND s.findings @> '[{"severity":"gap"}]'::jsonb)
          ORDER BY (s.status = 'referred') DESC, s.created_at LIMIT 100`, [ctx.userId])).rows;
      return { referred: rows.filter((r) => r.status === 'referred'), proceededWithGaps: rows.filter((r) => r.status === 'proceeded') };
    });
  });
}
