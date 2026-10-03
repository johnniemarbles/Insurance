import type { FastifyInstance } from 'fastify';
import { settingDef, validateSetting, type SettingScope } from '@pii/domain';
import { withRequestTx } from '@pii/db';
import { audit } from './audit.ts';
import { HttpError, forbidden, invalid } from './errors.ts';
import { managerNodeIds } from './crm-helpers.ts';
import { resolveSettings } from './settings.ts';
import type { AppDeps } from './app.ts';

const keyParam = { type: 'object', properties: { key: { type: 'string', maxLength: 80 } } } as const;
const uuidStr = { type: 'string', format: 'uuid' } as const;

export function registerSettingRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get('/v1/settings', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const settings = await resolveSettings(tx, ctx.userId);
      const mgr = ctx.isTenantAdmin ? [] : [...new Set(managerNodeIds(ctx))];
      const nodes = ctx.isTenantAdmin
        ? (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM org_nodes WHERE type <> 'tenant' ORDER BY name`)).rows
        : mgr.length ? (await tx.query<{ id: string; name: string }>(`SELECT id, name FROM org_nodes WHERE id = ANY ($1) ORDER BY name`, [mgr])).rows : [];
      // Branch and company values this person can see, so managers can review and change them.
      const levels = (await tx.query(
        `SELECT sv.key, sv.scope_type AS "scopeType", sv.scope_id AS "scopeId", sv.value, sv.locked,
                CASE sv.scope_type WHEN 'node' THEN (SELECT n.name FROM org_nodes n WHERE n.id = sv.scope_id) END AS name
           FROM setting_values sv WHERE sv.scope_type <> 'user' ORDER BY sv.key`)).rows;
      return { settings, levels, canSet: { node: nodes, tenant: ctx.isTenantAdmin } };
    });
  });

  app.put('/v1/settings/:key', {
    schema: {
      params: keyParam,
      body: { type: 'object', required: ['scope', 'value'], additionalProperties: false, properties: { scope: { enum: ['user', 'node', 'tenant'] }, scopeId: uuidStr, value: {}, locked: { type: 'boolean' } } },
    },
  }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { key } = req.params as { key: string };
    const b = req.body as { scope: SettingScope; scopeId?: string; value: unknown; locked?: boolean };
    const def = settingDef(key);
    if (!def) throw invalid('Unknown setting');
    if (!def.scopes.includes(b.scope)) throw invalid('This setting cannot be set at that level');
    const check = validateSetting(def, b.value);
    if (!check.ok) throw invalid(check.error);
    if (b.locked && (!def.lockable || b.scope === 'user')) throw invalid('This setting cannot be locked');
    let scopeId: string;
    if (b.scope === 'user') scopeId = ctx.userId;
    else if (b.scope === 'tenant') { if (!ctx.isTenantAdmin) throw forbidden('Only a company administrator can change company settings'); scopeId = ctx.tenantId; }
    else {
      if (!b.scopeId) throw invalid('Choose a branch');
      if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(b.scopeId)) throw forbidden('Only a manager of that branch can change its settings');
      scopeId = b.scopeId;
    }
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const prev = (await tx.query<{ value: unknown; locked: boolean }>('SELECT value, locked FROM setting_values WHERE scope_type = $1 AND scope_id = $2 AND key = $3', [b.scope, scopeId, key])).rows[0];
      try {
        await tx.query(
          `INSERT INTO setting_values (tenant_id, scope_type, scope_id, key, value, locked, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7)
           ON CONFLICT (scope_type, scope_id, key) DO UPDATE SET value = $5, locked = $6, updated_by = $7, updated_at = now()`,
          [ctx.tenantId, b.scope, scopeId, key, JSON.stringify(check.value), !!b.locked, ctx.userId],
        );
      } catch (e) {
        if ((e as Error).message === 'setting_locked') throw new HttpError(423, 'setting_locked', 'A higher level has locked this setting');
        throw e;
      }
      await tx.query(
        `INSERT INTO setting_history (tenant_id, scope_type, scope_id, key, old_value, new_value, old_locked, new_locked, changed_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [ctx.tenantId, b.scope, scopeId, key, prev ? JSON.stringify(prev.value) : null, JSON.stringify(check.value), prev?.locked ?? null, !!b.locked, ctx.userId],
      );
      if (b.scope !== 'user') await audit(tx, ctx, 'setting_changed', b.scope, scopeId, { key, locked: !!b.locked });
      return { settings: await resolveSettings(tx, ctx.userId, [key]) };
    });
  });

  app.delete('/v1/settings/:key', {
    schema: { params: keyParam, querystring: { type: 'object', required: ['scope'], properties: { scope: { enum: ['user', 'node', 'tenant'] }, scopeId: uuidStr } } },
  }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    const { key } = req.params as { key: string };
    const q = req.query as { scope: SettingScope; scopeId?: string };
    if (!settingDef(key)) throw invalid('Unknown setting');
    let scopeId: string;
    if (q.scope === 'user') scopeId = ctx.userId;
    else if (q.scope === 'tenant') { if (!ctx.isTenantAdmin) throw forbidden('Only a company administrator can change company settings'); scopeId = ctx.tenantId; }
    else {
      if (!q.scopeId) throw invalid('Choose a branch');
      if (!ctx.isTenantAdmin && !managerNodeIds(ctx).includes(q.scopeId)) throw forbidden('Only a manager of that branch can change its settings');
      scopeId = q.scopeId;
    }
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const prev = (await tx.query<{ value: unknown; locked: boolean }>('DELETE FROM setting_values WHERE scope_type = $1 AND scope_id = $2 AND key = $3 RETURNING value, locked', [q.scope, scopeId, key])).rows[0];
      if (prev) {
        await tx.query(
          `INSERT INTO setting_history (tenant_id, scope_type, scope_id, key, old_value, new_value, old_locked, new_locked, changed_by) VALUES ($1,$2,$3,$4,$5,NULL,$6,NULL,$7)`,
          [ctx.tenantId, q.scope, scopeId, key, JSON.stringify(prev.value), prev.locked, ctx.userId],
        );
        if (q.scope !== 'user') await audit(tx, ctx, 'setting_reverted', q.scope, scopeId, { key });
      }
      return { settings: await resolveSettings(tx, ctx.userId, [key]) };
    });
  });

  app.get('/v1/settings/history', async (req) => {
    const { ctx } = await deps.authenticate(req);
    return withRequestTx(deps.appPool, ctx, async (tx) => {
      const rows = (await tx.query(
        `SELECT h.key, h.scope_type AS "scopeType", h.old_value AS "oldValue", h.new_value AS "newValue", h.changed_at AS "changedAt", coalesce(u.display_name, u.email::text) AS "changedBy",
                CASE h.scope_type WHEN 'node' THEN (SELECT n.name FROM org_nodes n WHERE n.id = h.scope_id) END AS "scopeName"
           FROM setting_history h LEFT JOIN app_users u ON u.id = h.changed_by
          ORDER BY h.changed_at DESC LIMIT 50`,
      )).rows;
      return { history: rows };
    });
  });
}
