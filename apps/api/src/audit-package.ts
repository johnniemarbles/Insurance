import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Tx } from '@pii/db';
import { DOC_TYPE_LABELS, isDocType, type DocType, type RequestContext } from '@pii/domain';
import { open, type KeyProvider } from '@pii/platform';
import { HttpError, notFound } from './errors.ts';
import { csv, buildZip } from './zip.ts';
import { gateStatus } from './gates.ts';

export const MAX_PACKAGE_BYTES = 25 * 1024 * 1024;
export interface Section { title: string; head: string[]; rows: unknown[][] }
const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : v == null ? '' : String(v));
const safe = (n: string) => n.replace(/[\\/\u0000-\u001f\u007f<>:"|?*]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';

/** Two lines per record: the summary PDF a person reads and the CSV a spreadsheet opens. Latin text only in the PDF; anything else prints as ?. */
async function summaryPdf(title: string, meta: string[], sections: Section[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 40, size = 9, lead = 12;
  const clean = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
  let page = doc.addPage([W, H]); let y = H - M;
  const line = (text: string, f = font, sz = size, color = rgb(0, 0, 0)) => {
    const words = clean(text).split(' '); let cur = '';
    const flush = () => { if (y < M + lead) { page = doc.addPage([W, H]); y = H - M; } page.drawText(cur, { x: M, y, size: sz, font: f, color }); y -= sz + 3; cur = ''; };
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, sz) > W - 2 * M && cur) { flush(); cur = w; } else cur = t; }
    flush();
  };
  line(title, bold, 16); y -= 4; for (const m of meta) line(m);
  for (const s of sections) {
    y -= 8; line(s.title, bold, 11);
    if (s.rows.length === 0) line('None on file.', font, size, rgb(0.4, 0.4, 0.4));
    for (const r of s.rows) line(r.map((c, i) => (c === '' || c == null ? '' : `${s.head[i] ?? ''}: ${c}`)).filter(Boolean).join('  |  '));
  }
  return doc.save();
}

async function finish(base: string, title: string, meta: string[], sections: Section[], files: { path: string; data: Buffer }[], extra: { path: string; data: Buffer }[]) {
  const ledger = csv([['section', ...['field1', 'field2', 'field3', 'field4', 'field5', 'field6']], ...sections.flatMap((s) => [[s.title], s.head, ...s.rows, []])]);
  const pdf = Buffer.from(await summaryPdf(title, meta, sections));
  const all = [...files, ...extra, { path: 'ledger.csv', data: Buffer.from('﻿' + ledger, 'utf8') }, { path: 'summary.pdf', data: pdf }];
  const manifest = { package: title, generatedAt: new Date().toISOString(), note: 'SHA-256 of each file as exported. A later mismatch means the file changed after export.', files: all.map((f) => ({ path: f.path, bytes: f.data.length, sha256: sha(f.data) })) };
  const readme = `${title}\n${meta.join('\n')}\n\nThis package lists the records PII holds. It shows what is on file, not whether the file is compliant.\nsummary.pdf: a readable ledger. ledger.csv: the same for a spreadsheet. manifest.json: a SHA-256 for every file.\nfiles/: the supporting documents as stored.\n`;
  const entries = [{ path: 'README.txt', data: Buffer.from(readme) }, ...all, { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2)) }];
  const total = entries.reduce((n, e) => n + e.data.length, 0);
  if (total > MAX_PACKAGE_BYTES) throw new HttpError(413, 'package_too_large', 'This file has too many documents to export in one package. Export it in parts or ask support.');
  return { filename: `${safe(base)}-audit-package.zip`, zip: buildZip(entries.map((e) => ({ name: e.path, data: e.data }))), fileCount: files.length };
}

/** Everything held for one client file: paperwork against the gates, advice, ID, screening, cash, waivers, documents and the audit entries behind them. */
export async function clientFilePackage(tx: Tx, ctx: RequestContext, keys: KeyProvider, boxId: string, who: string) {
  const box = (await tx.query<{ name: string; pipeline: string; stage: string; owner: string | null; created_at: Date; pipeline_id: string; stage_id: string }>(
    `SELECT b.name, p.name AS pipeline, s.name AS stage, coalesce(u.display_name, u.email::text) AS owner, b.created_at, b.pipeline_id, b.stage_id
       FROM boxes b JOIN pipelines p ON p.id = b.pipeline_id JOIN stages s ON s.id = b.stage_id LEFT JOIN app_users u ON u.id = b.owner_user_id WHERE b.id = $1`, [boxId])).rows[0];
  if (!box) throw notFound('Record not found');
  const q = async <T extends object>(sql: string) => (await tx.query<T>(sql, [boxId])).rows;
  const gatedStages = await q<{ id: string; name: string }>(`SELECT s.id, s.name FROM stages s WHERE s.pipeline_id = (SELECT pipeline_id FROM boxes WHERE id = $1) AND EXISTS (SELECT 1 FROM stage_doc_requirements r WHERE r.stage_id = s.id) ORDER BY s.position`);
  const gates: unknown[][] = [];
  for (const s of gatedStages) {
    const g = await gateStatus(tx, s.id, boxId);
    if (g) for (const t of g.required) {
      const lbl = isDocType(t) ? DOC_TYPE_LABELS[t as DocType].en : t;
      gates.push([s.name, lbl, g.filed.includes(t) ? 'on file' : g.overridden.includes(t) ? 'waived' : 'MISSING']);
    }
  }
  const docs = await q<{ id: string; name: string; mime: string; doc_type: string | null; size_bytes: number; created_at: Date; key_id: string; data_enc: Buffer; by: string | null }>(
    `SELECT d.id, d.name, d.mime, d.doc_type, d.size_bytes, d.created_at, d.key_id, d.data_enc, coalesce(u.display_name, u.email::text) AS by FROM box_documents d LEFT JOIN app_users u ON u.id = d.uploaded_by WHERE d.box_id = $1 ORDER BY d.created_at`);
  const files: { path: string; data: Buffer }[] = []; const docRows: unknown[][] = [];
  for (const d of docs) {
    const data = open(keys, { keyId: d.key_id, data: d.data_enc }, `${ctx.tenantId}:doc:${d.id}`);
    const path = `files/${d.id.slice(0, 8)}-${safe(d.name)}`;
    files.push({ path, data });
    docRows.push([d.name, d.doc_type ? (isDocType(d.doc_type) ? DOC_TYPE_LABELS[d.doc_type as DocType].en : d.doc_type) : 'untyped', iso(d.created_at), d.by ?? '', sha(data).slice(0, 16), path]);
  }
  const advice = await q<Record<string, unknown>>(`SELECT kind, title, status, client_name, signed_method, vendor_name, vendor_ref, signed_at, content_hash FROM advice_records WHERE box_id = $1 ORDER BY created_at`);
  const ids = await q<Record<string, unknown>>(`SELECT method, result, verified_on::text AS verified_on, verifier_name, documents_seen FROM client_id_records WHERE box_id = $1 ORDER BY created_at`);
  const scr = await q<Record<string, unknown>>(`SELECT list, result, screened_on::text AS screened_on, reviewer_name, note FROM screening_results WHERE box_id = $1 ORDER BY created_at`);
  const cash = await q<Record<string, unknown>>(`SELECT amount::text AS amount, currency, occurred_on::text AS occurred_on, report_required, report_ref, reported_at FROM cash_transactions WHERE box_id = $1 ORDER BY created_at`);
  const consents = await q<Record<string, unknown>>(`SELECT kind, wording_version, channel, granted_on::text AS granted_on, recorded_by_name, withdrawn_at, withdrawn_by_name, withdrawn_note FROM client_consents WHERE box_id = $1 ORDER BY created_at`);
  const holds = await q<Record<string, unknown>>(`SELECT reason, placed_by_name, placed_at, released_at, released_by_name FROM legal_holds WHERE box_id = $1 ORDER BY placed_at`);
  const waivers = await q<Record<string, unknown>>(`SELECT (SELECT name FROM stages WHERE id = o.stage_id) AS stage, doc_types, reason, approver_name, created_at FROM gate_overrides o WHERE box_id = $1 ORDER BY created_at`);
  const audits = await q<Record<string, unknown>>(`SELECT a.created_at, a.action, coalesce(u.display_name, u.email::text) AS actor, a.detail::text AS detail FROM audit_log a LEFT JOIN app_users u ON u.id = a.actor_user_id WHERE a.entity_type = 'box' AND a.entity_id = $1 ORDER BY a.created_at, a.id LIMIT 5000`);
  const sections: Section[] = [
    { title: 'Record', head: ['Name', 'Pipeline', 'Stage', 'Owner', 'Created'], rows: [[box.name, box.pipeline, box.stage, box.owner ?? '', iso(box.created_at)]] },
    { title: 'Paperwork required by stage', head: ['Stage', 'Document', 'Status'], rows: gates },
    { title: 'Waivers', head: ['Stage', 'Documents', 'Reason', 'Approved by', 'At'], rows: waivers.map((w) => [w.stage, (w.doc_types as string[]).join('; '), w.reason, w.approver_name, iso(w.created_at)]) },
    { title: 'Client consents', head: ['Kind', 'Wording', 'Channel', 'Granted', 'Recorded by', 'Withdrawn', 'Withdrawn by', 'Note'], rows: consents.map((c) => [c.kind, c.wording_version, c.channel, c.granted_on, c.recorded_by_name, iso(c.withdrawn_at), c.withdrawn_by_name ?? '', c.withdrawn_note ?? '']) },
    { title: 'Legal holds', head: ['Reason', 'Placed by', 'Placed', 'Released', 'Released by'], rows: holds.map((h) => [h.reason, h.placed_by_name, iso(h.placed_at), iso(h.released_at), h.released_by_name ?? '']) },
    { title: 'Documents', head: ['Name', 'Type', 'Added', 'By', 'SHA-256 (first 16)', 'File'], rows: docRows },
    { title: 'Advice records', head: ['Kind', 'Title', 'Status', 'Client', 'Signed by', 'Vendor / ref', 'Signed at', 'Content hash'], rows: advice.map((a) => [a.kind, a.title, a.status, a.client_name, a.signed_method ?? '', a.vendor_name ? `${a.vendor_name} / ${a.vendor_ref}` : '', iso(a.signed_at), a.content_hash ?? '']) },
    { title: 'Client ID checks', head: ['Method', 'Result', 'Date', 'Verified by', 'Documents seen'], rows: ids.map((r) => [r.method, r.result, r.verified_on, r.verifier_name, (r.documents_seen as string[]).join('; ')]) },
    { title: 'PEP and sanctions screening', head: ['List', 'Result', 'Date', 'By', 'Note'], rows: scr.map((r) => [r.list, r.result, r.screened_on, r.reviewer_name, r.note ?? '']) },
    { title: 'Large cash transactions', head: ['Amount', 'Currency', 'Date', 'Report required', 'Report ref', 'Noted at'], rows: cash.map((r) => [r.amount, r.currency, r.occurred_on, r.report_required ? 'yes' : 'no', r.report_ref ?? '', iso(r.reported_at)]) },
  ];
  const auditCsv = csv([['at', 'action', 'actor', 'detail'], ...audits.map((a) => [iso(a.created_at), a.action, a.actor ?? '', a.detail])]);
  return finish(`client-file-${box.name}`, `Client compliance file: ${box.name}`, [`Exported ${new Date().toISOString()} by ${who}`, `Audit entries visible to the exporter: ${audits.length}`], sections, files, [{ path: 'audit-log.csv', data: Buffer.from('﻿' + auditCsv, 'utf8') }]);
}

/** Everything held for one producer: profile, licences, E&O, uploaded certificates and the audit entries behind them. */
export async function producerPackage(tx: Tx, ctx: RequestContext, nodeId: string, who: string) {
  const node = (await tx.query<{ name: string }>(`SELECT name FROM org_nodes WHERE id = $1 AND type = 'partner' AND is_active AND org_node_at_or_below(tenant_id, id)`, [nodeId])).rows[0];
  if (!node) throw notFound('Unknown partner');
  const q = async <T extends object>(sql: string) => (await tx.query<T>(sql, [nodeId])).rows;
  const prof = (await q<Record<string, unknown>>(`SELECT legal_name, entity_type, status, agreement_status, agreement_signed_on::text AS signed_on, attested_at, reviewed_by_name, reviewed_at, review_note FROM compliance_profiles WHERE node_id = $1`))[0];
  const items = await q<Record<string, unknown>>(`SELECT kind, label, number, jurisdiction, lines, limit_amount::text AS limit_amount, expires_on::text AS expires_on, notes FROM compliance_items WHERE node_id = $1 ORDER BY kind, expires_on NULLS LAST`);
  const docs = await q<{ id: string; kind: string; filename: string; data: Buffer; created_at: Date }>(`SELECT id, kind, filename, data, created_at FROM compliance_documents WHERE node_id = $1 ORDER BY created_at`);
  const files = docs.map((d) => ({ path: `files/${d.id.slice(0, 8)}-${safe(d.filename)}`, data: d.data }));
  const audits = await q<Record<string, unknown>>(`SELECT a.created_at, a.action, coalesce(u.display_name, u.email::text) AS actor, a.detail::text AS detail FROM audit_log a LEFT JOIN app_users u ON u.id = a.actor_user_id WHERE a.entity_id = $1 AND a.entity_type IN ('org_node','compliance','partner','compliance_document') ORDER BY a.created_at, a.id LIMIT 5000`);
  const sections: Section[] = [
    { title: 'Profile', head: ['Legal name', 'Entity', 'Status', 'Agreement', 'Signed on', 'Attested', 'Reviewed by', 'Reviewed at', 'Note'], rows: prof ? [[prof.legal_name ?? '', prof.entity_type ?? '', prof.status, prof.agreement_status, prof.signed_on ?? '', iso(prof.attested_at), prof.reviewed_by_name ?? '', iso(prof.reviewed_at), prof.review_note ?? '']] : [] },
    { title: 'Licences and E&O', head: ['Kind', 'Label', 'Number', 'Jurisdiction', 'Lines', 'Limit', 'Expires', 'Notes'], rows: items.map((i) => [i.kind, i.label, i.number ?? '', i.jurisdiction ?? '', (i.lines as string[]).join('; '), i.limit_amount ?? '', i.expires_on ?? '', i.notes ?? '']) },
    { title: 'Uploaded certificates', head: ['Kind', 'File', 'Added', 'SHA-256 (first 16)'], rows: docs.map((d) => [d.kind, d.filename, iso(d.created_at), sha(d.data).slice(0, 16)]) },
  ];
  const auditCsv = csv([['at', 'action', 'actor', 'detail'], ...audits.map((a) => [iso(a.created_at), a.action, a.actor ?? '', a.detail])]);
  return finish(`producer-${node.name}`, `Producer compliance file: ${node.name}`, [`Exported ${new Date().toISOString()} by ${who}`, `Audit entries visible to the exporter: ${audits.length}`], sections, files, [{ path: 'audit-log.csv', data: Buffer.from('﻿' + auditCsv, 'utf8') }]);
}
