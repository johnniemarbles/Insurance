// Families, Gate D (productivity): one email per family through the existing mail merge, the family import with a
// dry run, the family timeline, and what the Gmail side panel shows about a family.
//
// Switch: FAMILIES_PRODUCTIVITY_ENABLED=1, and only together with FAMILIES_ENABLED=1. Off, every route here answers 404,
// existing merges work exactly as before, and the left panel never shows Families.
//
// Family email: each message carries only facts cleared for the one person receiving it (their own name, the family's
// name and salutation, and policies that person owns). Another member's policies never appear. Opt-outs, deceased
// clients and minors are skipped, at planning and again at sending, and each message's facts are kept in the send log.
// Import: a dry run lists every row's problems before anything is written; nothing is written unless every row passes;
// existing clients are linked only by an exact id or email match and their details are never overwritten (no merging).
import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { canEditRecord, type RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { forbidden, invalid, notFound } from './errors.ts';
import { requireCrm, resolveOwnerAndContext, uuid } from './crm-helpers.ts';
import { ageOn, familiesEnabled } from './routes-families.ts';
import { familyInsuranceEnabled } from './routes-family-insurance.ts';
import { familyComplianceEnabled } from './routes-family-compliance.ts';
import { BASE_TOKENS, renderBody, renderSubject, tokensIn } from './merge-render.ts';
import { FAMILY_TOKENS, checkRow, mapHeader, parseCsv, surnameOf, type ImportRow } from './family-tools-rules.ts';
import type { AppDeps } from './app.ts';

export const familyToolsEnabled = (): boolean =>
  familiesEnabled() && ['1', 'true'].includes(String(process.env.FAMILIES_PRODUCTIVITY_ENABLED ?? '').toLowerCase());

const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
type Me = { displayName: string | null; email: string; tenantName: string; locale: 'en' | 'fr-CA' };
export type SkipReason = 'no_email' | 'opted_out' | 'deceased' | 'minor' | 'duplicate' | 'no_head';
type Planned = { familyId: string; familyName: string; ownerNodeId: string; canSend: boolean; recipients: { contactId: string; name: string | null; email: string; role: string }[]; skipped: { contactId: string | null; name: string | null; reason: SkipReason }[] };

/** Under the age of majority: the company's capacity rule when Gate C is on and the province is known, otherwise under 18. */
async function minorNow(tx: Tx, c: { dob: string | null; jur: string | null }): Promise<boolean> {
  if (!c.dob) return false;
  if (familyComplianceEnabled() && c.jur) {
    const r = (await tx.query<{ age: number | null }>(`SELECT (capacity_rule_on($1, 'age_of_majority', current_date)).min_age AS age`, [c.jur])).rows[0];
    if (r?.age != null) return (ageOn(c.dob) ?? 99) < r.age;
  }
  return (ageOn(c.dob) ?? 99) < 18;
}

/** Who one family's email goes to: the Head, or each adult (Head and spouse or partner), by the family's preference. */
export async function planFamily(tx: Tx, ctx: RequestContext, familyId: string, seen: Set<string>): Promise<Planned | null> {
  const f = (await tx.query<{ display_name: string; owner_node_id: string; mailing_preference: string; status: string }>(
    'SELECT display_name, owner_node_id, mailing_preference, status FROM families WHERE id = $1', [familyId])).rows[0];
  if (!f || f.status !== 'active') return null;
  const members = (await tx.query<{ id: string; name: string | null; email: string | null; role: string; opted: boolean; deceased: boolean; dob: string | null; jur: string | null }>(
    `SELECT c.id, c.full_name AS name, c.email::text AS email, m.role, c.email_opt_out_at IS NOT NULL AS opted, c.deceased_on IS NOT NULL AS deceased,
            c.date_of_birth::text AS dob, c.residence_jurisdiction AS jur
       FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
      WHERE m.family_id = $1 AND m.ended_at IS NULL AND m.role IN ('head', 'spouse_partner')
      ORDER BY m.role = 'head' DESC, c.full_name`, [familyId])).rows;
  const out: Planned = { familyId, familyName: f.display_name, ownerNodeId: f.owner_node_id, canSend: canEditRecord(ctx, f.owner_node_id), recipients: [], skipped: [] };
  const head = members.find((m) => m.role === 'head');
  if (!head) { out.skipped.push({ contactId: null, name: null, reason: 'no_head' }); return out; }
  const targets = f.mailing_preference === 'each_adult' ? members : [head];
  for (const m of targets) {
    const skip = (reason: SkipReason) => out.skipped.push({ contactId: m.id, name: m.name, reason });
    if (m.deceased) { skip('deceased'); continue; }
    if (!m.email) { skip('no_email'); continue; }
    if (m.opted) { skip('opted_out'); continue; }
    if (await minorNow(tx, m)) { skip('minor'); continue; }
    const key = m.email.toLowerCase();
    if (seen.has(key)) { skip('duplicate'); continue; }
    seen.add(key);
    out.recipients.push({ contactId: m.id, name: m.name, email: m.email, role: m.role });
  }
  return out;
}

/**
 * The values one family message may use, for one recipient, and the facts that went in. Policies are only those this
 * person owns (or jointly owns) and the caller can see; nothing about another member is included.
 */
export async function familyVarsFor(tx: Tx, familyId: string, contactId: string, email: string, me: Me, template: string):
  Promise<{ vars: Record<string, string>; facts: { key: string; policyIds?: string[] }[]; skip: SkipReason | null }> {
  const c = (await tx.query<{ name: string | null; opted: boolean; deceased: boolean; dob: string | null; jur: string | null; in_family: boolean }>(
    `SELECT c.full_name AS name, c.email_opt_out_at IS NOT NULL AS opted, c.deceased_on IS NOT NULL AS deceased, c.date_of_birth::text AS dob,
            c.residence_jurisdiction AS jur,
            EXISTS (SELECT 1 FROM family_memberships m WHERE m.family_id = $2 AND m.contact_id = c.id AND m.ended_at IS NULL) AS in_family
       FROM contacts c WHERE c.id = $1`, [contactId, familyId])).rows[0];
  const f = (await tx.query<{ display_name: string; salutation: string | null }>('SELECT display_name, salutation FROM families WHERE id = $1', [familyId])).rows[0];
  const skip: SkipReason | null = !c || !f || !c.in_family ? 'no_head' : c.deceased ? 'deceased' : c.opted ? 'opted_out' : (await minorNow(tx, c)) ? 'minor' : null;
  const name = c?.name ?? '';
  const parts = name.trim().split(/\s+/);
  const vars: Record<string, string> = {
    email, name, firstName: parts[0] ?? '', lastName: parts.slice(1).join(' '), myName: me.displayName ?? me.email, myEmail: me.email, company: me.tenantName,
    familyName: f?.display_name ?? '', salutation: f?.salutation ?? name,
  };
  const used = new Set(tokensIn(template).map((t) => t.toLowerCase()));
  const facts: { key: string; policyIds?: string[] }[] = [];
  for (const k of ['familyName', 'salutation', 'name', 'firstName', 'lastName']) if (used.has(k.toLowerCase()) && vars[k]) facts.push({ key: k });
  if ((used.has('mypolicies') || used.has('nextrenewal')) && familyInsuranceEnabled()) {
    const pols = (await tx.query<{ id: string; label: string; expiry: string | null }>(
      `SELECT DISTINCT p.id, concat_ws(' · ', cd.display_name, p.plan_name) AS label, p.expiry_date::text AS expiry
         FROM policy_parties pp JOIN policy_records p ON p.id = pp.policy_id JOIN carrier_directory cd ON cd.id = p.carrier_id
        WHERE pp.contact_id = $1 AND pp.role IN ('owner', 'joint_owner') AND pp.ended_at IS NULL
          AND p.status IN ('active', 'reinstated', 'pending') AND policy_visible(p.id)
        ORDER BY 2`, [contactId])).rows;
    const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(me.locale, { year: 'numeric', month: 'long', day: 'numeric' });
    vars.myPolicies = pols.map((p) => (p.expiry ? `${p.label} (${me.locale === 'fr-CA' ? 'renouvellement le' : 'renews'} ${day(p.expiry)})` : p.label)).join('\n');
    const next = pols.map((p) => p.expiry).filter((d): d is string => !!d && d >= new Date().toISOString().slice(0, 10)).sort()[0];
    vars.nextRenewal = next ? day(next) : '';
    if (pols.length) facts.push({ key: 'myPolicies', policyIds: pols.map((p) => p.id) });
    if (next && used.has('nextrenewal')) facts.push({ key: 'nextRenewal' });
  }
  return { vars, facts, skip };
}

export function checkFamilyTemplate(subject: string, body: string): void {
  if (!tokensIn(body).some((t) => t.toLowerCase() === 'unsubscribe')) throw invalid('Add {{unsubscribe}} to the message. Canadian anti-spam law requires a way to opt out in every marketing email.');
  if (tokensIn(subject).some((t) => t.toLowerCase() === 'unsubscribe')) throw invalid('{{unsubscribe}} belongs in the message, not the subject');
  if (tokensIn(subject).some((t) => t.toLowerCase() === 'mypolicies')) throw invalid('{{myPolicies}} belongs in the message, not the subject');
  const known = new Set([...BASE_TOKENS.filter((t) => !['box', 'stage', 'value', 'owner'].includes(t)), ...FAMILY_TOKENS].map((t) => t.toLowerCase()));
  const unknown = tokensIn(`${subject} ${body}`).filter((t) => !known.has(t.toLowerCase()));
  if (unknown.length) throw invalid(`A family email cannot use ${unknown.map((t) => `{{${t}}}`).join(', ')}. It can use ${[...FAMILY_TOKENS, 'name', 'firstName', 'lastName', 'email', 'myName', 'myEmail', 'company', 'unsubscribe'].map((t) => `{{${t}}}`).join(', ')}.`);
}

export function registerFamilyToolsRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    if (!familyToolsEnabled()) throw notFound();
    const identity = await deps.authenticate(req);
    requireCrm(identity.ctx);
    return identity;
  };
  const familyIds = { type: 'array', minItems: 1, maxItems: 500, uniqueItems: true, items: uuid } as const;

  // ---------------------------------------------------------------- family email
  app.post('/v1/family-merges/plan', { schema: { body: { type: 'object', additionalProperties: false, required: ['familyIds'], properties: { familyIds } } } }, async (req) => {
    const { ctx } = await begin(req);
    const { familyIds: ids } = req.body as { familyIds: string[] };
    return run(ctx, async (tx) => {
      const seen = new Set<string>();
      const families = [];
      for (const id of ids) { const p = await planFamily(tx, ctx, id, seen); if (p) families.push(p); }
      return {
        families,
        totals: { families: families.length, recipients: families.filter((f) => f.canSend).reduce((n, f) => n + f.recipients.length, 0), notYours: families.filter((f) => !f.canSend).length },
      };
    });
  });

  app.post('/v1/family-merges/preview', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['subject', 'body', 'familyId'], properties: {
      subject: { type: 'string', minLength: 1, maxLength: 300 }, body: { type: 'string', minLength: 1, maxLength: 20000 }, familyId: uuid, contactId: uuid } } },
  }, async (req) => {
    const identity = await begin(req);
    const b = req.body as { subject: string; body: string; familyId: string; contactId?: string };
    return run(identity.ctx, async (tx) => {
      const plan = await planFamily(tx, identity.ctx, b.familyId, new Set());
      if (!plan) throw notFound('Family not found');
      const to = b.contactId ? plan.recipients.find((r) => r.contactId === b.contactId) : plan.recipients[0];
      if (!to) return { family: plan, to: null, subject: '', html: '', facts: [], empty: [] };
      const v = await familyVarsFor(tx, b.familyId, to.contactId, to.email, identity.user as Me, `${b.subject} ${b.body}`);
      const body = renderBody(b.body, v.vars, `<a href="#">${identity.user.locale === 'fr-CA' ? 'Se désabonner' : 'Unsubscribe'}</a>`);
      return { family: plan, to, subject: renderSubject(b.subject, v.vars), html: body.html, facts: v.facts, empty: [...new Set(body.empty)] };
    });
  });

  app.post('/v1/family-merges', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['name', 'subject', 'body', 'familyIds'], properties: {
      name: { type: 'string', minLength: 1, maxLength: 120 }, subject: { type: 'string', minLength: 1, maxLength: 300 }, body: { type: 'string', minLength: 1, maxLength: 20000 }, familyIds } } },
  }, async (req, reply) => {
    const identity = await begin(req);
    const { ctx } = identity;
    const b = req.body as { name: string; subject: string; body: string; familyIds: string[] };
    checkFamilyTemplate(b.subject, b.body);
    const out = await run(ctx, async (tx) => {
      const id = randomUUID();
      await tx.query(`INSERT INTO mail_merges (id, tenant_id, user_id, name, subject, body, locale, audience) VALUES ($1,$2,$3,$4,$5,$6,$7,'families')`,
        [id, ctx.tenantId, ctx.userId, b.name.trim(), b.subject.trim(), b.body, identity.user.locale]);
      const seen = new Set<string>();
      const skipped: Record<string, number> = { notFound: 0, notYours: 0 };
      let n = 0;
      for (const fid of b.familyIds) {
        const p = await planFamily(tx, ctx, fid, seen);
        if (!p) { skipped.notFound!++; continue; }
        // Only the partner who serves a family (or a tenant admin) emails it; managers above can see but not send.
        if (!p.canSend) { skipped.notYours!++; continue; }
        for (const s of p.skipped) skipped[s.reason] = (skipped[s.reason] ?? 0) + 1;
        for (const r of p.recipients) {
          await tx.query(`INSERT INTO mail_merge_recipients (id, tenant_id, merge_id, user_id, owner_node_id, contact_id, email, family_id)
                          VALUES ($1,$2,$3,$4,$5,$6,lower($7),$8) ON CONFLICT (merge_id, email) DO NOTHING`,
            [randomUUID(), ctx.tenantId, id, ctx.userId, p.ownerNodeId, r.contactId, r.email, fid]);
          n++;
        }
      }
      if (n === 0) throw invalid('Nobody in these families can receive this email. Check the list for the reasons.');
      await audit(tx, ctx, 'family_merge_created', 'mail_merge', id, { families: b.familyIds.length, recipients: n, skipped });
      return { id, recipients: n, skipped };
    });
    return reply.code(201).send(out);
  });

  // ---------------------------------------------------------------- import
  app.post('/v1/families/import', {
    bodyLimit: 2 * 1024 * 1024,
    schema: { body: { type: 'object', additionalProperties: false, required: ['csv', 'dryRun'], properties: {
      csv: { type: 'string', minLength: 1, maxLength: 1_500_000 }, fileName: { type: 'string', maxLength: 200 }, dryRun: { type: 'boolean' },
      ownerNodeId: uuid, contextNodeId: uuid } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const b = req.body as { csv: string; fileName?: string; dryRun: boolean; ownerNodeId?: string; contextNodeId?: string };
    let cells: string[][];
    try { cells = parseCsv(b.csv); } catch (e) { throw invalid(`The file could not be read: ${(e as Error).message}`); }
    if (cells.length < 2) throw invalid('The file needs a header row and at least one row of people');
    if (cells.length - 1 > 2000) throw invalid('At most 2,000 rows per import');
    const head = mapHeader(cells[0]!);
    if (head.missing.length) throw invalid(`Missing columns: ${head.missing.join('; ')}`);
    const rows: ImportRow[] = cells.slice(1).map((r, i) => {
      const o: ImportRow = { line: i + 2 };
      head.columns.forEach((c, j) => { if (c && r[j] != null && r[j]!.trim() !== '') o[c] = r[j]!.trim(); });
      return o;
    });
    const today = new Date().toISOString().slice(0, 10);
    const report = await run(ctx, async (tx) => {
      const o = await resolveOwnerAndContext(tx, ctx, { ownerNodeId: b.ownerNodeId, contextNodeId: b.contextNodeId ?? null });
      type Out = { line: number; family: string; role: string | null; person: string; action: 'create_client' | 'link_client' | null; contactId: string | null; errors: string[]; notes: string[] };
      const out: Out[] = [];
      const people = new Map<string, number>(); // contact id or email or name → first line
      for (const r of rows) {
        const c = checkRow(r, today);
        const res: Out = { line: r.line, family: r.family_id ?? r.family ?? '', role: c.role, person: r.full_name ?? r.email ?? r.client_id ?? '', action: null, contactId: null, errors: c.errors, notes: [] };
        out.push(res);
        if (c.errors.length) continue;
        // Who: an exact client id, then an exact email for this partner. A same-name client is never assumed to be the same person.
        if (r.client_id) {
          const x = (await tx.query<{ owner_node_id: string; full_name: string | null }>('SELECT owner_node_id, full_name FROM contacts WHERE id = $1', [r.client_id])).rows[0];
          if (!x) { res.errors.push('client_id was not found among the clients you can see'); continue; }
          if (x.owner_node_id !== o.ownerNodeId) { res.errors.push('That client belongs to a different partner than this import'); continue; }
          res.action = 'link_client'; res.contactId = r.client_id; res.person = x.full_name ?? res.person;
        } else {
          const byEmail = r.email ? (await tx.query<{ id: string; full_name: string | null }>('SELECT id, full_name FROM contacts WHERE owner_node_id = $1 AND lower(email::text) = lower($2)', [o.ownerNodeId, r.email])).rows[0] : undefined;
          if (byEmail) { res.action = 'link_client'; res.contactId = byEmail.id; if (r.full_name && byEmail.full_name && byEmail.full_name.toLowerCase() !== r.full_name.toLowerCase()) res.notes.push(`Linked by email to "${byEmail.full_name}"; the name in the file is not used`); }
          else {
            const sameName = r.full_name ? (await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM contacts WHERE owner_node_id = $1 AND lower(full_name) = lower($2)', [o.ownerNodeId, r.full_name])).rows[0]!.n : 0;
            if (sameName && (r.same_name_ok ?? '').toLowerCase() !== 'yes') { res.errors.push(`A client named "${r.full_name}" already exists. Add their client_id or email to link them, or same_name_ok=yes if this is a different person`); continue; }
            res.action = 'create_client';
          }
        }
        if (res.action === 'link_client') {
          if (r.phone || r.date_of_birth || r.preferred_language) res.notes.push('Existing client: their phone, date of birth and language on file are kept, not replaced');
          const fam = (await tx.query<{ family_id: string; display_name: string }>(
            `SELECT m.family_id, f.display_name FROM family_memberships m JOIN families f ON f.id = m.family_id WHERE m.contact_id = $1 AND m.ended_at IS NULL`, [res.contactId])).rows[0];
          if (fam && fam.family_id !== r.family_id) res.errors.push(`Already in ${fam.display_name}. Move them in the app instead`);
          else if (fam) res.errors.push('Already a member of that family');
        }
        const key = res.contactId ?? (r.email ? `e:${r.email.toLowerCase()}` : `n:${(r.full_name ?? '').toLowerCase()}:${r.line}`);
        if (people.has(key)) res.errors.push(`The same person is also on line ${people.get(key)}`);
        else people.set(key, r.line);
      }
      // Families: new ones need exactly one Head; existing ones must be yours, active, and keep a single Head.
      type Fam = { key: string; existingId: string | null; name: string; lines: number[]; heads: number; error: string | null; version?: number };
      const fams = new Map<string, Fam>();
      for (const [i, r] of rows.entries()) {
        const k = r.family_id ? `id:${r.family_id.toLowerCase()}` : `name:${(r.family ?? '').toLowerCase()}`;
        if (!r.family_id && !r.family) continue;
        const f = fams.get(k) ?? { key: k, existingId: r.family_id ?? null, name: r.family ?? '', lines: [], heads: 0, error: null };
        f.lines.push(r.line);
        if (out[i]!.role === 'head') f.heads++;
        fams.set(k, f);
      }
      for (const f of fams.values()) {
        if (f.existingId) {
          const x = (await tx.query<{ owner_node_id: string; status: string; display_name: string; version: number; has_head: boolean }>(
            `SELECT owner_node_id, status, display_name, version, EXISTS (SELECT 1 FROM family_memberships m WHERE m.family_id = f.id AND m.role = 'head' AND m.ended_at IS NULL) AS has_head
               FROM families f WHERE id = $1`, [f.existingId])).rows[0];
          if (!x) f.error = 'That family_id was not found among the families you can see';
          else if (x.owner_node_id !== o.ownerNodeId) f.error = 'That family belongs to a different partner than this import';
          else if (!canEditRecord(ctx, x.owner_node_id)) f.error = 'Only the partner who serves that family can add to it';
          else if (x.status !== 'active') f.error = 'That family is archived';
          else if (x.has_head && f.heads > 0) f.error = 'That family already has a Head; import the person with another role and use Change Head';
          else if (f.heads > 1) f.error = 'Only one Head per family';
          if (x) { f.name = x.display_name; f.version = x.version; }
        } else if (f.heads !== 1) f.error = `A new family needs exactly one Head (found ${f.heads})`;
        else if (f.name.length > 120) f.error = 'The family name is longer than 120 characters';
        if (f.error) for (const line of f.lines) out.find((x) => x.line === line)!.errors.push(f.error);
      }
      const errors = out.reduce((n, x) => n + x.errors.length, 0);
      const summary = {
        rows: out.length, rowsWithErrors: out.filter((x) => x.errors.length).length, errors,
        clientsToCreate: out.filter((x) => x.action === 'create_client').length, clientsToLink: out.filter((x) => x.action === 'link_client').length,
        familiesToCreate: [...fams.values()].filter((f) => !f.existingId).length, familiesToJoin: [...fams.values()].filter((f) => f.existingId).length,
      };
      const families = [...fams.values()].map((f) => ({ name: f.name, existing: !!f.existingId, members: f.lines.length, error: f.error }));
      if (b.dryRun || errors) return { dryRun: b.dryRun, committed: false, summary, rows: out, families, unknownColumns: head.unknown };

      // Write everything in this one transaction: clients, families, members, then the log.
      for (const [i, r] of rows.entries()) {
        const x = out[i]!;
        if (x.action !== 'create_client') continue;
        x.contactId = randomUUID();
        await tx.query(
          `INSERT INTO contacts (id, tenant_id, owner_node_id, context_node_id, email, full_name, phone, date_of_birth, preferred_language, custom)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'{}')`,
          [x.contactId, ctx.tenantId, o.ownerNodeId, o.contextNodeId, r.email ?? null, r.full_name ?? null, r.phone ?? null, r.date_of_birth ?? null, r.preferred_language ?? null]);
        await audit(tx, ctx, 'contact_created', 'contact', x.contactId, { source: 'family_import' });
      }
      for (const f of fams.values()) {
        let fid = f.existingId;
        const members = f.lines.map((line) => out.find((x) => x.line === line)!);
        if (!fid) {
          fid = randomUUID();
          const head = members.find((m) => m.role === 'head')!;
          await tx.query(
            `INSERT INTO families (id, tenant_id, owner_node_id, context_node_id, display_name, created_by)
             VALUES ($1, $2, $3, (SELECT context_node_id FROM contacts WHERE id = $6), $4, $5)`, [fid, ctx.tenantId, o.ownerNodeId, f.name, ctx.userId, head.contactId]);
          await audit(tx, ctx, 'family_created', 'family', fid, { source: 'family_import', members: members.length }, o.ownerNodeId);
        } else {
          const v = await tx.query('UPDATE families SET version = version + 1, updated_at = now() WHERE id = $1 AND version = $2', [fid, f.version]);
          if (!v.rowCount) throw invalid(`${f.name} was changed while importing. Run the import again.`);
        }
        for (const m of members) {
          await tx.query('INSERT INTO family_memberships (tenant_id, family_id, contact_id, role, created_by) VALUES ($1,$2,$3,$4,$5)', [ctx.tenantId, fid, m.contactId, m.role, ctx.userId]);
        }
        if (f.existingId) await audit(tx, ctx, 'family_members_imported', 'family', fid, { members: members.length }, o.ownerNodeId);
      }
      const importId = randomUUID();
      await tx.query(
        `INSERT INTO family_imports (id, tenant_id, owner_node_id, context_node_id, user_id, file_name, file_sha256, rows_total, clients_created, clients_linked, families_created, families_joined)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [importId, ctx.tenantId, o.ownerNodeId, o.contextNodeId, ctx.userId, b.fileName?.slice(0, 200) ?? null, createHash('sha256').update(b.csv).digest('hex'),
          summary.rows, summary.clientsToCreate, summary.clientsToLink, summary.familiesToCreate, summary.familiesToJoin]);
      await audit(tx, ctx, 'family_import_committed', 'family_import', importId, summary, o.ownerNodeId);
      return { dryRun: false, committed: true, importId, summary, rows: out, families, unknownColumns: head.unknown };
    });
    return reply.code(report.committed ? 201 : report.summary.errors && !b.dryRun ? 422 : 200).send(report);
  });

  // ---------------------------------------------------------------- timeline
  app.get('/v1/families/:id/timeline', { schema: { params: idParams, querystring: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 500 } } } } }, async (req) => {
    const { ctx } = await begin(req);
    const { id } = req.params as { id: string };
    const { limit = 200 } = req.query as { limit?: number };
    return run(ctx, async (tx) => {
      const f = (await tx.query<{ created_at: string; archived_at: string | null; display_name: string }>('SELECT created_at, archived_at, display_name FROM families WHERE id = $1', [id])).rows[0];
      if (!f) throw notFound('Family not found');
      // Everyone who has ever been in the family and whom the caller can see.
      const ids = (await tx.query<{ id: string }>('SELECT DISTINCT m.contact_id AS id FROM family_memberships m JOIN contacts c ON c.id = m.contact_id WHERE m.family_id = $1', [id])).rows.map((r) => r.id);
      type Ev = { at: string; kind: string; contactId: string | null; name: string | null; detail: Record<string, unknown> };
      const ev: Ev[] = [{ at: f.created_at, kind: 'family_created', contactId: null, name: null, detail: {} }];
      if (f.archived_at) ev.push({ at: f.archived_at, kind: 'family_archived', contactId: null, name: null, detail: {} });
      const q = async (sql: string, args: unknown[] = []) => (await tx.query<Ev>(sql, args)).rows;
      ev.push(...await q(`SELECT m.started_at AS at, 'member_joined' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('role', m.role) AS detail
                            FROM family_memberships m JOIN contacts c ON c.id = m.contact_id WHERE m.family_id = $1`, [id]));
      ev.push(...await q(`SELECT m.ended_at AS at, 'member_left' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('role', m.role, 'reason', m.end_reason) AS detail
                            FROM family_memberships m JOIN contacts c ON c.id = m.contact_id WHERE m.family_id = $1 AND m.ended_at IS NOT NULL`, [id]));
      if (ids.length && familyInsuranceEnabled()) {
        ev.push(...await q(`SELECT pp.started_at AS at, 'policy_role_added' AS kind, c.id AS "contactId", c.full_name AS name,
                                   json_build_object('role', pp.role, 'policy', concat_ws(' · ', cd.display_name, p.plan_name)) AS detail
                              FROM policy_parties pp JOIN contacts c ON c.id = pp.contact_id JOIN policy_records p ON p.id = pp.policy_id JOIN carrier_directory cd ON cd.id = p.carrier_id
                             WHERE pp.contact_id = ANY($1::uuid[])`, [ids]));
        ev.push(...await q(`SELECT pp.ended_at AS at, 'policy_role_ended' AS kind, c.id AS "contactId", c.full_name AS name,
                                   json_build_object('role', pp.role, 'policy', concat_ws(' · ', cd.display_name, p.plan_name)) AS detail
                              FROM policy_parties pp JOIN contacts c ON c.id = pp.contact_id JOIN policy_records p ON p.id = pp.policy_id JOIN carrier_directory cd ON cd.id = p.carrier_id
                             WHERE pp.contact_id = ANY($1::uuid[]) AND pp.ended_at IS NOT NULL`, [ids]));
        ev.push(...await q(`SELECT a.assessed_at AS at, 'coverage_assessed' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('line', l.key, 'state', a.state) AS detail
                              FROM coverage_assessments a JOIN contacts c ON c.id = a.contact_id JOIN coverage_lines l ON l.id = a.line_id WHERE a.contact_id = ANY($1::uuid[])`, [ids]));
      }
      if (ids.length && familyComplianceEnabled()) {
        ev.push(...await q(`SELECT e.created_at AS at, 'life_event' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('event', e.kind, 'on', e.occurred_on) AS detail
                              FROM life_events e JOIN contacts c ON c.id = e.contact_id WHERE e.contact_id = ANY($1::uuid[])`, [ids]));
        ev.push(...await q(`SELECT pc.created_at AS at, 'consent_given' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('purpose', pc.purpose, 'givenBy', pc.given_by) AS detail
                              FROM person_consents pc JOIN contacts c ON c.id = pc.contact_id WHERE pc.contact_id = ANY($1::uuid[])`, [ids]));
        ev.push(...await q(`SELECT pc.withdrawn_at AS at, 'consent_withdrawn' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('purpose', pc.purpose) AS detail
                              FROM person_consents pc JOIN contacts c ON c.id = pc.contact_id WHERE pc.contact_id = ANY($1::uuid[]) AND pc.withdrawn_at IS NOT NULL`, [ids]));
        ev.push(...await q(`SELECT a.recorded_at AS at, 'authority_recorded' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('authority', a.kind) AS detail
                              FROM legal_authorities a JOIN contacts c ON c.id = a.subject_contact_id WHERE a.subject_contact_id = ANY($1::uuid[])`, [ids]));
        ev.push(...await q(`SELECT a.decided_at AS at, 'authority_' || a.status AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('authority', a.kind) AS detail
                              FROM legal_authorities a JOIN contacts c ON c.id = a.subject_contact_id WHERE a.subject_contact_id = ANY($1::uuid[]) AND a.decided_at IS NOT NULL`, [ids]));
        ev.push(...await q(`SELECT a.ended_at AS at, 'authority_ended' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('authority', a.kind, 'reason', a.end_reason) AS detail
                              FROM legal_authorities a JOIN contacts c ON c.id = a.subject_contact_id WHERE a.subject_contact_id = ANY($1::uuid[]) AND a.ended_at IS NOT NULL`, [ids]));
      }
      // Family emails: the sender's own send log (other people's merges are private to them).
      ev.push(...await q(`SELECT r.sent_at AS at, 'family_email_sent' AS kind, c.id AS "contactId", c.full_name AS name, json_build_object('subject', r.subject, 'facts', r.facts) AS detail
                            FROM mail_merge_recipients r LEFT JOIN contacts c ON c.id = r.contact_id WHERE r.family_id = $1 AND r.status = 'sent'`, [id]));
      ev.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
      return { events: ev.slice(0, limit), total: ev.length };
    });
  });

  // ---------------------------------------------------------------- Gmail side panel
  app.get('/v1/families/strip', {
    schema: { querystring: { type: 'object', additionalProperties: false, required: ['emails'], properties: { emails: { type: 'string', minLength: 3, maxLength: 4000 } } } },
  }, async (req) => {
    const { ctx } = await begin(req);
    const emails = [...new Set((req.query as { emails: string }).emails.split(',').map((e) => e.trim().toLowerCase()).filter((e) => e.includes('@')))].slice(0, 20);
    return run(ctx, async (tx) => {
      const people = (await tx.query<{ id: string; email: string; name: string | null; owner_node_id: string; family_id: string | null }>(
        `SELECT DISTINCT ON (lower(c.email::text)) c.id, lower(c.email::text) AS email, c.full_name AS name, c.owner_node_id,
                (SELECT m.family_id FROM family_memberships m WHERE m.contact_id = c.id AND m.ended_at IS NULL) AS family_id
           FROM contacts c WHERE lower(c.email::text) = ANY($1::text[]) ORDER BY lower(c.email::text), c.created_at`, [emails])).rows;
      const familyIds = [...new Set(people.map((p) => p.family_id).filter((x): x is string => !!x))];
      const families = [];
      for (const fid of familyIds) {
        const f = (await tx.query<{ id: string; name: string; version: number; owner: string }>('SELECT id, display_name AS name, version, owner_node_id AS owner FROM families WHERE id = $1', [fid])).rows[0];
        if (!f) continue;
        const members = (await tx.query<{ contactId: string; name: string | null; role: string }>(
          `SELECT c.id AS "contactId", c.full_name AS name, m.role FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
            WHERE m.family_id = $1 AND m.ended_at IS NULL ORDER BY m.role = 'head' DESC, c.full_name`, [fid])).rows;
        families.push({ id: f.id, name: f.name, version: f.version, canEdit: canEditRecord(ctx, f.owner), members });
      }
      // Suggestions, private to the caller and never stored: a client in this conversation who is in no family, for a
      // family of the same partner in this conversation (or with their surname), that the caller can change.
      const dismissed = new Set((await tx.query<{ k: string }>(`SELECT contact_id || ':' || family_id AS k FROM family_suggestion_dismissals`)).rows.map((r) => r.k));
      const suggestions = [];
      for (const p of people.filter((x) => !x.family_id)) {
        const sn = surnameOf(p.name);
        for (const f of families) {
          if (!f.canEdit || (await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM families WHERE id = $1', [f.id])).rows[0]?.owner_node_id !== p.owner_node_id) continue;
          if (dismissed.has(`${p.id}:${f.id}`)) continue;
          const reasons = ['same_conversation'];
          if (sn && f.members.some((m) => surnameOf(m.name) === sn)) reasons.push('same_last_name');
          suggestions.push({ contactId: p.id, name: p.name, familyId: f.id, familyName: f.name, familyVersion: f.version, reasons });
        }
      }
      return {
        people: people.map((p) => ({ email: p.email, contactId: p.id, name: p.name, familyId: p.family_id })),
        families, suggestions,
      };
    });
  });
  app.post('/v1/families/suggestions/dismiss', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['contactId', 'familyId'], properties: { contactId: uuid, familyId: uuid } } },
  }, async (req, reply) => {
    const { ctx } = await begin(req);
    const b = req.body as { contactId: string; familyId: string };
    await run(ctx, async (tx) => {
      if (!(await tx.query('SELECT 1 FROM contacts WHERE id = $1', [b.contactId])).rowCount || !(await tx.query('SELECT 1 FROM families WHERE id = $1', [b.familyId])).rowCount) throw notFound('Not found');
      await tx.query('INSERT INTO family_suggestion_dismissals (tenant_id, user_id, contact_id, family_id) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [ctx.tenantId, ctx.userId, b.contactId, b.familyId]);
    });
    return reply.code(204).send();
  });

  // ---------------------------------------------------------------- imports list (for the import screen)
  app.get('/v1/families/imports', async (req) => {
    const { ctx } = await begin(req);
    if (!ctx.canUseCrm) throw forbidden();
    return run(ctx, async (tx) => ({
      imports: (await tx.query(`SELECT i.id, i.file_name AS "fileName", i.rows_total AS rows, i.clients_created AS "clientsCreated", i.clients_linked AS "clientsLinked",
                                       i.families_created AS "familiesCreated", i.families_joined AS "familiesJoined", i.created_at AS "createdAt", coalesce(u.display_name, u.email::text) AS "by"
                                  FROM family_imports i LEFT JOIN app_users u ON u.id = i.user_id ORDER BY i.created_at DESC LIMIT 50`)).rows,
    }));
  });
}
