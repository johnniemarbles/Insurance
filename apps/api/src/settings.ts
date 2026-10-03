import type { Tx } from '@pii/db';
import { SETTINGS, settingDef, type SettingScope } from '@pii/domain';

export interface Resolved {
  value: unknown;
  /** Where the value in force comes from. */
  source: { type: 'default' | SettingScope; name?: string };
  locked: boolean;
  /** The person's own value, if they set one (it may be overridden by a lock). */
  own?: unknown;
  /** What the person would get if they cleared their own value. */
  inherited: unknown;
  inheritedSource: { type: 'default' | SettingScope; name?: string };
}

interface Row { key: string; scope_type: SettingScope; scope_id: string; value: unknown; locked: boolean; depth: number; name: string | null }

/** Works out the value in force for the signed-in person: a lock from the highest level wins, otherwise the most specific level wins. */
export async function resolveSettings(tx: Tx, userId: string, keys?: string[]): Promise<Record<string, Resolved>> {
  const rows = (await tx.query<Row>(
    `SELECT sv.key, sv.scope_type, sv.scope_id, sv.value, sv.locked,
            CASE WHEN sv.scope_type = 'node' THEN (SELECT count(*)::int FROM org_reach r WHERE r.descendant_id = sv.scope_id) ELSE 0 END AS depth,
            CASE sv.scope_type WHEN 'node' THEN (SELECT n.name FROM org_nodes n WHERE n.id = sv.scope_id) WHEN 'tenant' THEN (SELECT t.name FROM tenants t WHERE t.id = sv.scope_id) END AS name
       FROM setting_values sv
      WHERE ($1::text[] IS NULL OR sv.key = ANY ($1))`,
    [keys ?? null],
  )).rows;
  const out: Record<string, Resolved> = {};
  for (const def of SETTINGS) {
    if (keys && !keys.includes(def.key)) continue;
    const mine = rows.filter((r) => r.key === def.key);
    const own = mine.find((r) => r.scope_type === 'user' && r.scope_id === userId);
    const nodes = mine.filter((r) => r.scope_type === 'node').sort((a, b) => b.depth - a.depth); // deepest first
    const tenant = mine.find((r) => r.scope_type === 'tenant');
    const locks = [tenant, ...[...nodes].reverse()].filter((r): r is Row => !!r && r.locked); // highest first
    const src = (r: Row) => ({ type: r.scope_type as SettingScope, name: r.name ?? undefined });
    const inheritedRow = locks[0] ?? nodes[0] ?? tenant;
    const inherited = inheritedRow ? inheritedRow.value : def.default;
    const inheritedSource = inheritedRow ? src(inheritedRow) : { type: 'default' as const };
    if (locks[0]) out[def.key] = { value: locks[0].value, source: src(locks[0]), locked: true, own: own?.value, inherited, inheritedSource };
    else if (own) out[def.key] = { value: own.value, source: { type: 'user' }, locked: false, own: own.value, inherited, inheritedSource };
    else out[def.key] = { value: inherited, source: inheritedSource, locked: false, inherited, inheritedSource };
  }
  return out;
}

export async function effectiveSetting<T>(tx: Tx, userId: string, key: string): Promise<T> {
  if (!settingDef(key)) throw new Error(`Unknown setting ${key}`);
  return (await resolveSettings(tx, userId, [key]))[key]!.value as T;
}
