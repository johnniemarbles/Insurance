// Families (Gate A). A family groups separate client records for servicing, letters and totals; it never owns a
// member's personal data and the Head is only the person family letters go to (no authority over anyone).
//
// Switch: FAMILIES_ENABLED=1 on a country server turns this on. Off (the default), every route answers 404 and
// no screen shows family features. The tables exist either way and are empty until someone builds a family.
//
// Privacy: everything runs inside the request's row-level security. A family is visible on the same terms as its
// Head's client record (owner partner, its managers above, that record's location, tenant admin; never a sibling partner), and member and relationship rows
// only when every client in them is visible. Only the owning partner (or a tenant admin) may change a family.
//
// Concurrency: every change to a family or its members carries the family's `version`. The version bump is the
// first statement of each change and locks the family row, so two people changing one family at once cannot
// both win: the second gets 409. The database also holds one active family per person and one Head per family.
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { RequestContext } from '@pii/domain';
import { withRequestTx, type Tx } from '@pii/db';
import { audit } from './audit.ts';
import { conflict, invalid, notFound } from './errors.ts';
import { page, pageQuery, requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

export const familiesEnabled = (): boolean => ['1', 'true'].includes(String(process.env.FAMILIES_ENABLED ?? '').toLowerCase());

export const MEMBER_ROLES = ['head', 'spouse_partner', 'child', 'dependent', 'other'] as const;
type MemberRole = (typeof MEMBER_ROLES)[number];
const NON_HEAD_ROLES = MEMBER_ROLES.filter((r) => r !== 'head');
const END_REASONS = ['left', 'separated', 'deceased', 'entered_in_error'] as const;
/** Kinds people choose; stored as the five kinds in the table, symmetric ones lower id first. */
const RELATION_INPUT = ['spouse_partner', 'sibling', 'parent_of', 'child_of', 'grandparent_of', 'grandchild_of', 'other'] as const;
type RelationInput = (typeof RELATION_INPUT)[number];

const idParams = { type: 'object', required: ['id'], properties: { id: uuid } } as const;
const version = { type: 'integer', minimum: 1 } as const;
const shortText = (max: number) => ({ type: ['string', 'null'], maxLength: max }) as const;
const dateText = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' } as const;
const ROLE_ORDER = `CASE m.role WHEN 'head' THEN 0 WHEN 'spouse_partner' THEN 1 WHEN 'child' THEN 2 WHEN 'dependent' THEN 3 ELSE 4 END`;

/** Whole years between a YYYY-MM-DD date of birth and today (UTC). */
export function ageOn(dob: string | null, today = new Date()): number | null {
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  if (today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d)) age -= 1;
  return age >= 0 ? age : null;
}
const isRealDate = (s: string): boolean => {
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Normalises a chosen relationship to the stored form: who is a, who is b, which kind. */
export function normaliseRelationship(self: string, other: string, kind: RelationInput): { a: string; b: string; kind: string } {
  switch (kind) {
    case 'parent_of': return { a: self, b: other, kind: 'parent_of' };
    case 'child_of': return { a: other, b: self, kind: 'parent_of' };
    case 'grandparent_of': return { a: self, b: other, kind: 'grandparent_of' };
    case 'grandchild_of': return { a: other, b: self, kind: 'grandparent_of' };
    default: return self < other ? { a: self, b: other, kind } : { a: other, b: self, kind };
  }
}

export function registerFamilyRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  /** Switched off: the routes do not exist as far as anyone can tell. */
  const gate = () => { if (!familiesEnabled()) throw notFound(); };
  const begin = async (req: Parameters<AppDeps['authenticate']>[0]) => {
    gate();
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    return ctx;
  };

  async function familyOwner(tx: Tx, id: string): Promise<{ owner: string; status: string }> {
    const r = await tx.query<{ owner_node_id: string; status: string }>('SELECT owner_node_id, status FROM families WHERE id = $1', [id]);
    if (!r.rows[0]) throw notFound('Family not found');
    return { owner: r.rows[0].owner_node_id, status: r.rows[0].status };
  }
  async function contactOwner(tx: Tx, id: string): Promise<string> {
    const r = await tx.query<{ owner_node_id: string }>('SELECT owner_node_id FROM contacts WHERE id = $1', [id]);
    if (!r.rows[0]) throw notFound('Client not found');
    return r.rows[0].owner_node_id;
  }
  /** Check the caller may change this family, then take its row lock by bumping the version they last saw. */
  async function lockFamily(tx: Tx, ctx: RequestContext, id: string, expected: number): Promise<{ owner: string; version: number }> {
    const f = await familyOwner(tx, id);
    requireEdit(ctx, f.owner);
    if (f.status !== 'active') throw invalid('That family is archived');
    const r = await tx.query<{ version: number }>(
      'UPDATE families SET version = version + 1, updated_at = now() WHERE id = $1 AND version = $2 RETURNING version',
      [id, expected],
    );
    if (!r.rows[0]) throw conflict('This family was changed by someone else. Reload it and try again.');
    return { owner: f.owner, version: r.rows[0].version };
  }
  async function activeMembership(tx: Tx, contactId: string): Promise<{ id: string; family_id: string; role: MemberRole } | null> {
    const r = await tx.query<{ id: string; family_id: string; role: MemberRole }>(
      'SELECT id, family_id, role FROM family_memberships WHERE contact_id = $1 AND ended_at IS NULL', [contactId]);
    return r.rows[0] ?? null;
  }
  async function header(tx: Tx, id: string) {
    const f = (await tx.query(
      `SELECT f.id, f.display_name AS "displayName", f.salutation, f.mailing_address AS "mailingAddress",
              f.mailing_preference AS "mailingPreference", f.status, f.version, f.owner_node_id AS "ownerNodeId",
              f.context_node_id AS "contextNodeId", f.created_at AS "createdAt", f.updated_at AS "updatedAt", f.archived_at AS "archivedAt"
         FROM families f WHERE f.id = $1`, [id])).rows[0];
    if (!f) throw notFound('Family not found');
    const s = (await tx.query<{ members: number; adults: number; head_id: string | null; head_name: string | null }>(
      `SELECT count(*)::int AS members,
              count(*) FILTER (WHERE m.role IN ('head', 'spouse_partner'))::int AS adults,
              max(c.id::text) FILTER (WHERE m.role = 'head') AS head_id,
              max(c.full_name) FILTER (WHERE m.role = 'head') AS head_name
         FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
        WHERE m.family_id = $1 AND m.ended_at IS NULL`, [id])).rows[0]!;
    return {
      ...f,
      memberCount: s.members,
      head: s.head_id ? { contactId: s.head_id, fullName: s.head_name } : null,
      // A family may briefly have no Head (the Head left or died): flagged for the partner, never blocking.
      needsHead: f.status === 'active' && !s.head_id && s.members > 0,
    };
  }
  const memberRows = async (tx: Tx, familyId: string, history: boolean) => (await tx.query<{ dateOfBirth: string | null }>(
    `SELECT m.id, m.contact_id AS "contactId", c.full_name AS "fullName", c.email, c.phone, m.role,
            m.started_at AS "startedAt", m.ended_at AS "endedAt", m.end_reason AS "endReason",
            c.date_of_birth::text AS "dateOfBirth", c.deceased_on::text AS "deceasedOn", c.preferred_language AS "preferredLanguage"
       FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
      WHERE m.family_id = $1 AND ($2 OR m.ended_at IS NULL)
      ORDER BY (m.ended_at IS NOT NULL), ${ROLE_ORDER}, c.full_name, m.started_at`, [familyId, history])).rows
    .map((r) => ({ ...r, age: ageOn(r.dateOfBirth) }));

  // ---- families ----
  app.get('/v1/families', { schema: { querystring: { type: 'object', additionalProperties: false, properties: { q: { type: 'string', maxLength: 100 }, includeArchived: { type: 'boolean' }, ...pageQuery } } } }, async (req) => {
    const ctx = await begin(req);
    const q = req.query as { q?: string; includeArchived?: boolean; limit?: number; offset?: number };
    const { limit, offset } = page(q);
    return run(ctx, async (tx) => ({
      families: (await tx.query(
        `SELECT f.id, f.display_name AS "displayName", f.status, f.version, f.owner_node_id AS "ownerNodeId",
                (SELECT count(*)::int FROM family_memberships m WHERE m.family_id = f.id AND m.ended_at IS NULL) AS "memberCount",
                (SELECT c.full_name FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
                  WHERE m.family_id = f.id AND m.role = 'head' AND m.ended_at IS NULL) AS "headName"
           FROM families f
          WHERE ($1::boolean OR f.status = 'active')
            AND ($2::text IS NULL OR f.display_name ILIKE '%' || $2 || '%'
                 OR EXISTS (SELECT 1 FROM family_memberships m JOIN contacts c ON c.id = m.contact_id
                             WHERE m.family_id = f.id AND m.ended_at IS NULL AND c.full_name ILIKE '%' || $2 || '%'))
          ORDER BY f.display_name, f.id LIMIT $3 OFFSET $4`,
        [q.includeArchived ?? false, q.q ?? null, limit, offset])).rows,
      limit, offset,
    }));
  });

  app.post('/v1/families', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['displayName', 'members'],
        properties: {
          displayName: { type: 'string', minLength: 1, maxLength: 120 }, salutation: shortText(200), mailingAddress: shortText(500),
          mailingPreference: { type: 'string', enum: ['head', 'each_adult'] },
          members: { type: 'array', minItems: 1, maxItems: 30, items: { type: 'object', additionalProperties: false, required: ['contactId', 'role'], properties: { contactId: uuid, role: { type: 'string', enum: [...MEMBER_ROLES] } } } },
        },
      },
    },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const b = req.body as { displayName: string; salutation?: string | null; mailingAddress?: string | null; mailingPreference?: 'head' | 'each_adult'; members: { contactId: string; role: MemberRole }[] };
    if (!b.displayName.trim()) throw invalid('Give the family a name');
    if (new Set(b.members.map((m) => m.contactId)).size !== b.members.length) throw invalid('A person can be added only once');
    if (b.members.filter((m) => m.role === 'head').length !== 1) throw invalid('Choose exactly one Head');
    const out = await run(ctx, async (tx) => {
      const owners = new Set<string>();
      for (const m of b.members) owners.add(await contactOwner(tx, m.contactId));
      if (owners.size !== 1) throw invalid('Everyone in a family must belong to the same partner');
      const owner = [...owners][0]!;
      requireEdit(ctx, owner);
      for (const m of b.members) if (await activeMembership(tx, m.contactId)) throw conflict('Someone in this list is already in a family. Move them instead.');
      const id = randomUUID();
      const headId = b.members.find((m) => m.role === 'head')!.contactId;
      await tx.query(
        `INSERT INTO families (id, tenant_id, owner_node_id, context_node_id, display_name, salutation, mailing_address, mailing_preference, created_by)
         VALUES ($1, $2, $3, (SELECT context_node_id FROM contacts WHERE id = $9), $4, $5, $6, $7, $8)`,
        [id, ctx.tenantId, owner, b.displayName.trim(), b.salutation?.trim() || null, b.mailingAddress?.trim() || null, b.mailingPreference ?? 'head', ctx.userId, headId]);
      for (const m of b.members) {
        await tx.query('INSERT INTO family_memberships (tenant_id, family_id, contact_id, role, created_by) VALUES ($1, $2, $3, $4, $5)',
          [ctx.tenantId, id, m.contactId, m.role, ctx.userId]);
      }
      await audit(tx, ctx, 'family_created', 'family', id, { members: b.members }, owner);
      return header(tx, id);
    });
    return reply.code(201).send(out);
  });

  app.get('/v1/families/:id', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, (tx) => header(tx, id));
  });

  app.patch('/v1/families/:id', {
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['version'], minProperties: 2,
        properties: { version, displayName: { type: 'string', minLength: 1, maxLength: 120 }, salutation: shortText(200), mailingAddress: shortText(500), mailingPreference: { type: 'string', enum: ['head', 'each_adult'] } },
      },
    },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { version: number; displayName?: string; salutation?: string | null; mailingAddress?: string | null; mailingPreference?: string };
    if ('displayName' in b && !b.displayName!.trim()) throw invalid('Give the family a name');
    return run(ctx, async (tx) => {
      const { owner } = await lockFamily(tx, ctx, id, b.version);
      await tx.query(
        `UPDATE families SET display_name = coalesce($2, display_name),
                salutation = CASE WHEN $3 THEN $4 ELSE salutation END,
                mailing_address = CASE WHEN $5 THEN $6 ELSE mailing_address END,
                mailing_preference = coalesce($7, mailing_preference)
          WHERE id = $1`,
        [id, b.displayName?.trim() ?? null, 'salutation' in b, b.salutation?.trim() || null, 'mailingAddress' in b, b.mailingAddress?.trim() || null, b.mailingPreference ?? null]);
      await audit(tx, ctx, 'family_updated', 'family', id, { fields: Object.keys(b).filter((k) => k !== 'version') }, owner);
      return header(tx, id);
    });
  });

  // Archive: every current membership ends ("family_archived"); people, policies and records stay exactly as they were.
  app.post('/v1/families/:id/archive', { schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['version'], properties: { version } } } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { version: v } = req.body as { version: number };
    return run(ctx, async (tx) => {
      const { owner } = await lockFamily(tx, ctx, id, v);
      const ended = await tx.query(`UPDATE family_memberships SET ended_at = now(), end_reason = 'family_archived', ended_by = $2 WHERE family_id = $1 AND ended_at IS NULL`, [id, ctx.userId]);
      await tx.query(`UPDATE families SET status = 'archived', archived_at = now() WHERE id = $1`, [id]);
      await audit(tx, ctx, 'family_archived', 'family', id, { endedMemberships: ended.rowCount }, owner);
      return header(tx, id);
    });
  });

  // ---- members ----
  app.get('/v1/families/:id/members', { schema: { params: idParams, querystring: { type: 'object', additionalProperties: false, properties: { history: { type: 'boolean' } } } } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { history } = req.query as { history?: boolean };
    return run(ctx, async (tx) => {
      await familyOwner(tx, id);
      return { members: await memberRows(tx, id, history ?? false) };
    });
  });

  app.post('/v1/families/:id/members', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['version', 'contactId', 'role'], properties: { version, contactId: uuid, role: { type: 'string', enum: [...MEMBER_ROLES] } } } },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { version: number; contactId: string; role: MemberRole };
    const out = await run(ctx, async (tx) => {
      const { owner } = await lockFamily(tx, ctx, id, b.version);
      if ((await contactOwner(tx, b.contactId)) !== owner) throw invalid('A family member must belong to the same partner as the family');
      if (await activeMembership(tx, b.contactId)) throw conflict('That person is already in a family. Move them instead.');
      if (b.role === 'head') {
        const h = await tx.query(`SELECT 1 FROM family_memberships WHERE family_id = $1 AND role = 'head' AND ended_at IS NULL`, [id]);
        if (h.rowCount) throw conflict('This family already has a Head. Use Change Head.');
      }
      const mid = randomUUID();
      await tx.query('INSERT INTO family_memberships (id, tenant_id, family_id, contact_id, role, created_by) VALUES ($1, $2, $3, $4, $5, $6)',
        [mid, ctx.tenantId, id, b.contactId, b.role, ctx.userId]);
      await audit(tx, ctx, 'family_member_added', 'family', id, { membershipId: mid, contactId: b.contactId, role: b.role }, owner);
      return { family: await header(tx, id), members: await memberRows(tx, id, false) };
    });
    return reply.code(201).send(out);
  });

  const membershipParams = { type: 'object', required: ['id', 'membershipId'], properties: { id: uuid, membershipId: uuid } } as const;
  async function membershipIn(tx: Tx, familyId: string, membershipId: string) {
    const r = await tx.query<{ id: string; contact_id: string; role: MemberRole; ended_at: Date | null }>(
      'SELECT id, contact_id, role, ended_at FROM family_memberships WHERE id = $1 AND family_id = $2', [membershipId, familyId]);
    if (!r.rows[0]) throw notFound('Member not found');
    if (r.rows[0].ended_at) throw invalid('That membership has already ended');
    return r.rows[0];
  }

  // Role change for anyone but the Head (the Head changes only through change-head, so there is always exactly one way to do it).
  app.patch('/v1/families/:id/members/:membershipId', {
    schema: { params: membershipParams, body: { type: 'object', additionalProperties: false, required: ['version', 'role'], properties: { version, role: { type: 'string', enum: [...NON_HEAD_ROLES] } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id, membershipId } = req.params as { id: string; membershipId: string };
    const b = req.body as { version: number; role: MemberRole };
    return run(ctx, async (tx) => {
      const { owner } = await lockFamily(tx, ctx, id, b.version);
      const m = await membershipIn(tx, id, membershipId);
      if (m.role === 'head') throw invalid('To change the Head, choose a new Head first');
      await tx.query('UPDATE family_memberships SET role = $2 WHERE id = $1', [membershipId, b.role]);
      await audit(tx, ctx, 'family_member_role_changed', 'family', id, { membershipId, from: m.role, to: b.role }, owner);
      return { family: await header(tx, id), members: await memberRows(tx, id, false) };
    });
  });

  // End a membership (left, separated, deceased, entered in error). Kept in history; nothing about the person changes.
  app.post('/v1/families/:id/members/:membershipId/end', {
    schema: { params: membershipParams, body: { type: 'object', additionalProperties: false, required: ['version', 'reason'], properties: { version, reason: { type: 'string', enum: [...END_REASONS] } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id, membershipId } = req.params as { id: string; membershipId: string };
    const b = req.body as { version: number; reason: string };
    return run(ctx, async (tx) => {
      const { owner } = await lockFamily(tx, ctx, id, b.version);
      const m = await membershipIn(tx, id, membershipId);
      await tx.query('UPDATE family_memberships SET ended_at = now(), end_reason = $2, ended_by = $3 WHERE id = $1', [membershipId, b.reason, ctx.userId]);
      await audit(tx, ctx, 'family_member_ended', 'family', id, { membershipId, contactId: m.contact_id, role: m.role, reason: b.reason }, owner);
      return { family: await header(tx, id), members: await memberRows(tx, id, false) };
    });
  });

  // Change Head: one transaction, under the family lock. The old Head takes the role given; by default the two swap
// roles (a spouse made Head leaves the old Head as spouse), which is what nearly every change of Head means.
  app.post('/v1/families/:id/change-head', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['version', 'contactId'], properties: { version, contactId: uuid, formerHeadRole: { type: 'string', enum: [...NON_HEAD_ROLES] } } } },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { version: number; contactId: string; formerHeadRole?: MemberRole };
    return run(ctx, async (tx) => {
      const { owner } = await lockFamily(tx, ctx, id, b.version);
      const next = (await tx.query<{ id: string; role: MemberRole }>(
        'SELECT id, role FROM family_memberships WHERE family_id = $1 AND contact_id = $2 AND ended_at IS NULL', [id, b.contactId])).rows[0];
      if (!next) throw invalid('The new Head must be a current member of this family');
      if (next.role === 'head') throw invalid('That person is already the Head');
      const prev = (await tx.query<{ id: string; contact_id: string }>(
        `SELECT id, contact_id FROM family_memberships WHERE family_id = $1 AND role = 'head' AND ended_at IS NULL`, [id])).rows[0];
      const formerRole = b.formerHeadRole ?? next.role;
      if (prev) await tx.query('UPDATE family_memberships SET role = $2 WHERE id = $1', [prev.id, formerRole]);
      await tx.query(`UPDATE family_memberships SET role = 'head' WHERE id = $1`, [next.id]);
      // The family follows its Head's location, so location managers see it on the same terms as the Head's record.
      await tx.query('UPDATE families SET context_node_id = (SELECT context_node_id FROM contacts WHERE id = $2) WHERE id = $1', [id, b.contactId]);
      await audit(tx, ctx, 'family_head_changed', 'family', id, { from: prev?.contact_id ?? null, to: b.contactId, formerHeadRole: prev ? formerRole : null }, owner);
      return { family: await header(tx, id), members: await memberRows(tx, id, false) };
    });
  });

  // Move a person to another family of the same partner: ends one membership ("moved") and starts another, atomically.
  // Both families are locked in a fixed order so two moves the other way round cannot deadlock.
  app.post('/v1/families/:id/move-member', {
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['version', 'contactId', 'toFamilyId', 'toVersion', 'role'], properties: { version, contactId: uuid, toFamilyId: uuid, toVersion: version, role: { type: 'string', enum: [...NON_HEAD_ROLES] } } },
    },
  }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { version: number; contactId: string; toFamilyId: string; toVersion: number; role: MemberRole };
    if (b.toFamilyId === id) throw invalid('Choose a different family');
    return run(ctx, async (tx) => {
      const order = [[id, b.version], [b.toFamilyId, b.toVersion]].sort((x, y) => String(x[0]).localeCompare(String(y[0]))) as [string, number][];
      const owners: Record<string, string> = {};
      for (const [fid, v] of order) owners[fid] = (await lockFamily(tx, ctx, fid, v)).owner;
      if (owners[id] !== owners[b.toFamilyId]) throw invalid('Both families must belong to the same partner');
      const m = (await tx.query<{ id: string; role: MemberRole }>(
        'SELECT id, role FROM family_memberships WHERE family_id = $1 AND contact_id = $2 AND ended_at IS NULL', [id, b.contactId])).rows[0];
      if (!m) throw invalid('That person is not a current member of this family');
      await tx.query(`UPDATE family_memberships SET ended_at = now(), end_reason = 'moved', ended_by = $2 WHERE id = $1`, [m.id, ctx.userId]);
      await tx.query('INSERT INTO family_memberships (tenant_id, family_id, contact_id, role, created_by) VALUES ($1, $2, $3, $4, $5)',
        [ctx.tenantId, b.toFamilyId, b.contactId, b.role, ctx.userId]);
      await audit(tx, ctx, 'family_member_moved', 'family', id, { contactId: b.contactId, fromRole: m.role, toFamilyId: b.toFamilyId, toRole: b.role }, owners[id]!);
      return { from: await header(tx, id), to: await header(tx, b.toFamilyId) };
    });
  });

  // ---- a person's family, for the client record and the contacts list ----
  app.get('/v1/people/:id/family', { schema: { params: idParams } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      await contactOwner(tx, id);
      const p = (await tx.query(
        `SELECT c.id, c.full_name AS "fullName", c.date_of_birth::text AS "dateOfBirth", c.deceased_on::text AS "deceasedOn",
                c.preferred_language AS "preferredLanguage", c.owner_node_id AS "ownerNodeId" FROM contacts c WHERE c.id = $1`, [id])).rows[0] as { dateOfBirth: string | null };
      const m = await activeMembership(tx, id);
      const history = (await tx.query(
        `SELECT m.family_id AS "familyId", f.display_name AS "familyName", m.role, m.started_at AS "startedAt", m.ended_at AS "endedAt", m.end_reason AS "endReason"
           FROM family_memberships m JOIN families f ON f.id = m.family_id
          WHERE m.contact_id = $1 AND m.ended_at IS NOT NULL ORDER BY m.ended_at DESC LIMIT 20`, [id])).rows;
      // No family yet: the screen shows a family of one. Nothing is created until someone builds a family.
      if (!m) return { person: { ...p, age: ageOn(p.dateOfBirth) }, family: null, membership: null, members: [], history };
      return {
        person: { ...p, age: ageOn(p.dateOfBirth) },
        family: await header(tx, m.family_id),
        membership: { id: m.id, role: m.role },
        members: await memberRows(tx, m.family_id, false),
        history,
      };
    });
  });

  // Family of each listed client, for "Group by family". Only rows the caller may see come back.
  app.get('/v1/family-memberships', { schema: { querystring: { type: 'object', additionalProperties: false, required: ['contactIds'], properties: { contactIds: { type: 'string', maxLength: 200 * 37 } } } } }, async (req) => {
    const ctx = await begin(req);
    const ids = String((req.query as { contactIds: string }).contactIds).split(',').map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || ids.length > 200) throw invalid('Give between 1 and 200 client ids');
    if (ids.some((s) => !/^[0-9a-f-]{36}$/i.test(s))) throw invalid('Invalid client id');
    return run(ctx, async (tx) => ({
      memberships: (await tx.query(
        `SELECT m.contact_id AS "contactId", m.family_id AS "familyId", f.display_name AS "familyName", m.role
           FROM family_memberships m JOIN families f ON f.id = m.family_id
          WHERE m.contact_id = ANY ($1::uuid[]) AND m.ended_at IS NULL`, [ids])).rows,
    }));
  });

  // Optional person details used by families. Age only raises review tasks later (Gate C); it never decides capacity.
  app.patch('/v1/people/:id/profile', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, minProperties: 1, properties: { dateOfBirth: dateText, preferredLanguage: { type: ['string', 'null'], minLength: 2, maxLength: 20 }, deceasedOn: dateText } } },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { dateOfBirth?: string | null; preferredLanguage?: string | null; deceasedOn?: string | null };
    const today = new Date().toISOString().slice(0, 10);
    for (const k of ['dateOfBirth', 'deceasedOn'] as const) {
      const v = b[k];
      if (v && (!isRealDate(v) || v > today || v < '1900-01-01')) throw invalid(k === 'dateOfBirth' ? 'Enter a real date of birth, not in the future' : 'Enter a real date, not in the future');
    }
    await run(ctx, async (tx) => {
      const owner = await contactOwner(tx, id);
      requireEdit(ctx, owner);
      const cur = (await tx.query<{ dob: string | null; dod: string | null }>('SELECT date_of_birth::text AS dob, deceased_on::text AS dod FROM contacts WHERE id = $1', [id])).rows[0]!;
      const dob = 'dateOfBirth' in b ? b.dateOfBirth ?? null : cur.dob;
      const dod = 'deceasedOn' in b ? b.deceasedOn ?? null : cur.dod;
      if (dob && dod && dod < dob) throw invalid('The date of death cannot be before the date of birth');
      await tx.query(
        `UPDATE contacts SET date_of_birth = CASE WHEN $2 THEN $3::date ELSE date_of_birth END,
                preferred_language = CASE WHEN $4 THEN $5 ELSE preferred_language END,
                deceased_on = CASE WHEN $6 THEN $7::date ELSE deceased_on END WHERE id = $1`,
        [id, 'dateOfBirth' in b, b.dateOfBirth ?? null, 'preferredLanguage' in b, b.preferredLanguage?.trim() || null, 'deceasedOn' in b, b.deceasedOn ?? null]);
      // Field names only: the values are personal details and stay out of the audit log.
      await audit(tx, ctx, 'person_profile_updated', 'contact', id, { fields: Object.keys(b) }, owner);
    });
    return reply.code(204).send();
  });

  // ---- relationships (never a source of authority) ----
  app.get('/v1/people/:id/relationships', { schema: { params: idParams, querystring: { type: 'object', additionalProperties: false, properties: { history: { type: 'boolean' } } } } }, async (req) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const { history } = req.query as { history?: boolean };
    return run(ctx, async (tx) => {
      await contactOwner(tx, id);
      const rows = (await tx.query<{ id: string; a: string; b: string; kind: string; note: string | null; startedAt: string; endedAt: string | null; aName: string | null; bName: string | null }>(
        `SELECT r.id, r.person_a_id AS a, r.person_b_id AS b, r.kind, r.note, r.started_at AS "startedAt", r.ended_at AS "endedAt",
                ca.full_name AS "aName", cb.full_name AS "bName"
           FROM person_relationships r JOIN contacts ca ON ca.id = r.person_a_id JOIN contacts cb ON cb.id = r.person_b_id
          WHERE (r.person_a_id = $1 OR r.person_b_id = $1) AND ($2 OR r.ended_at IS NULL)
          ORDER BY (r.ended_at IS NOT NULL), r.started_at`, [id, history ?? false])).rows;
      // Described from this person's side: "parent of X" or "child of X".
      return {
        relationships: rows.map((r) => {
          const mine = r.a === id;
          const kind = r.kind === 'parent_of' ? (mine ? 'parent_of' : 'child_of') : r.kind === 'grandparent_of' ? (mine ? 'grandparent_of' : 'grandchild_of') : r.kind;
          return { id: r.id, otherContactId: mine ? r.b : r.a, otherName: mine ? r.bName : r.aName, kind, note: r.note, startedAt: r.startedAt, endedAt: r.endedAt };
        }),
      };
    });
  });

  app.post('/v1/people/:id/relationships', {
    schema: { params: idParams, body: { type: 'object', additionalProperties: false, required: ['otherContactId', 'kind'], properties: { otherContactId: uuid, kind: { type: 'string', enum: [...RELATION_INPUT] }, note: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (req, reply) => {
    const ctx = await begin(req);
    const { id } = req.params as { id: string };
    const b = req.body as { otherContactId: string; kind: RelationInput; note?: string };
    if (b.otherContactId === id) throw invalid('Choose another person');
    const out = await run(ctx, async (tx) => {
      const owner = await contactOwner(tx, id);
      requireEdit(ctx, owner);
      if ((await contactOwner(tx, b.otherContactId)) !== owner) throw invalid('Both people must belong to the same partner');
      const n = normaliseRelationship(id, b.otherContactId, b.kind);
      const rid = randomUUID();
      await tx.query('INSERT INTO person_relationships (id, tenant_id, person_a_id, person_b_id, kind, note, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7)',
        [rid, ctx.tenantId, n.a, n.b, n.kind, b.note?.trim() || null, ctx.userId]);
      await audit(tx, ctx, 'person_relationship_added', 'contact', id, { relationshipId: rid, otherContactId: b.otherContactId, kind: b.kind }, owner);
      return { id: rid };
    });
    return reply.code(201).send(out);
  });

  app.post('/v1/people/:id/relationships/:relationshipId/end', { schema: { params: { type: 'object', required: ['id', 'relationshipId'], properties: { id: uuid, relationshipId: uuid } } } }, async (req, reply) => {
    const ctx = await begin(req);
    const { id, relationshipId } = req.params as { id: string; relationshipId: string };
    await run(ctx, async (tx) => {
      const owner = await contactOwner(tx, id);
      requireEdit(ctx, owner);
      const r = await tx.query<{ ended_at: Date | null }>('SELECT ended_at FROM person_relationships WHERE id = $1 AND (person_a_id = $2 OR person_b_id = $2)', [relationshipId, id]);
      if (!r.rows[0]) throw notFound('Relationship not found');
      if (r.rows[0].ended_at) throw invalid('That relationship has already ended');
      await tx.query('UPDATE person_relationships SET ended_at = now(), ended_by = $2 WHERE id = $1', [relationshipId, ctx.userId]);
      await audit(tx, ctx, 'person_relationship_ended', 'contact', id, { relationshipId }, owner);
    });
    return reply.code(204).send();
  });
}
