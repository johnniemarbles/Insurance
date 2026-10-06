import type { FastifyInstance } from 'fastify';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

interface Dup { id: string; name: string; stage: string; valueAmount: number | null; ownerName: string | null; updatedAt: string; notes: number; tasks: number; threads: number }
const COLS = `b.id, b.name, s.name AS stage, b.value_amount AS "valueAmount", (SELECT coalesce(u.display_name, u.email::text) FROM app_users u WHERE u.id = b.owner_user_id) AS "ownerName", b.updated_at AS "updatedAt",
  (SELECT count(*)::int FROM notes n WHERE n.box_id = b.id) AS notes, (SELECT count(*)::int FROM tasks t WHERE t.box_id = b.id) AS tasks, (SELECT count(*)::int FROM box_threads x WHERE x.box_id = b.id) AS threads`;

export function registerDuplicateRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: Parameters<typeof withRequestTx>[1], fn: Parameters<typeof withRequestTx<T>>[2]) => withRequestTx(deps.appPool, ctx, fn);

  /** Records in one pipeline that look like the same thing: same name once case and spacing are ignored, or sharing a linked contact. */
  app.get('/v1/pipelines/:id/duplicates', { schema: { params: { type: 'object', properties: { id: uuid } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    return run(ctx, async (tx) => {
      const groups: { reason: 'name' | 'contact'; label: string; boxes: Dup[] }[] = [];
      const byName = (await tx.query<{ k: string; ids: string[] }>(
        `SELECT lower(regexp_replace(trim(b.name), '\\s+', ' ', 'g')) AS k, array_agg(b.id ORDER BY b.created_at) AS ids
           FROM boxes b WHERE b.pipeline_id = $1 GROUP BY 1 HAVING count(*) > 1 ORDER BY count(*) DESC, 1 LIMIT 40`, [id])).rows;
      const byContact = (await tx.query<{ k: string; ids: string[] }>(
        `SELECT coalesce(c.email::text, c.full_name) AS k, array_agg(DISTINCT bc.box_id) AS ids
           FROM box_contacts bc JOIN contacts c ON c.id = bc.contact_id JOIN boxes b ON b.id = bc.box_id
          WHERE b.pipeline_id = $1 GROUP BY c.id, c.email, c.full_name HAVING count(DISTINCT bc.box_id) > 1 ORDER BY count(DISTINCT bc.box_id) DESC LIMIT 40`, [id])).rows;
      const seen = new Set<string>();
      for (const [reason, list] of [['name', byName], ['contact', byContact]] as const) {
        for (const g of list) {
          const sig = [...g.ids].sort().join(',');
          if (seen.has(sig)) continue; // the same set found two ways
          seen.add(sig);
          const boxes = (await tx.query<Dup>(`SELECT ${COLS} FROM boxes b JOIN stages s ON s.id = b.stage_id WHERE b.id = ANY($1::uuid[]) ORDER BY b.created_at`, [g.ids])).rows;
          groups.push({ reason, label: g.k, boxes });
        }
      }
      return { groups };
    });
  });

  /** Fold other records into this one: their notes, tasks, emails, contacts and history move over, empty fields are filled in, and the others are removed. */
  app.post('/v1/boxes/:id/merge', { schema: { params: { type: 'object', properties: { id: uuid } }, body: { type: 'object', required: ['ids'], additionalProperties: false, properties: { ids: { type: 'array', minItems: 1, maxItems: 10, items: uuid } } } } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const { ids } = req.body as { ids: string[] };
    if (ids.includes(id)) throw invalid('A record cannot be merged into itself');
    return run(ctx, async (tx) => {
      const keep = (await tx.query<{ pipeline_id: string; owner_node_id: string; name: string; value_amount: string | null; close_date: string | null; owner_user_id: string | null; custom: Record<string, unknown> }>(
        'SELECT pipeline_id, owner_node_id, name, value_amount, close_date, owner_user_id, custom FROM boxes WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!keep) throw notFound('Box not found');
      requireEdit(ctx, keep.owner_node_id);
      const lose = (await tx.query<{ id: string; pipeline_id: string; owner_node_id: string; name: string; value_amount: string | null; close_date: string | null; owner_user_id: string | null; custom: Record<string, unknown> }>(
        'SELECT id, pipeline_id, owner_node_id, name, value_amount, close_date, owner_user_id, custom FROM boxes WHERE id = ANY($1::uuid[]) ORDER BY created_at FOR UPDATE', [ids])).rows;
      if (lose.length !== new Set(ids).size) throw notFound('One of the records was not found');
      for (const l of lose) {
        if (l.pipeline_id !== keep.pipeline_id) throw invalid('Only records in the same pipeline can be merged');
        if (l.owner_node_id !== keep.owner_node_id) throw invalid('Only records of the same branch can be merged');
        requireEdit(ctx, l.owner_node_id);
      }
      const moved = { notes: 0, tasks: 0, threads: 0 };
      moved.notes = (await tx.query('UPDATE notes SET box_id = $1 WHERE box_id = ANY($2::uuid[])', [id, ids])).rowCount ?? 0;
      moved.tasks = (await tx.query('UPDATE tasks SET box_id = $1 WHERE box_id = ANY($2::uuid[])', [id, ids])).rowCount ?? 0;
      moved.threads = (await tx.query('UPDATE box_threads SET box_id = $1 WHERE box_id = ANY($2::uuid[]) AND thread_id NOT IN (SELECT thread_id FROM box_threads WHERE box_id = $1)', [id, ids])).rowCount ?? 0;
      await tx.query('UPDATE box_contacts SET box_id = $1 WHERE box_id = ANY($2::uuid[]) AND contact_id NOT IN (SELECT contact_id FROM box_contacts WHERE box_id = $1)', [id, ids]);
      await tx.query('UPDATE mail_merge_recipients SET box_id = $1 WHERE box_id = ANY($2::uuid[])', [id, ids]);
      // empty fields on the kept record are filled from the others, first one wins
      const custom = { ...keep.custom };
      let value = keep.value_amount, close = keep.close_date, owner = keep.owner_user_id;
      for (const l of lose) {
        for (const [k, v] of Object.entries(l.custom ?? {})) if (custom[k] === undefined || custom[k] === null || custom[k] === '') custom[k] = v;
        value ??= l.value_amount; close ??= l.close_date; owner ??= l.owner_user_id;
      }
      await tx.query('UPDATE boxes SET custom = $2, value_amount = $3, close_date = $4, owner_user_id = $5, updated_at = now() WHERE id = $1', [id, JSON.stringify(custom), value, close, owner]);
      await tx.query('DELETE FROM boxes WHERE id = ANY($1::uuid[])', [ids]);
      await tx.query(
        `INSERT INTO notes (tenant_id, box_id, owner_node_id, author_id, body) VALUES ($1,$2,$3,$4,$5)`,
        [ctx.tenantId, id, keep.owner_node_id, ctx.userId, `Merged ${lose.length} duplicate record${lose.length === 1 ? '' : 's'} into this one: ${lose.map((l) => l.name).join(', ')}.`.slice(0, 2000)]);
      await audit(tx, ctx, 'box_merged', 'box', id, { merged: ids, moved });
      return { id, merged: lose.length, moved };
    });
  });
}
