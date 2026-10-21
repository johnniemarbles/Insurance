import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { cePriorShortNodes } from './routes-ce.ts';
import { DOC_TYPES, MIN_OVERRIDE_REASON, clearanceReasons, type RequestContext } from '@pii/domain';
import { eoMinFor } from './routes-compliance.ts';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, uuid } from './crm-helpers.ts';
import { gateStatus } from './gates.ts';
import { clientFilePackage, producerPackage } from './audit-package.ts';
import type { AppDeps } from './app.ts';
import { registerProblemNodes } from './routes-licence-checks.ts';

/** The people who may waive a paperwork requirement for one record, and who may set the requirements. */
export const canWaive = (ctx: RequestContext) => ctx.isTenantAdmin || ctx.roles.some((r) => r.role === 'compliance');

/** File-completeness gates: where a record stands against each stage's required paperwork, waivers, and the list of files at risk. */
export function registerGateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const idp = { type: 'object', properties: { id: uuid } } as const;

  async function boxPipeline(tx: Tx, id: string) {
    const b = (await tx.query<{ pipeline_id: string; stage_id: string }>('SELECT pipeline_id, stage_id FROM boxes WHERE id = $1', [id])).rows[0];
    if (!b) throw notFound('Record not found');
    return b;
  }

  // Every gated stage of the record's pipeline, with what is filed, what is missing and which waivers exist.
  app.get('/v1/boxes/:id/gates', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const b = await boxPipeline(tx, id);
      const stages = (await tx.query<{ id: string; name: string; position: number }>(
        `SELECT s.id, s.name, s.position FROM stages s WHERE s.pipeline_id = $1 AND EXISTS (SELECT 1 FROM stage_doc_requirements r WHERE r.stage_id = s.id) ORDER BY s.position`, [b.pipeline_id])).rows;
      const gates = [];
      for (const s of stages) {
        const g = await gateStatus(tx, s.id, id);
        if (g) gates.push({ stageId: s.id, stageName: s.name, position: s.position, current: s.id === b.stage_id, required: g.required, filed: g.filed, overridden: g.overridden, missing: g.missing, unverified: g.unverified, needsExpiredOn: g.needsExpiredOn });
      }
      const overrides = (await tx.query(
        `SELECT o.id, o.stage_id AS "stageId", o.doc_types AS "docTypes", o.reason, o.approver_name AS "approvedBy", o.created_at AS "createdAt"
           FROM gate_overrides o WHERE o.box_id = $1 ORDER BY o.created_at DESC LIMIT 50`, [id])).rows;
      return { gates, overrides, canWaive: canWaive(ctx) };
    });
  });

  // Waive missing paperwork for one record and one stage. Permanent: it is named, explained and cannot be edited or deleted.
  app.post('/v1/boxes/:id/gate-overrides', {
    schema: { params: idp, body: { type: 'object', required: ['stageId', 'docTypes', 'reason'], additionalProperties: false, properties: {
      stageId: uuid, docTypes: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { enum: [...DOC_TYPES] } }, reason: { type: 'string', maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can waive required paperwork');
    const { id } = req.params as { id: string };
    const b = req.body as { stageId: string; docTypes: string[]; reason: string };
    const reason = b.reason.trim();
    if (reason.length < MIN_OVERRIDE_REASON) throw invalid(`Give a reason of at least ${MIN_OVERRIDE_REASON} characters`);
    const out = await run(ctx, async (tx) => {
      const bx = await boxPipeline(tx, id);
      const st = (await tx.query('SELECT 1 FROM stages WHERE id = $1 AND pipeline_id = $2', [b.stageId, bx.pipeline_id])).rowCount;
      if (!st) throw invalid('That stage does not belong to the record’s pipeline');
      const required = (await gateStatus(tx, b.stageId, id))?.required ?? []; // includes a replacement disclosure the client's needs analysis calls for
      const notRequired = b.docTypes.filter((t) => !required.includes(t));
      if (notRequired.length) throw invalid('That stage does not require ' + notRequired.join(', '));
      const who = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      const r = await tx.query<{ id: string }>(
        `INSERT INTO gate_overrides (tenant_id, box_id, stage_id, doc_types, reason, approved_by, approver_name) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [ctx.tenantId, id, b.stageId, b.docTypes, reason, ctx.userId, who]);
      await audit(tx, ctx, 'gate_override', 'box', id, { stageId: b.stageId, docTypes: b.docTypes, reason });
      return { id: r.rows[0]!.id };
    });
    return reply.code(201).send(out);
  });

  // Records sitting in, or past, a stage whose required paperwork is not on file and not waived. RLS limits it to what the person can see.
  app.get('/v1/compliance/files-at-risk', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT b.id, b.name, b.pipeline_id AS "pipelineId", p.name AS pipeline, cs.name AS stage, g.name AS "gateStage",
                array_agg(r.doc_type ORDER BY r.doc_type) AS missing, coalesce(u.display_name, u.email::text) AS owner, b.stage_entered_at AS "stageEnteredAt"
           FROM boxes b
           JOIN stages cs ON cs.id = b.stage_id
           JOIN pipelines p ON p.id = b.pipeline_id
           JOIN stages g ON g.pipeline_id = b.pipeline_id AND g.position <= cs.position
           JOIN stage_doc_requirements r ON r.stage_id = g.id
           LEFT JOIN app_users u ON u.id = b.owner_user_id
          WHERE NOT cs.is_lost
            AND NOT EXISTS (SELECT 1 FROM box_documents d WHERE d.box_id = b.id AND d.doc_type = r.doc_type
                              AND (d.doc_type NOT IN ('needs_analysis', 'recommendation', 'beneficiary_designation', 'replacement_disclosure') OR d.verified_at IS NOT NULL))
            AND NOT EXISTS (SELECT 1 FROM advice_records a WHERE a.box_id = b.id AND a.kind = r.doc_type AND a.status = 'signed' AND (a.valid_until IS NULL OR a.valid_until >= current_date))
            AND NOT EXISTS (SELECT 1 FROM (VALUES ('privacy_consent','collection_use'),('pink_slip_optin','pink_slip_optin')) m(dt, ck)
                             WHERE m.dt = r.doc_type AND EXISTS (SELECT 1 FROM (SELECT withdrawn_at FROM client_consents c WHERE c.box_id = b.id AND c.kind = m.ck ORDER BY created_at DESC LIMIT 1) x WHERE x.withdrawn_at IS NULL))
            AND NOT (r.doc_type = 'id_record' AND EXISTS (SELECT 1 FROM client_id_records c WHERE c.box_id = b.id AND c.result = 'verified'))
            AND NOT EXISTS (SELECT 1 FROM gate_overrides o WHERE o.box_id = b.id AND o.stage_id = g.id AND r.doc_type = ANY(o.doc_types))
          GROUP BY b.id, b.name, b.pipeline_id, p.name, cs.name, cs.position, g.id, g.name, u.display_name, u.email, b.stage_entered_at
          ORDER BY b.stage_entered_at LIMIT 200`)).rows;
      const waivers = (await tx.query(
        `SELECT count(*)::int AS n FROM gate_overrides WHERE created_at > now() - interval '90 days'`)).rows[0]!.n as number;
      // Client identity and anti-money-laundering items that need someone: a screening hit nobody has reviewed, a failed ID check that
      // is still the latest word, and a large cash receipt with no report reference after the 15 days the rules allow.
      const aml = (await tx.query<{ boxId: string; name: string; issue: string; detail: string; since: string; overdue: boolean }>(
        `SELECT b.id AS "boxId", b.name, i.issue, i.detail, to_char(i.since, 'YYYY-MM-DD') AS since,
                (i.issue = 'cash_unreported' AND i.since < current_date - 15) AS overdue
           FROM boxes b JOIN stages st ON st.id = b.stage_id AND NOT st.is_lost
           JOIN LATERAL (
             SELECT 'screening_hit' AS issue, s.list AS detail, s.screened_on AS since
               FROM (SELECT DISTINCT ON (list) list, result, screened_on FROM screening_results WHERE box_id = b.id ORDER BY list, created_at DESC) s WHERE s.result = 'hit'
             UNION ALL
             SELECT 'id_failed', c.method, c.verified_on
               FROM (SELECT result, method, verified_on FROM client_id_records WHERE box_id = b.id ORDER BY created_at DESC LIMIT 1) c WHERE c.result = 'failed'
             UNION ALL
             SELECT 'cash_unreported', t.amount::text || ' ' || t.currency, t.occurred_on
               FROM cash_transactions t WHERE t.box_id = b.id AND t.report_required AND t.reported_at IS NULL
           ) i ON true
          ORDER BY overdue DESC, i.since LIMIT 200`)).rows;
      return { files: rows, waivers90d: waivers, aml };
    });
  });

  // Who is not cleared to transact today: approval, a licence in force, and E&O in force at or above the minimum. RLS limits it to the caller's branch.
  app.get('/v1/compliance/clearance', async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return run(ctx, async (tx) => {
      const eoMin = await eoMinFor(tx, ctx);
      const rows = (await tx.query<{ id: string; name: string; status: string | null; licences: number; validLicences: number; eoPolicies: number; validEo: number; eoMax: number | null }>(
        `SELECT n.id, n.name, p.status,
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'licence') AS licences,
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'licence' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "validLicences",
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo') AS "eoPolicies",
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "validEo",
                (SELECT max(i.limit_amount)::float FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "eoMax"
           FROM org_nodes n LEFT JOIN compliance_profiles p ON p.node_id = n.id
          WHERE n.type = 'partner' AND n.is_active AND org_node_at_or_below(n.tenant_id, n.id)
          ORDER BY n.name LIMIT 1000`)).rows;
      const ceShort = await cePriorShortNodes(tx);
      const regProblem = await registerProblemNodes(tx);
      const all = rows.map((r) => ({ nodeId: r.id, name: r.name, reasons: clearanceReasons({ status: r.status, licences: r.licences, validLicences: r.validLicences, eoPolicies: r.eoPolicies, validEo: r.validEo, eoMaxLimit: r.eoMax, eoMin, cePriorShort: ceShort.has(r.id), registerProblem: regProblem.has(r.id) }) }));
      const notCleared = all.filter((a) => a.reasons.length > 0);
      return { total: all.length, cleared: all.length - notCleared.length, notCleared };
    });
  });

  // One-click audit package (ZIP): summary PDF and CSV, every supporting document as stored, the audit entries, and a SHA-256 manifest.
  const pkgWho = async (tx: Tx, ctx: RequestContext) => (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
  app.get('/v1/boxes/:id/audit-package', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can export an audit package');
    if (!deps.keys) throw new HttpError(503, 'keys_unavailable', 'Documents are not available on this server yet');
    const { id } = req.params as { id: string };
    const keys = deps.keys;
    return run(ctx, async (tx) => {
      const p = await clientFilePackage(tx, ctx, keys, id, await pkgWho(tx, ctx));
      await audit(tx, ctx, 'audit_package_exported', 'box', id, { files: p.fileCount, bytes: p.zip.length });
      return { filename: p.filename, mime: 'application/zip', dataBase64: p.zip.toString('base64') };
    });
  });
  app.get('/v1/compliance/partners/:id/audit-package', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    if (!canWaive(ctx)) throw forbidden('Only an administrator or the compliance role can export an audit package');
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const p = await producerPackage(tx, ctx, id, await pkgWho(tx, ctx));
      await audit(tx, ctx, 'audit_package_exported', 'partner', id, { files: p.fileCount, bytes: p.zip.length });
      return { filename: p.filename, mime: 'application/zip', dataBase64: p.zip.toString('base64') };
    });
  });
}
