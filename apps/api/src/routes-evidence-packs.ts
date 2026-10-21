// Network evidence packs (roadmap Phase 3, feature 13). Switch: EVIDENCE_PACKS_ENABLED (404 when off).
// Compliance (or a tenant admin) exports one ZIP for a partner, a carrier, or a regulator request, over a period:
//   registers/  complaints, file reviews, licence checks, conduct decisions, supervision reviews, suitability checks,
//               ID checks, and who is cleared to transact (CSV)
//   partners/   each partner's compliance file (the existing producer package, a ZIP)
//   deals/      each client file (the existing audit package, a ZIP)
//   manifest.json  SHA-256 of every file; the pack's own fingerprint is the SHA-256 of the manifest.
// Everything is read under the exporter's own access. PII records each pack it issued, so a holder can later check one.
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, uuid } from './crm-helpers.ts';
import { canWaive } from './routes-gates.ts';
import { clientFilePackage, producerPackage } from './audit-package.ts';
import { buildZip, csv } from './zip.ts';
import type { AppDeps } from './app.ts';

export const evidencePacksEnabled = (): boolean => ['1', 'true'].includes(String(process.env.EVIDENCE_PACKS_ENABLED ?? '').toLowerCase());
const MAX_DEALS = 150;
const MAX_BYTES = 45 * 1024 * 1024;
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const safe = (n: string) => n.replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 80) || 'file';
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));

interface Scope { kind: 'partner' | 'carrier' | 'regulator'; label: string; nodes: string[] | null; boxes: string[] }

/** Registers for the scope and period. `nodes` limits to deals and partners owned there (null: everything the viewer sees). */
async function registers(tx: Tx, s: Scope, from: string, to: string): Promise<{ path: string; data: Buffer; rows: number }[]> {
  const nodeCond = (col: string) => (s.nodes ? `${col} = ANY($3::uuid[])` : 'true');
  const params = s.nodes ? [from, to, s.nodes] : [from, to];
  const reg = async (path: string, head: string[], sql: string) => {
    const rows = (await tx.query(sql, params)).rows.map((r) => Object.values(r).map(iso));
    return { path: `registers/${path}`, data: Buffer.from('﻿' + csv([head, ...rows]), 'utf8'), rows: rows.length };
  };
  return Promise.all([
    reg('complaints.csv', ['Received', 'Deal', 'Partner', 'Channel', 'Category', 'Summary', 'Status', 'Outcome', 'Resolved on', 'Resolved by', 'Recorded by'],
      `SELECT c.received_on, b.name, n.name, c.channel, c.category, c.summary, c.status, c.outcome, c.resolved_on, c.resolved_by_name, c.recorded_by_name
         FROM client_complaints c JOIN boxes b ON b.id = c.box_id JOIN org_nodes n ON n.id = b.owner_node_id
        WHERE c.received_on BETWEEN $1 AND $2 AND ${nodeCond('b.owner_node_id')} ORDER BY c.received_on`),
    reg('file-reviews.csv', ['Period', 'Deal', 'Partner', 'Reviewer', 'Reason', 'Risk score', 'Risk reasons', 'Status', 'Findings', 'Fix by', 'Fixed note', 'Closed at'],
      `SELECT f.period, b.name, n.name, f.reviewer_name, f.reason, f.risk_score, array_to_string(f.risk_reasons, '; '), f.status, f.findings, f.fix_by, f.fixed_note, f.closed_at
         FROM file_reviews f JOIN boxes b ON b.id = f.box_id JOIN org_nodes n ON n.id = b.owner_node_id
        WHERE f.created_at::date BETWEEN $1 AND $2 AND ${nodeCond('b.owner_node_id')} ORDER BY f.created_at`),
    reg('licence-checks.csv', ['Checked on', 'Partner', 'Licence', 'Number', 'Province', 'Regulator', 'Method', 'Status', 'Name matches', 'Number matches', 'Discipline', 'Note', 'Checked by', 'Next due'],
      `SELECT l.checked_on, n.name, i.label, i.number, i.jurisdiction, l.regulator, l.method, l.status, l.name_matches, l.number_matches, l.discipline_found, l.note, l.checked_by_name, l.next_due_on
         FROM licence_checks l JOIN compliance_items i ON i.id = l.item_id JOIN org_nodes n ON n.id = l.node_id
        WHERE l.checked_on BETWEEN $1 AND $2 AND ${nodeCond('l.node_id')} ORDER BY l.checked_on`),
    reg('supervision-reviews.csv', ['Asked', 'Deal', 'Partner', 'Rule', 'Risk', 'Asked by', 'Due', 'Escalated', 'Status', 'Decided by', 'Note', 'Decided at'],
      `SELECT v.created_at, b.name, n.name, r.name, r.risk, v.requested_by_name, v.due_at, v.escalated_at, v.status, v.decided_by_name, v.decision_note, v.decided_at
         FROM supervision_reviews v JOIN supervision_rules r ON r.id = v.rule_id JOIN boxes b ON b.id = v.box_id JOIN org_nodes n ON n.id = b.owner_node_id
        WHERE v.created_at::date BETWEEN $1 AND $2 AND ${nodeCond('b.owner_node_id')} ORDER BY v.created_at`),
    reg('suitability-checks.csv', ['Run', 'Deal', 'Partner', 'Run by', 'AI used', 'Gaps', 'Questions', 'Status', 'Advisor note', 'Reviewer', 'Reviewer note'],
      `SELECT s.created_at, b.name, n.name, s.run_by_name, s.ai_used, (SELECT count(*) FROM jsonb_array_elements(s.findings) e WHERE e->>'severity' = 'gap'),
              (SELECT count(*) FROM jsonb_array_elements(s.findings) e WHERE e->>'severity' = 'question'), s.status, s.advisor_note, s.reviewer_name, s.reviewer_note
         FROM suitability_checks s JOIN boxes b ON b.id = s.box_id JOIN org_nodes n ON n.id = b.owner_node_id
        WHERE s.created_at::date BETWEEN $1 AND $2 AND ${nodeCond('b.owner_node_id')} ORDER BY s.created_at`),
    reg('id-checks.csv', ['Started', 'Deal', 'Partner', 'Route', 'Status', 'Name', 'Birth date', 'Not expired', 'Selfie', 'Genuine', 'Reasons', 'Decided by', 'Note'],
      `SELECT v.created_at, b.name, n.name, v.route, v.status, v.checks->>'name_matches', v.checks->>'dob_matches', v.checks->>'not_expired', v.checks->>'selfie_matches', v.checks->>'looks_genuine',
              array_to_string(v.reasons, '; '), v.decided_by_name, v.decision_note
         FROM id_verifications v JOIN boxes b ON b.id = v.box_id JOIN org_nodes n ON n.id = b.owner_node_id
        WHERE v.created_at::date BETWEEN $1 AND $2 AND ${nodeCond('b.owner_node_id')} ORDER BY v.created_at`),
    reg('conduct-decisions.csv', ['Decided', 'About', 'Subject', 'Flag', 'Numbers', 'Decision', 'Note', 'By'],
      `SELECT d.created_at, d.subject_type, coalesce((SELECT name FROM org_nodes WHERE id = d.subject_id), (SELECT name FROM boxes WHERE id = d.subject_id), (SELECT full_name FROM contacts WHERE id = d.subject_id), d.subject_id::text),
              d.code, d.fingerprint, d.decision, d.note, d.decided_by_name
         FROM conduct_flag_reviews d WHERE d.created_at::date BETWEEN $1 AND $2
          AND (${s.nodes ? `(d.subject_type = 'advisor' AND d.subject_id = ANY($3::uuid[])) OR (d.subject_type = 'deal' AND EXISTS (SELECT 1 FROM boxes b WHERE b.id = d.subject_id AND b.owner_node_id = ANY($3::uuid[])))` : 'true'})
        ORDER BY d.created_at`),
  ]);
}

export function registerEvidencePackRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!evidencePacksEnabled()) throw notFound('Not found');
    const i = await deps.authenticate(req);
    requireCrm(i.ctx);
    if (!canWaive(i.ctx)) throw forbidden('Only an administrator or the compliance role can export evidence packs');
    return i;
  };
  const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;

  // What can be chosen: the partners the viewer supervises and the carriers with policies on record.
  app.get('/v1/evidence-packs/options', async (req) => {
    const { ctx } = await begin(req);
    return run(ctx, async (tx) => ({
      partners: (await tx.query(`SELECT id, name FROM org_nodes WHERE type = 'partner' AND is_active AND org_node_at_or_below(tenant_id, id) ORDER BY name LIMIT 1000`)).rows,
      carriers: (await tx.query(`SELECT DISTINCT d.id, d.display_name AS name FROM policy_records p JOIN carrier_directory d ON d.id = p.carrier_id WHERE org_node_at_or_below(p.tenant_id, p.producer_node_id) ORDER BY 2`)).rows,
      history: (await tx.query(`SELECT id, scope, scope_label AS "scopeLabel", request_reference AS "requestReference", period_from::text AS "from", period_to::text AS "to", deal_count AS "dealCount",
          file_count AS "fileCount", bytes, manifest_sha256 AS "manifestSha256", exported_by_name AS "exportedBy", created_at AS "createdAt" FROM evidence_packs ORDER BY created_at DESC LIMIT 50`)).rows,
    }));
  });

  app.post('/v1/evidence-packs', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['scope', 'from', 'to'], properties: {
      scope: { enum: ['partner', 'carrier', 'regulator'] }, partnerId: uuid, carrierId: { type: 'string', pattern: '^[a-z0-9-]{2,80}$' }, from: date, to: date,
      requestReference: { type: 'string', maxLength: 200 }, dealIds: { type: 'array', maxItems: MAX_DEALS, uniqueItems: true, items: uuid },
      dealNames: { type: 'array', maxItems: MAX_DEALS, uniqueItems: true, items: { type: 'string', minLength: 1, maxLength: 200 } } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    if (!deps.keys) throw new HttpError(503, 'keys_unavailable', 'Documents are not available on this server yet');
    const keys = deps.keys;
    const b = req.body as { scope: 'partner' | 'carrier' | 'regulator'; partnerId?: string; carrierId?: string; from: string; to: string; requestReference?: string; dealIds?: string[]; dealNames?: string[] };
    if (b.to < b.from) throw invalid('The period ends before it starts');
    if (b.scope === 'partner' && !b.partnerId) throw invalid('Choose a partner');
    if (b.scope === 'carrier' && !b.carrierId) throw invalid('Choose a carrier');
    if (b.scope === 'regulator' && !(b.requestReference ?? '').trim()) throw invalid('Give the regulator\'s request reference');
    return run(ctx, async (tx) => {
      const who = (await tx.query<{ n: string }>('SELECT coalesce(display_name, email::text) AS n FROM app_users WHERE id = $1', [ctx.userId])).rows[0]!.n;
      // Work out the scope under the exporter's own access.
      let s: Scope, ref: string;
      if (b.scope === 'partner') {
        const n = (await tx.query<{ name: string }>(`SELECT name FROM org_nodes WHERE id = $1 AND type = 'partner' AND org_node_at_or_below(tenant_id, id)`, [b.partnerId])).rows[0];
        if (!n) throw notFound('Unknown partner');
        const boxes = (await tx.query<{ id: string }>(`SELECT id FROM boxes WHERE owner_node_id = $1 AND created_at::date <= $3 AND updated_at::date >= $2 ORDER BY created_at`, [b.partnerId, b.from, b.to])).rows.map((r) => r.id);
        s = { kind: 'partner', label: n.name, nodes: [b.partnerId!], boxes }; ref = b.partnerId!;
      } else if (b.scope === 'carrier') {
        const c = (await tx.query<{ name: string }>('SELECT display_name AS name FROM carrier_directory WHERE id = $1', [b.carrierId])).rows[0];
        if (!c) throw notFound('Unknown carrier');
        const producers = (await tx.query<{ id: string }>(`SELECT DISTINCT producer_node_id AS id FROM policy_records WHERE carrier_id = $1 AND effective_date <= $3 AND coalesce(expiry_date, $3) >= $2
            AND org_node_at_or_below(tenant_id, producer_node_id)`, [b.carrierId, b.from, b.to])).rows.map((r) => r.id);
        const boxes = (await tx.query<{ id: string }>(`SELECT DISTINCT bc.box_id AS id FROM policy_records p JOIN policy_parties pp ON pp.policy_id = p.id JOIN box_contacts bc ON bc.contact_id = pp.contact_id JOIN boxes bx ON bx.id = bc.box_id
            WHERE p.carrier_id = $1 AND p.effective_date <= $3 AND coalesce(p.expiry_date, $3) >= $2 AND org_node_at_or_below(p.tenant_id, p.producer_node_id)`, [b.carrierId, b.from, b.to])).rows.map((r) => r.id);
        s = { kind: 'carrier', label: c.name, nodes: producers, boxes }; ref = b.carrierId!;
      } else {
        const boxes = b.dealIds?.length ? (await tx.query<{ id: string }>('SELECT id FROM boxes WHERE id = ANY($1)', [b.dealIds])).rows.map((r) => r.id) : [];
        if ((b.dealIds?.length ?? 0) !== boxes.length) throw notFound('A chosen deal was not found');
        // Deals named as they appear in PII (each name must match exactly one deal the exporter can see).
        if (b.dealNames?.length) {
          const rows = (await tx.query<{ id: string; name: string }>('SELECT id, name FROM boxes WHERE name = ANY($1)', [b.dealNames.map((n) => n.trim())])).rows;
          const bad = b.dealNames.map((n) => n.trim()).filter((n) => rows.filter((r) => r.name === n).length !== 1);
          if (bad.length) throw invalid(`Each deal name must match exactly one deal you can see. Check: ${bad.join(', ')}`);
          for (const r of rows) if (!boxes.includes(r.id)) boxes.push(r.id);
        }
        s = { kind: 'regulator', label: `Regulator request ${b.requestReference!.trim()}`, nodes: null, boxes }; ref = b.requestReference!.trim().slice(0, 120);
      }
      if (s.boxes.length > MAX_DEALS) throw new HttpError(413, 'pack_too_large', `This pack would hold ${s.boxes.length} deals; the most is ${MAX_DEALS}. Choose a shorter period.`);

      const entries: { path: string; data: Buffer }[] = [];
      const regs = await registers(tx, s, b.from, b.to);
      entries.push(...regs.map(({ path, data }) => ({ path, data })));
      const partnerIds = s.kind === 'regulator'
        ? (await tx.query<{ id: string }>(`SELECT DISTINCT b.owner_node_id AS id FROM boxes b JOIN org_nodes n ON n.id = b.owner_node_id WHERE b.id = ANY($1) AND n.type = 'partner'`, [s.boxes])).rows.map((r) => r.id)
        : s.nodes!;
      for (const id of partnerIds) {
        const p = await producerPackage(tx, ctx, id, who).catch(() => null);   // a partner outside the exporter's access is skipped
        if (p) entries.push({ path: `partners/${safe(p.filename)}`, data: p.zip });
      }
      const used = new Set<string>();
      for (const id of s.boxes) {
        const p = await clientFilePackage(tx, ctx, keys, id, who);
        let name = `deals/${safe(p.filename)}`;
        while (used.has(name)) name = name.replace(/\.zip$/, `-${id.slice(0, 6)}.zip`);
        used.add(name);
        entries.push({ path: name, data: p.zip });
      }
      const bytes = entries.reduce((n, e) => n + e.data.length, 0);
      if (bytes > MAX_BYTES) throw new HttpError(413, 'pack_too_large', 'This pack is too large to export at once. Choose a shorter period or fewer deals.');
      const meta = { scope: s.kind, label: s.label, ...(b.requestReference ? { requestReference: b.requestReference.trim() } : {}), period: { from: b.from, to: b.to }, generatedAt: new Date().toISOString(), exportedBy: who };
      const manifest = { ...meta, note: 'SHA-256 of each file as exported. The pack fingerprint is the SHA-256 of this manifest file; PII can confirm it issued a pack with that fingerprint.',
        files: entries.map((e) => ({ path: e.path, bytes: e.data.length, sha256: sha(e.data) })) };
      const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2));
      const fingerprint = sha(manifestBuf);
      const readme = [`Evidence pack: ${s.label}`, `Period: ${b.from} to ${b.to}`, ...(b.requestReference ? [`Request reference: ${b.requestReference.trim()}`] : []), `Exported ${meta.generatedAt} by ${who}`, '',
        'registers/  one CSV per register for the period', 'partners/   each partner\'s compliance file (a ZIP with its own manifest)', 'deals/      each client file (a ZIP with its own manifest)',
        `manifest.json  SHA-256 of every file. Pack fingerprint (SHA-256 of manifest.json): ${fingerprint}`, '',
        'This pack lists the records PII holds. It shows what is on file, not whether the file is compliant.', ''].join('\n');
      const zip = buildZip([{ name: 'README.txt', data: Buffer.from(readme) }, ...entries.map((e) => ({ name: e.path, data: e.data })), { name: 'manifest.json', data: manifestBuf }]);
      const rec = (await tx.query<{ id: string }>(
        `INSERT INTO evidence_packs (tenant_id, scope, scope_ref, scope_label, request_reference, period_from, period_to, deal_count, file_count, bytes, manifest_sha256, exported_by, exported_by_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [ctx.tenantId, s.kind, ref, s.label.slice(0, 200), b.requestReference?.trim() || null, b.from, b.to, s.boxes.length, entries.length, zip.length, fingerprint, ctx.userId, who])).rows[0]!;
      await audit(tx, ctx, 'evidence_pack_exported', 'tenant', ctx.tenantId, { pack: rec.id, scope: s.kind, deals: s.boxes.length, files: entries.length, fingerprint });
      return { id: rec.id, filename: `evidence-pack-${safe(s.label)}-${b.from}-to-${b.to}.zip`, mime: 'application/zip', dataBase64: zip.toString('base64'), fingerprint, deals: s.boxes.length,
        registers: regs.map((r) => ({ path: r.path, rows: r.rows })) };
    });
  });

  // Did PII issue a pack with this fingerprint? (The SHA-256 of the pack's manifest.json.)
  app.post('/v1/evidence-packs/verify', { schema: { body: { type: 'object', additionalProperties: false, required: ['fingerprint'], properties: { fingerprint: { type: 'string', pattern: '^[0-9a-fA-F]{64}$' } } } } }, async (req) => {
    const { ctx } = await begin(req);
    const f = (req.body as { fingerprint: string }).fingerprint.toLowerCase();
    return run(ctx, async (tx) => {
      const r = (await tx.query(`SELECT scope, scope_label AS "scopeLabel", period_from::text AS "from", period_to::text AS "to", exported_by_name AS "exportedBy", created_at AS "createdAt" FROM evidence_packs WHERE manifest_sha256 = $1`, [f])).rows[0];
      return r ? { issued: true, ...r } : { issued: false };
    });
  });
}
