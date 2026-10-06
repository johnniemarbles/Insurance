import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import {
  computeChecklist, effectiveEoMin, reminderThreshold, sniffMime, safeFilename, ENTITY_TYPES, LINES_OF_AUTHORITY, PROFILE_FIELDS,
  MAX_DOC_BYTES, MAX_DOCS_PER_PARTNER, type Country, type RequestContext,
} from '@pii/domain';
import { audit } from './audit.ts';
import { actingAs } from './effects.ts';
import { uuid } from './crm-helpers.ts';
import { forbidden, invalid, notFound, conflict } from './errors.ts';
import { resolveSettings } from './settings.ts';
import type { AppDeps } from './app.ts';
import { snapshotBefore } from './snapshots.ts';

export const countryOf = (region: string): Country => (region === 'us' ? 'US' : 'CA');

/** The smallest E&O limit that applies: the country default (EO_MIN_LIMIT) raised, never lowered, by the company's own setting. */
async function eoMinFor(tx: Tx, ctx: RequestContext): Promise<number> {
  const company = (await resolveSettings(tx, ctx.userId, ['compliance.eoMinLimit']))['compliance.eoMinLimit']?.value as number | undefined;
  return effectiveEoMin(Number(process.env.EO_MIN_LIMIT ?? 0), company);
}

/** Some partner's file, only if the caller can see it (row-level security decides) and the node is a partner. */
async function partnerOf(tx: Tx, nodeId: string): Promise<{ id: string; name: string; tenantId: string }> {
  const r = (await tx.query<{ id: string; name: string; tenantId: string }>(
    `SELECT id, name, tenant_id AS "tenantId" FROM org_nodes WHERE id = $1 AND type = 'partner' AND is_active AND org_node_at_or_below(tenant_id, id)`, [nodeId])).rows[0];
  if (!r) throw notFound('Unknown partner');
  return r;
}

const MANAGE = (ctx: RequestContext) => ctx.isTenantAdmin || ctx.roles.some((r) => r.role === 'admin' || r.role === 'manager');

function requireWrite(ctx: RequestContext): void {
  if (!ctx.canWrite || !ctx.canUseCrm) throw forbidden('Your role cannot change this');
}

export async function buildFile(tx: Tx, ctx: RequestContext, node: { id: string; name: string }, country: Country) {
  const profile = (await tx.query(
    `SELECT entity_type AS "entityType", legal_name AS "legalName", business_number AS "businessNumber", fields, agreement_status AS "agreementStatus",
            agreement_signed_on AS "agreementSignedOn", attested_at AS "attestedAt", status, submitted_at AS "submittedAt",
            reviewed_by_name AS "reviewedByName", reviewed_at AS "reviewedAt", review_note AS "reviewNote"
       FROM compliance_profiles WHERE node_id = $1`, [node.id])).rows[0] ?? null;
  const items = (await tx.query(
    `SELECT id, kind, label, number, jurisdiction, lines, limit_amount::float AS "limitAmount", expires_on::text AS "expiresOn", notes,
            (expires_on - current_date)::int AS "daysLeft"
       FROM compliance_items WHERE node_id = $1 ORDER BY kind, expires_on NULLS LAST, label`, [node.id])).rows as { kind: string; limitAmount: number | null; expiresOn: string | null; daysLeft: number | null }[];
  const documents = (await tx.query(
    `SELECT id, item_id AS "itemId", kind, filename, mime, size_bytes AS "sizeBytes", created_at AS "createdAt" FROM compliance_documents WHERE node_id = $1 ORDER BY created_at DESC`, [node.id])).rows;
  const appointments = (await tx.query(
    `SELECT id, carrier, status, note, created_at AS "createdAt", updated_at AS "updatedAt" FROM carrier_appointments WHERE node_id = $1 ORDER BY created_at DESC`, [node.id])).rows;
  const eoMin = await eoMinFor(tx, ctx);
  const live = items.filter((i) => i.kind === 'eo' && (i.daysLeft === null || i.daysLeft >= 0));
  const checklist = computeChecklist({
    profile, licences: items.filter((i) => i.kind === 'licence').length, eoCount: items.filter((i) => i.kind === 'eo').length,
    eoMaxLimit: live.reduce<number | null>((m, i) => (i.limitAmount !== null && (m === null || i.limitAmount > m) ? i.limitAmount : m), null), eoMin,
  });
  return {
    node: { id: node.id, name: node.name }, country, eoMin, profile, items, documents, appointments, checklist,
    options: { entityTypes: ENTITY_TYPES[country], lines: LINES_OF_AUTHORITY[country], fields: PROFILE_FIELDS[country] },
    canManage: MANAGE(ctx),
  };
}

/** Everyone who should hear about a partner's file: the people at the partner, and the company's administrators. */
export async function fileAudience(deps: AppDeps, nodeId: string): Promise<{ tenantId: string; userIds: string[] }> {
  const t = (await deps.authPool.query<{ tenant_id: string }>('SELECT tenant_id FROM org_nodes WHERE id = $1', [nodeId])).rows[0];
  if (!t) return { tenantId: '', userIds: [] };
  const u = (await deps.authPool.query<{ id: string }>(
    `SELECT DISTINCT u.id FROM app_users u
      WHERE u.status::text <> 'disabled' AND u.tenant_id = $2
        AND (u.home_node_id = $1 OR EXISTS (SELECT 1 FROM user_node_roles r WHERE r.user_id = u.id AND r.node_id = $1)
             OR EXISTS (SELECT 1 FROM user_node_roles r JOIN org_nodes n ON n.id = r.node_id WHERE r.user_id = u.id AND r.role = 'admin' AND n.type = 'tenant'))`, [nodeId, t.tenant_id])).rows;
  return { tenantId: t.tenant_id, userIds: u.map((x) => x.id) };
}

/** People in the head office company who review files. */
export async function headOfficeAudience(deps: AppDeps): Promise<{ tenantId: string; userIds: string[] }[]> {
  const rows = (await deps.authPool.query<{ tenant_id: string; id: string }>(
    `SELECT DISTINCT u.tenant_id, u.id FROM app_users u JOIN tenants t ON t.id = u.tenant_id AND t.is_head_office JOIN user_node_roles r ON r.user_id = u.id AND r.role::text IN ('compliance', 'admin')
      WHERE u.status::text <> 'disabled'`)).rows;
  const by = new Map<string, string[]>();
  for (const r of rows) by.set(r.tenant_id, [...(by.get(r.tenant_id) ?? []), r.id]);
  return [...by].map(([tenantId, userIds]) => ({ tenantId, userIds }));
}

/** Notifications are written with the identity pool: it may add a row for a person in any company, and read nothing else. */
export async function tell(deps: AppDeps, tenantId: string, userIds: string[], kind: string, actorId: string | null, data: Record<string, unknown>): Promise<void> {
  for (const id of userIds) {
    if (id === actorId) continue;
    try {
      await deps.authPool.query('INSERT INTO notifications (tenant_id, user_id, kind, actor_id, data) VALUES ($1,$2,$3,$4,$5)', [tenantId, id, kind, actorId, JSON.stringify(data)]);
    } catch { /* a missed notice never blocks the work */ }
  }
}

const str = (max: number) => ({ type: 'string', maxLength: max }) as const;
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

export function registerComplianceRoutes(app: FastifyInstance, deps: AppDeps): void {
  const country = countryOf(deps.config.region);
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  // --- the company side -------------------------------------------------------------------------------
  app.get('/v1/compliance/partners', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return run(ctx, async (tx) => {
      const eoMin = await eoMinFor(tx, ctx);
      const rows = (await tx.query<{ id: string; name: string; parent: string | null; status: string | null; licences: number; eoCount: number; eoMax: number | null; nextExpiry: string | null; daysLeft: number | null; agreement: string | null; attested: boolean; entityType: string | null; legalName: string | null; businessNumber: string | null }>(
        `SELECT n.id, n.name,
                (SELECT p.name FROM org_links l JOIN org_nodes p ON p.id = l.parent_id WHERE l.child_id = n.id AND l.kind = 'partner_link' LIMIT 1) AS parent,
                p.status, p.entity_type AS "entityType", p.legal_name AS "legalName", p.business_number AS "businessNumber",
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'licence') AS licences,
                (SELECT count(*)::int FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo') AS "eoCount",
                (SELECT max(i.limit_amount)::float FROM compliance_items i WHERE i.node_id = n.id AND i.kind = 'eo' AND (i.expires_on IS NULL OR i.expires_on >= current_date)) AS "eoMax",
                (SELECT min(i.expires_on)::text FROM compliance_items i WHERE i.node_id = n.id) AS "nextExpiry",
                (SELECT (min(i.expires_on) - current_date)::int FROM compliance_items i WHERE i.node_id = n.id) AS "daysLeft",
                p.agreement_status AS agreement, (p.attested_at IS NOT NULL) AS attested
           FROM org_nodes n LEFT JOIN compliance_profiles p ON p.node_id = n.id
          WHERE n.type = 'partner' AND n.is_active AND org_node_at_or_below(n.tenant_id, n.id)
          ORDER BY n.name LIMIT 1000`)).rows;
      const partners = rows.map((r) => ({
        ...r, status: r.status ?? 'incomplete',
        checklist: computeChecklist({ profile: { entityType: r.entityType, legalName: r.legalName, businessNumber: r.businessNumber, attestedAt: r.attested ? 'x' : null, agreementStatus: r.agreement }, licences: r.licences, eoCount: r.eoCount, eoMaxLimit: r.eoMax, eoMin }),
      }));
      return { partners, country, eoMin };
    });
  });

  app.get('/v1/compliance/partners/:nodeId', { schema: { params: { type: 'object', properties: { nodeId: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { nodeId } = req.params as { nodeId: string };
    return run(ctx, async (tx) => buildFile(tx, ctx, await partnerOf(tx, nodeId), country));
  });

  app.put('/v1/compliance/partners/:nodeId/profile', {
    schema: { params: { type: 'object', properties: { nodeId: uuid } }, body: { type: 'object', additionalProperties: false, properties: {
      entityType: { type: ['string', 'null'], maxLength: 20 }, legalName: { type: ['string', 'null'], maxLength: 200 }, businessNumber: { type: ['string', 'null'], maxLength: 40 },
      fields: { type: 'object', additionalProperties: { type: 'string', maxLength: 60 } } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { nodeId } = req.params as { nodeId: string };
    const b = req.body as { entityType?: string | null; legalName?: string | null; businessNumber?: string | null; fields?: Record<string, string> };
    if (b.entityType && !ENTITY_TYPES[country].includes(b.entityType)) throw invalid('That kind of business is not available here');
    const allowed = new Set(PROFILE_FIELDS[country].map((f) => f.key));
    for (const k of Object.keys(b.fields ?? {})) if (!allowed.has(k)) throw invalid(`Unknown field ${k}`);
    await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      await tx.query(
        `INSERT INTO compliance_profiles (node_id, tenant_id, entity_type, legal_name, business_number, fields) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (node_id) DO UPDATE SET entity_type = $3, legal_name = $4, business_number = $5, fields = $6, updated_at = now()`,
        [nodeId, node.tenantId, b.entityType ?? null, b.legalName?.trim() || null, b.businessNumber?.trim() || null, JSON.stringify(b.fields ?? {})]);
      await audit(tx, ctx, 'compliance_profile_saved', 'partner', nodeId, {}, nodeId);
    });
    return reply.code(204).send();
  });

  const itemBody = { type: 'object', additionalProperties: false, required: ['kind', 'label'], properties: {
    kind: { type: 'string', enum: ['licence', 'eo'] }, label: { type: 'string', minLength: 1, maxLength: 120 }, number: { type: ['string', 'null'], maxLength: 60 },
    jurisdiction: { type: ['string', 'null'], maxLength: 40 }, lines: { type: 'array', maxItems: 12, items: str(40) }, limitAmount: { type: ['number', 'null'], minimum: 0, maximum: 1e11 },
    expiresOn: { anyOf: [date, { type: 'null' }] }, notes: { type: ['string', 'null'], maxLength: 500 } } } as const;
  type ItemBody = { kind: 'licence' | 'eo'; label: string; number?: string | null; jurisdiction?: string | null; lines?: string[]; limitAmount?: number | null; expiresOn?: string | null; notes?: string | null };
  const checkItem = (b: ItemBody) => {
    const ok = new Set(LINES_OF_AUTHORITY[country]);
    for (const l of b.lines ?? []) if (!ok.has(l)) throw invalid(`Unknown line of authority ${l}`);
    if (b.kind === 'eo' && b.limitAmount == null) throw invalid('Enter the coverage limit for the E&O policy');
    if (b.expiresOn && Number.isNaN(Date.parse(b.expiresOn))) throw invalid('That date is not valid');
  };

  app.post('/v1/compliance/partners/:nodeId/items', { schema: { params: { type: 'object', properties: { nodeId: uuid } }, body: itemBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { nodeId } = req.params as { nodeId: string };
    const b = req.body as ItemBody; checkItem(b);
    const id = await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      const r = await tx.query<{ id: string }>(
        `INSERT INTO compliance_items (tenant_id, node_id, kind, label, number, jurisdiction, lines, limit_amount, expires_on, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [node.tenantId, nodeId, b.kind, b.label.trim(), b.number?.trim() || null, b.jurisdiction?.trim() || null, b.lines ?? [], b.kind === 'eo' ? b.limitAmount : null, b.expiresOn ?? null, b.notes?.trim() || null, ctx.userId]);
      await audit(tx, ctx, 'compliance_item_added', 'partner', nodeId, { kind: b.kind }, nodeId);
      return r.rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  app.put('/v1/compliance/items/:id', { schema: { params: { type: 'object', properties: { id: uuid } }, body: itemBody } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { id } = req.params as { id: string };
    const b = req.body as ItemBody; checkItem(b);
    await run(ctx, async (tx) => {
      const r = await tx.query(
        `UPDATE compliance_items SET kind = $2, label = $3, number = $4, jurisdiction = $5, lines = $6, limit_amount = $7, expires_on = $8, notes = $9, updated_at = now() WHERE id = $1`,
        [id, b.kind, b.label.trim(), b.number?.trim() || null, b.jurisdiction?.trim() || null, b.lines ?? [], b.kind === 'eo' ? b.limitAmount : null, b.expiresOn ?? null, b.notes?.trim() || null]);
      if (!r.rowCount) throw notFound('Unknown item');
      await audit(tx, ctx, 'compliance_item_changed', 'compliance_item', id, { kind: b.kind });
    });
    return reply.code(204).send();
  });

  app.delete('/v1/compliance/items/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = await tx.query('DELETE FROM compliance_items WHERE id = $1', [id]);
      if (!r.rowCount) throw notFound('Unknown item');
      await audit(tx, ctx, 'compliance_item_removed', 'compliance_item', id);
    });
    return reply.code(204).send();
  });

  /** The partner confirms the information is true. This is a recorded click, not a legal signature. */
  app.post('/v1/compliance/partners/:nodeId/attest', { schema: { params: { type: 'object', properties: { nodeId: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { nodeId } = req.params as { nodeId: string };
    await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      await tx.query(
        `INSERT INTO compliance_profiles (node_id, tenant_id, attested_at, attested_by) VALUES ($1,$2,now(),$3)
         ON CONFLICT (node_id) DO UPDATE SET attested_at = now(), attested_by = $3, updated_at = now()`, [nodeId, node.tenantId, ctx.userId]);
      await audit(tx, ctx, 'compliance_attested', 'partner', nodeId, {}, nodeId);
    });
    return reply.code(204).send();
  });

  /** The company records where the partner agreement stands. It is signed outside PII; PII keeps the status and the copy. */
  app.put('/v1/compliance/partners/:nodeId/agreement', {
    schema: { params: { type: 'object', properties: { nodeId: uuid } }, body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: ['not_sent', 'sent', 'signed'] }, signedOn: { anyOf: [date, { type: 'null' }] } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    if (!MANAGE(ctx)) throw forbidden('Only a manager or administrator records the agreement');
    const { nodeId } = req.params as { nodeId: string };
    const b = req.body as { status: string; signedOn?: string | null };
    await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      await tx.query(
        `INSERT INTO compliance_profiles (node_id, tenant_id, agreement_status, agreement_signed_on) VALUES ($1,$2,$3,$4)
         ON CONFLICT (node_id) DO UPDATE SET agreement_status = $3, agreement_signed_on = $4, updated_at = now()`,
        [nodeId, node.tenantId, b.status, b.status === 'signed' ? (b.signedOn ?? new Date().toISOString().slice(0, 10)) : null]);
      await audit(tx, ctx, 'compliance_agreement', 'partner', nodeId, { status: b.status }, nodeId);
    });
    return reply.code(204).send();
  });

  app.post('/v1/compliance/partners/:nodeId/submit', { schema: { params: { type: 'object', properties: { nodeId: uuid } } } }, async (req, reply) => {
    const { ctx, user } = await deps.authenticate(req);
    requireWrite(ctx);
    const { nodeId } = req.params as { nodeId: string };
    const name = await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      const file = await buildFile(tx, ctx, node, country);
      if (!file.checklist.complete) throw invalid('Finish every step before sending the file for review');
      if (file.profile?.status === 'submitted') throw conflict('This file is already waiting for review');
      await tx.query(`UPDATE compliance_profiles SET status = 'submitted', submitted_at = now(), reviewed_at = NULL, reviewed_by = NULL, reviewed_by_name = NULL, review_note = NULL, updated_at = now() WHERE node_id = $1`, [nodeId]);
      await audit(tx, ctx, 'compliance_submitted', 'partner', nodeId, {}, nodeId);
      return node.name;
    });
    const company = user.tenantName;
    for (const ho of await headOfficeAudience(deps)) await tell(deps, ho.tenantId, ho.userIds, 'compliance_review', ctx.userId, { decision: 'submitted', nodeId, name, company });
    return reply.code(204).send();
  });

  // --- carrier appointments -----------------------------------------------------------------------------
  app.post('/v1/compliance/partners/:nodeId/appointments', {
    schema: { params: { type: 'object', properties: { nodeId: uuid } }, body: { type: 'object', required: ['carrier'], additionalProperties: false, properties: { carrier: { type: 'string', minLength: 1, maxLength: 120 }, note: { type: ['string', 'null'], maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx, user } = await deps.authenticate(req);
    requireWrite(ctx);
    const { nodeId } = req.params as { nodeId: string };
    const b = req.body as { carrier: string; note?: string | null };
    const out = await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      const approved = (await tx.query<{ status: string }>('SELECT status FROM compliance_profiles WHERE node_id = $1', [nodeId])).rows[0]?.status === 'approved';
      if (!approved) throw invalid('A carrier appointment can be requested once the compliance file is approved');
      const r = await tx.query<{ id: string }>('INSERT INTO carrier_appointments (tenant_id, node_id, carrier, note, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING id', [node.tenantId, nodeId, b.carrier.trim(), b.note?.trim() || null, ctx.userId]);
      await audit(tx, ctx, 'appointment_requested', 'partner', nodeId, { carrier: b.carrier.trim() }, nodeId);
      return { id: r.rows[0]!.id, name: node.name };
    });
    for (const ho of await headOfficeAudience(deps)) await tell(deps, ho.tenantId, ho.userIds, 'appointment_request', ctx.userId, { nodeId, name: out.name, carrier: b.carrier.trim(), company: user.tenantName });
    return reply.code(201).send({ id: out.id });
  });

  // --- documents, stored in PII --------------------------------------------------------------------------
  app.post('/v1/compliance/partners/:nodeId/documents', {
    bodyLimit: 7_600_000,
    schema: { params: { type: 'object', properties: { nodeId: uuid } }, body: { type: 'object', required: ['kind', 'filename', 'dataBase64'], additionalProperties: false, properties: {
      kind: { type: 'string', enum: ['eo_certificate', 'licence', 'agreement', 'other'] }, filename: { type: 'string', minLength: 1, maxLength: 200 }, itemId: { anyOf: [uuid, { type: 'null' }] }, dataBase64: { type: 'string', maxLength: 7_400_000 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { nodeId } = req.params as { nodeId: string };
    const b = req.body as { kind: string; filename: string; itemId?: string | null; dataBase64: string };
    const bytes = Buffer.from(b.dataBase64, 'base64');
    if (bytes.length === 0) throw invalid('That file is empty');
    if (bytes.length > MAX_DOC_BYTES) throw invalid('Files can be up to 5 MB');
    const mime = sniffMime(bytes);
    if (!mime) throw invalid('Upload a PDF, PNG or JPEG file');
    const id = await run(ctx, async (tx) => {
      const node = await partnerOf(tx, nodeId);
      const n = (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM compliance_documents WHERE node_id = $1', [nodeId])).rows[0]!.n;
      if (n >= MAX_DOCS_PER_PARTNER) throw invalid(`A partner can have up to ${MAX_DOCS_PER_PARTNER} files`);
      if (b.itemId && !(await tx.query('SELECT 1 FROM compliance_items WHERE id = $1 AND node_id = $2', [b.itemId, nodeId])).rowCount) throw invalid('That item belongs to another partner');
      const r = await tx.query<{ id: string }>(
        `INSERT INTO compliance_documents (tenant_id, node_id, item_id, kind, filename, mime, size_bytes, data, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [node.tenantId, nodeId, b.itemId ?? null, b.kind, safeFilename(b.filename, mime), mime, bytes.length, bytes, ctx.userId]);
      await audit(tx, ctx, 'compliance_document_added', 'partner', nodeId, { kind: b.kind, bytes: bytes.length }, nodeId);
      return r.rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  app.get('/v1/compliance/documents/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const d = (await tx.query<{ filename: string; mime: string; data: Buffer }>('SELECT filename, mime, data FROM compliance_documents WHERE id = $1', [id])).rows[0];
      if (!d) throw notFound('Unknown file');
      await audit(tx, ctx, 'compliance_document_viewed', 'compliance_document', id);
      return { filename: d.filename, mime: d.mime, dataBase64: d.data.toString('base64') };
    });
  });

  app.delete('/v1/compliance/documents/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    requireWrite(ctx);
    const { id } = req.params as { id: string };
    await run(ctx, async (tx) => {
      const r = await tx.query('DELETE FROM compliance_documents WHERE id = $1', [id]);
      if (!r.rowCount) throw notFound('Unknown file');
      await audit(tx, ctx, 'compliance_document_removed', 'compliance_document', id);
    });
    return reply.code(204).send();
  });

  // --- head office --------------------------------------------------------------------------------------
  const ho = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => run(ctx, fn);

  app.get('/v1/ho/companies', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return ho(ctx, async (tx) => ({
      country,
      companies: (await tx.query('SELECT tenant_id AS id, name, created_at AS "createdAt", admin_email AS "adminEmail", admin_status AS "adminStatus", partners, submitted, approved FROM ho_company_list()')).rows,
    }));
  });

  app.post('/v1/ho/companies', {
    schema: { body: { type: 'object', required: ['name', 'adminEmail'], additionalProperties: false, properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, adminEmail: { type: 'string', format: 'email', maxLength: 320 }, locale: { type: 'string', enum: ['en', 'fr-CA'] } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { name: string; adminEmail: string; locale?: 'en' | 'fr-CA' };
    const id = await ho(ctx, async (tx) => {
      const r = await tx.query<{ id: string }>('SELECT ho_company_create($1,$2,$3) AS id', [b.name, b.adminEmail, b.locale ?? 'en']);
      await audit(tx, ctx, 'company_created', 'tenant', r.rows[0]!.id, { name: b.name.trim() });
      return r.rows[0]!.id;
    });
    return reply.code(201).send({ id });
  });

  app.get('/v1/ho/partners', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return ho(ctx, async (tx) => {
      const rows = (await tx.query<Record<string, unknown> & { eo_min: string | null; eo_count: number; licences: number; eo_max: string | null; entity_type: string | null; legal_name: string | null; business_number: string | null; agreement_status: string; attested: boolean }>('SELECT * FROM ho_compliance_list()')).rows;
      const global = Number(process.env.EO_MIN_LIMIT ?? 0);
      return {
        country,
        partners: rows.map((r) => {
          const eoMin = effectiveEoMin(global, r.eo_min === null ? null : Number(r.eo_min));
          const eoMax = r.eo_max === null ? null : Number(r.eo_max);
          return {
            tenantId: r.tenant_id, company: r.company, nodeId: r.node_id, name: r.name, isSub: r.is_sub, status: r.status, licences: r.licences, eoCount: r.eo_count, eoMax,
            nextExpiry: r.next_expiry, agreement: r.agreement_status, eoMin, updatedAt: r.updated_at,
            checklist: computeChecklist({ profile: { entityType: r.entity_type, legalName: r.legal_name, businessNumber: r.business_number, attestedAt: r.attested ? 'x' : null, agreementStatus: r.agreement_status }, licences: r.licences, eoCount: r.eo_count, eoMaxLimit: eoMax, eoMin }),
          };
        }),
      };
    });
  });

  app.get('/v1/ho/partners/:nodeId', { schema: { params: { type: 'object', properties: { nodeId: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { nodeId } = req.params as { nodeId: string };
    return ho(ctx, async (tx) => {
      const d = (await tx.query<{ d: Record<string, unknown> | null }>('SELECT ho_compliance_detail($1) AS d', [nodeId])).rows[0]?.d;
      if (!d) throw notFound('Unknown partner');
      const items = (d.items as { id: string; kind: string; expires_on: string | null; limit_amount: string | null; [k: string]: unknown }[]).map((i) => ({
        id: i.id, kind: i.kind, label: i.label, number: i.number, jurisdiction: i.jurisdiction, lines: i.lines, notes: i.notes,
        limitAmount: i.limit_amount === null ? null : Number(i.limit_amount), expiresOn: i.expires_on,
        daysLeft: i.expires_on ? Math.round((Date.parse(i.expires_on) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000) : null,
      }));
      const p = d.profile as Record<string, unknown> | null;
      const eoMin = effectiveEoMin(Number(process.env.EO_MIN_LIMIT ?? 0), d.eoMin === null ? null : Number(d.eoMin));
      const live = items.filter((i) => i.kind === 'eo' && (i.daysLeft === null || i.daysLeft >= 0));
      const profile = p && {
        entityType: p.entity_type, legalName: p.legal_name, businessNumber: p.business_number, fields: p.fields, agreementStatus: p.agreement_status, agreementSignedOn: p.agreement_signed_on,
        attestedAt: p.attested_at, status: p.status, submittedAt: p.submitted_at, reviewedByName: p.reviewed_by_name, reviewedAt: p.reviewed_at, reviewNote: p.review_note,
      };
      return {
        node: { id: d.nodeId, name: d.name }, company: d.company, isSub: d.isSub, country, eoMin, profile, items,
        documents: (d.documents as { id: string; itemId: string | null; kind: string; filename: string; mime: string; sizeBytes: number; createdAt: string }[]),
        appointments: (d.appointments as { id: string; carrier: string; status: string; note: string | null; created_at: string; updated_at: string }[]).map((a) => ({ id: a.id, carrier: a.carrier, status: a.status, note: a.note, createdAt: a.created_at, updatedAt: a.updated_at })),
        checklist: computeChecklist({ profile: profile as never, licences: items.filter((i) => i.kind === 'licence').length, eoCount: items.filter((i) => i.kind === 'eo').length,
          eoMaxLimit: live.reduce<number | null>((m, i) => (i.limitAmount !== null && (m === null || i.limitAmount > m) ? i.limitAmount : m), null), eoMin }),
        options: { entityTypes: ENTITY_TYPES[country], lines: LINES_OF_AUTHORITY[country], fields: PROFILE_FIELDS[country] },
      };
    });
  });

  app.post('/v1/ho/partners/:nodeId/review', {
    schema: { params: { type: 'object', properties: { nodeId: uuid } }, body: { type: 'object', required: ['decision'], additionalProperties: false, properties: { decision: { type: 'string', enum: ['approved', 'rejected'] }, note: { type: ['string', 'null'], maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { nodeId } = req.params as { nodeId: string };
    const b = req.body as { decision: 'approved' | 'rejected'; note?: string | null };
    if (b.decision === 'rejected' && !b.note?.trim()) throw invalid('Tell the partner what to fix');
    await ho(ctx, async (tx) => {
      const ok = (await tx.query<{ ok: boolean }>('SELECT ho_compliance_review($1,$2,$3) AS ok', [nodeId, b.decision, b.note ?? null])).rows[0]!.ok;
      if (!ok) throw conflict('That file is not waiting for review');
      await audit(tx, ctx, `compliance_${b.decision}`, 'partner', nodeId, { note: b.note ?? null });
    });
    return reply.code(204).send();
  });

  app.get('/v1/ho/documents/:id', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    return ho(ctx, async (tx) => {
      const d = (await tx.query<{ filename: string; mime: string; data: Buffer }>('SELECT * FROM ho_compliance_document($1)', [id])).rows[0];
      if (!d) throw notFound('Unknown file');
      await audit(tx, ctx, 'compliance_document_viewed', 'compliance_document', id);
      return { filename: d.filename, mime: d.mime, dataBase64: d.data.toString('base64') };
    });
  });

  app.put('/v1/ho/appointments/:id', {
    schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', required: ['status'], additionalProperties: false, properties: { status: { type: 'string', enum: ['requested', 'in_progress', 'appointed', 'declined'] }, note: { type: ['string', 'null'], maxLength: 500 } } } },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const { id } = req.params as { id: string };
    const b = req.body as { status: string; note?: string | null };
    await ho(ctx, async (tx) => {
      if (!(await tx.query<{ ok: boolean }>('SELECT ho_appointment_set($1,$2,$3) AS ok', [id, b.status, b.note ?? null])).rows[0]!.ok) throw notFound('Unknown request');
      await audit(tx, ctx, 'appointment_updated', 'carrier_appointment', id, { status: b.status });
    });
    return reply.code(204).send();
  });

  // Jump-to: names only. A few companies and partners whose name contains the text, nothing else.
  app.get('/v1/ho/search', { schema: { querystring: { type: 'object', required: ['q'], properties: { q: { type: 'string', minLength: 2, maxLength: 80 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const like = `%${(req.query as { q: string }).q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return ho(ctx, async (tx) => ({
      country,
      companies: (await tx.query('SELECT tenant_id AS id, name FROM ho_company_list() WHERE name ILIKE $1 ORDER BY name LIMIT 6', [like])).rows,
      partners: (await tx.query('SELECT node_id AS "nodeId", name, company FROM ho_compliance_list() WHERE name ILIKE $1 ORDER BY name LIMIT 8', [like])).rows,
    }));
  });

  // Counts only: the funnel, the review backlog, E&O coverage, expiries by week and appointment requests, for every company in this country.
  app.get('/v1/ho/insights', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return ho(ctx, async (tx) => ({ ...(await tx.query<{ r: Record<string, unknown> }>('SELECT ho_insights($1) AS r', [Number(process.env.EO_MIN_LIMIT ?? 0)])).rows[0]!.r, prev: await snapshotBefore(tx, 'ho', 30) }));
  });

  app.get('/v1/ho/expiring', { schema: { querystring: { type: 'object', properties: { days: { type: 'integer', minimum: 0, maximum: 365 } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const days = (req.query as { days?: number }).days ?? 60;
    return ho(ctx, async (tx) => ({
      items: (await tx.query('SELECT item_id AS "itemId", tenant_id AS "tenantId", company, node_id AS "nodeId", name, kind, label, expires_on::text AS "expiresOn", days_left AS "daysLeft" FROM ho_compliance_expiring($1)', [days])).rows,
    }));
  });
}

/** Reminds people 30, 15 and 0 days before a licence or E&O policy runs out. Each item gets each reminder once per expiry date. */
export async function sweepCompliance(deps: AppDeps): Promise<number> {
  type Cand = { id: string; tenant_id: string; node_id: string; name: string; kind: string; label: string; expires_on: string; days: number };
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n JOIN tenants t ON t.id = n.tenant_id AND NOT t.is_head_office WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let made = 0;
  const hoPeople = await headOfficeAudience(deps);
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const admin = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      const due = await withRequestTx(deps.appPool, admin, async (tx) => (await tx.query<Cand>(
        `SELECT i.id, i.tenant_id, i.node_id, n.name, i.kind, i.label, i.expires_on::text AS expires_on, (i.expires_on - current_date)::int AS days
           FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id AND n.is_active
          WHERE i.expires_on IS NOT NULL AND i.expires_on <= current_date + 30 AND i.expires_on >= current_date - 30 LIMIT 2000`)).rows);
      for (const c of due) {
        const th = reminderThreshold(c.days);
        if (th === null) continue;
        const fresh = await withRequestTx(deps.appPool, admin, async (tx) => {
          // Mark the tighter reminder, and any looser one that was skipped, so a late-added item sends one message and not three.
          let first = false;
          for (const x of [30, 15, 0] as const) {
            if (x < th) continue;
            const r = await tx.query('INSERT INTO compliance_marks (item_id, tenant_id, threshold, expires_on) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [c.id, c.tenant_id, x, c.expires_on]);
            if (x === th && r.rowCount) first = true;
          }
          return first;
        });
        if (!fresh) continue;
        const who = await fileAudience(deps, c.node_id);
        const data = { name: c.name, label: c.label, itemKind: c.kind, daysLeft: c.days, threshold: th, expiresOn: c.expires_on, nodeId: c.node_id };
        await tell(deps, who.tenantId, who.userIds, 'compliance_expiry', null, data);
        for (const h of hoPeople) await tell(deps, h.tenantId, h.userIds, 'compliance_expiry', null, { ...data, company: (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [c.tenant_id])).rows[0]?.name });
        made++;
      }
    } catch { /* next company */ }
  }
  return made;
}
