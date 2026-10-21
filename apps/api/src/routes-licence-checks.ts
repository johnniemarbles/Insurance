// Licence checks against the regulators (roadmap Phase 3, feature 12). Switch: LICENCE_CHECKS_ENABLED (404 when off).
// Compliance (or a tenant admin) works from the Compliance page: each partner licence in Ontario or British Columbia
// with its regulator's public register, the last check and when the next is due. A check: open the register, save the
// result, upload it; PII's Gemini key reads it and compares it with the licence on file; compliance confirms. The saved
// result is kept as evidence. An adverse result stops the partner being cleared to transact and tells compliance.
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { tenantSettingInt } from './needs-analysis.ts';
import { tell } from './routes-compliance.ts';
import { actingAs } from './effects.ts';
import { ADVERSE, REGISTER_SYSTEM, REGULATORS, STATUSES, compareRegister, licenceChecksEnabled, nextDue, parseRegisterRead, regulatorFor } from './licence-checks.ts';
import type { AppDeps } from './app.ts';

const EVIDENCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const LATEST = `(SELECT row_to_json(c) FROM (SELECT status, checked_on::text AS "checkedOn", next_due_on::text AS "nextDueOn", name_matches AS "nameMatches", number_matches AS "numberMatches",
                discipline_found AS "disciplineFound", checked_by_name AS "checkedBy", note, evidence_id AS "evidenceId" FROM licence_checks x WHERE x.item_id = i.id ORDER BY x.created_at DESC LIMIT 1) c)`;

/** Partners whose latest register check on any licence is adverse. Used by "cleared to transact". */
export async function registerProblemNodes(tx: Tx): Promise<Set<string>> {
  if (!licenceChecksEnabled()) return new Set();
  const rows = (await tx.query<{ node_id: string }>(
    `SELECT DISTINCT l.node_id FROM (SELECT DISTINCT ON (item_id) item_id, node_id, status FROM licence_checks ORDER BY item_id, created_at DESC) l
      WHERE l.status = ANY($1)`, [[...ADVERSE]])).rows;
  return new Set(rows.map((r) => r.node_id));
}

async function complianceAudience(deps: AppDeps, tenantId: string): Promise<string[]> {
  return (await deps.authPool.query<{ user_id: string }>(
    `SELECT DISTINCT r.user_id FROM user_node_roles r JOIN app_users u ON u.id = r.user_id
      WHERE r.tenant_id = $1 AND r.role::text IN ('admin', 'compliance') AND u.status::text <> 'disabled'`, [tenantId])).rows.map((x) => x.user_id);
}

export function registerLicenceCheckRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!licenceChecksEnabled()) throw notFound('Not found');
    const i = await deps.authenticate(req);
    requireCrm(i.ctx);
    if (!canWaive(i.ctx)) throw forbidden('Only an administrator or the compliance role can check licences');
    return i;
  };
  const itemFor = async (tx: Tx, id: string) => {
    const r = (await tx.query<{ id: string; node_id: string; holder: string; label: string; number: string | null; jurisdiction: string | null; expires_on: string | null }>(
      `SELECT i.id, i.node_id, n.name AS holder, i.label, i.number, i.jurisdiction, i.expires_on::text AS expires_on FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id WHERE i.id = $1 AND i.kind = 'licence'`, [id])).rows[0];
    if (!r) throw notFound('Licence not found');
    return r;
  };
  const evidence = { type: 'object', additionalProperties: false, required: ['filename', 'mime', 'dataBase64'], properties: { filename: { type: 'string', minLength: 1, maxLength: 160 }, mime: { enum: EVIDENCE_TYPES }, dataBase64: { type: 'string', minLength: 4, maxLength: 7_000_000 } } } as const;

  app.get('/v1/licence-checks', async (req) => {
    const { ctx } = await begin(req);
    return run(ctx, async (tx) => {
      const rows = (await tx.query<{ id: string; nodeId: string; partner: string; label: string; number: string | null; jurisdiction: string | null; expiresOn: string | null; latest: Record<string, unknown> | null }>(
        `SELECT i.id, i.node_id AS "nodeId", n.name AS partner, i.label, i.number, i.jurisdiction, i.expires_on::text AS "expiresOn", ${LATEST} AS latest
           FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id WHERE i.kind = 'licence' AND n.is_active ORDER BY n.name, i.label LIMIT 1000`)).rows;
      const today = new Date().toISOString().slice(0, 10);
      const licences = rows.map((r) => {
        const reg = regulatorFor(r.jurisdiction);
        const latest = r.latest as { status: string; nextDueOn: string } | null;
        return { ...r, regulator: reg, regulatorName: reg === 'other' ? null : REGULATORS[reg].name, register: reg === 'other' ? null : REGULATORS[reg].register,
          due: reg !== 'other' && (!latest || latest.nextDueOn <= today), adverse: !!latest && (ADVERSE as readonly string[]).includes(latest.status) };
      }).sort((a, b) => Number(b.adverse) - Number(a.adverse) || Number(b.due) - Number(a.due) || a.partner.localeCompare(b.partner));
      return { licences, days: await tenantSettingInt(tx, 'compliance.licenceCheckDays', 90), readerAvailable: !!deps.aiProviders?.gemini?.see };
    });
  });

  // Read a saved register page with Gemini and compare it with the licence on file. Nothing is stored here.
  app.post('/v1/licence-checks/read', {
    bodyLimit: 9 * 1024 * 1024,
    schema: { body: { type: 'object', additionalProperties: false, required: ['itemId', 'evidence'], properties: { itemId: uuid, evidence } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    const b = req.body as { itemId: string; evidence: { filename: string; mime: string; dataBase64: string } };
    const seer = deps.aiProviders?.gemini;
    if (!seer?.see) throw new HttpError(503, 'ai_unavailable', 'Reading register pages needs a Google Gemini key on this server. Record the result by hand instead.');
    const item = await run(ctx, (tx) => itemFor(tx, b.itemId));
    const data = Buffer.from(b.evidence.dataBase64, 'base64');
    if (data.length > 5 * 1024 * 1024) throw invalid('The saved page must be 5 MB or smaller');
    let raw: string;
    try { raw = await seer.see({ system: REGISTER_SYSTEM, user: 'Read this register result and answer with the JSON described.', images: [{ mime: b.evidence.mime, data }], maxTokens: 800 }); }
    catch (e) { req.log.warn({ err: (e as Error).message }, 'licence check: read failed'); throw new HttpError(502, 'ai_failed', 'The page could not be read. Try a clearer screenshot, or record the result by hand.'); }
    const read = parseRegisterRead(raw);
    return { read, ...compareRegister(read, { holder: item.holder, number: item.number, expiresOn: item.expires_on }) };
  });

  app.post('/v1/licence-checks', {
    bodyLimit: 9 * 1024 * 1024,
    schema: { body: { type: 'object', additionalProperties: false, required: ['itemId', 'status', 'method'], properties: {
      itemId: uuid, method: { enum: ['register_read', 'manual'] }, status: { enum: [...STATUSES] },
      nameMatches: { type: ['boolean', 'null'] }, numberMatches: { type: ['boolean', 'null'] }, disciplineFound: { type: ['boolean', 'null'] },
      expiryRead: { anyOf: [{ type: 'null' }, { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }] }, note: { type: 'string', maxLength: 500 }, evidence } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const b = req.body as { itemId: string; method: string; status: string; nameMatches?: boolean | null; numberMatches?: boolean | null; disciplineFound?: boolean | null; expiryRead?: string | null; note?: string; evidence?: { filename: string; mime: string; dataBase64: string } };
    if (b.method === 'manual' && !b.evidence && !(b.note ?? '').trim()) throw invalid('Say where you checked, or attach the saved register page');
    if ((ADVERSE as readonly string[]).includes(b.status) && (b.note ?? '').trim().length < 10) throw invalid('Add a note of at least 10 characters for a suspended, revoked, lapsed or not-found result');
    const out = await run(ctx, async (tx) => {
      const item = await itemFor(tx, b.itemId);
      let evidenceId: string | null = null;
      if (b.evidence) {
        const data = Buffer.from(b.evidence.dataBase64, 'base64');
        if (!data.length || data.length > 5 * 1024 * 1024) throw invalid('The saved page must be 5 MB or smaller');
        evidenceId = (await tx.query<{ id: string }>(
          `INSERT INTO compliance_documents (tenant_id, node_id, item_id, kind, filename, mime, size_bytes, data, uploaded_by) VALUES ($1,$2,$3,'licence',$4,$5,$6,$7,$8) RETURNING id`,
          [ctx.tenantId, item.node_id, item.id, `Register check ${new Date().toISOString().slice(0, 10)} - ${b.evidence.filename}`.slice(0, 160), b.evidence.mime, data.length, data, ctx.userId])).rows[0]!.id;
      }
      const days = await tenantSettingInt(tx, 'compliance.licenceCheckDays', 90);
      const today = new Date().toISOString().slice(0, 10);
      const me = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      const r = (await tx.query<{ id: string; next_due_on: string }>(
        `INSERT INTO licence_checks (tenant_id, node_id, item_id, regulator, method, status, name_matches, number_matches, expiry_read, discipline_found, evidence_id, note, checked_by, checked_by_name, next_due_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id, next_due_on::text`,
        [ctx.tenantId, item.node_id, item.id, regulatorFor(item.jurisdiction), b.method, b.status, b.nameMatches ?? null, b.numberMatches ?? null, b.expiryRead ?? null, b.disciplineFound ?? null,
         evidenceId, b.note?.trim() || null, ctx.userId, me, nextDue(today, days)])).rows[0]!;
      await audit(tx, ctx, 'licence_checked', 'org_node', item.node_id, { check: r.id, item: item.id, status: b.status, method: b.method });
      return { id: r.id, nextDueOn: r.next_due_on, partner: item.holder, label: item.label, nodeId: item.node_id };
    });
    if ((ADVERSE as readonly string[]).includes(b.status) || b.disciplineFound) {
      await tell(deps, ctx.tenantId, await complianceAudience(deps, ctx.tenantId), 'licence_check', ctx.userId, { issue: 'adverse', name: out.partner, label: out.label, status: b.status, nodeId: out.nodeId });
    }
    return reply.code(201).send({ id: out.id, nextDueOn: out.nextDueOn });
  });
}

/** Licences due (or overdue) for a register check: tell each company's compliance people once per licence per due date. */
export async function sweepLicenceChecks(deps: AppDeps): Promise<number> {
  if (!licenceChecksEnabled()) return 0;
  const tenants = (await deps.authPool.query<{ tenant_id: string; node: string; admin: string | null }>(
    `SELECT n.tenant_id, n.id AS node, (SELECT r.user_id FROM user_node_roles r WHERE r.node_id = n.id AND r.role = 'admin' ORDER BY r.user_id LIMIT 1) AS admin
       FROM org_nodes n WHERE n.type = 'tenant' AND n.is_active LIMIT 500`)).rows;
  let made = 0;
  for (const t of tenants) {
    if (!t.admin) continue;
    try {
      const ctx = { ...actingAs(t.tenant_id, t.admin, t.node), isTenantAdmin: true };
      const people = await complianceAudience(deps, t.tenant_id);
      if (!people.length) continue;
      const due = await withRequestTx(deps.appPool, ctx, async (tx) => (await tx.query<{ id: string; partner: string; label: string; jurisdiction: string | null; due: string }>(
        `SELECT i.id, n.name AS partner, i.label, i.jurisdiction, coalesce((SELECT max(c.next_due_on) FROM licence_checks c WHERE c.item_id = i.id), current_date)::text AS due
           FROM compliance_items i JOIN org_nodes n ON n.id = i.node_id
          WHERE i.kind = 'licence' AND n.is_active AND (i.expires_on IS NULL OR i.expires_on >= current_date)
            AND coalesce((SELECT max(c.next_due_on) FROM licence_checks c WHERE c.item_id = i.id), current_date) <= current_date
          ORDER BY 5 LIMIT 300`)).rows.filter((r) => regulatorFor(r.jurisdiction) !== 'other'));
      for (const d of due) {
        const key = `licence-check:${d.id}:${d.due}`;
        const fresh: string[] = [];
        await withRequestTx(deps.appPool, ctx, async (tx) => {
          for (const uid of people) if ((await tx.query('INSERT INTO reminder_marks (tenant_id, user_id, key) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [t.tenant_id, uid, key])).rowCount) fresh.push(uid);
        });
        if (fresh.length) { await tell(deps, t.tenant_id, fresh, 'licence_check', null, { issue: 'due', name: d.partner, label: d.label, due: d.due }); made++; }
      }
    } catch (e) { if (process.env.ALERT_DEBUG) console.error('licence checks', e); }
  }
  return made;
}
