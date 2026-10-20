// Families, Gate C: how person-level consents and ID checks count towards a deal's paperwork gates.
// Only while Gate C is on, and only in addition to the deal-level records that already count: nothing that satisfies a
// gate today stops doing so.
import type { Tx } from '@pii/db';
import { CONSENT_GATE_TYPE, type ConsentKind } from '@pii/domain';
import { idStatus, todayIso } from './family-compliance-rules.ts';

/**
 * Gate document types a deal has through its people: a consent purpose counts when every client on the deal has a
 * person consent for it that this deal uses and that is still in force; an ID check counts when every client on the
 * deal has a verified check that is current under the company's rules for their roles (any verified check when no
 * rule is set for a role).
 */
export async function personLevelFiled(tx: Tx, boxId: string): Promise<string[]> {
  const people = (await tx.query<{ id: string; roles: string[] }>(
    `SELECT bc.contact_id AS id,
            coalesce((SELECT array_agg(DISTINCT dp.role) FROM deal_parties dp WHERE dp.box_id = bc.box_id AND dp.contact_id = bc.contact_id AND dp.ended_at IS NULL), '{}') AS roles
       FROM box_contacts bc WHERE bc.box_id = $1`, [boxId])).rows;
  if (!people.length) return [];
  const filed: string[] = [];
  for (const [kind, type] of Object.entries(CONSENT_GATE_TYPE) as [ConsentKind, string][]) {
    const covered = (await tx.query<{ n: number }>(
      `SELECT count(DISTINCT pc.contact_id)::int AS n
         FROM consent_uses u JOIN person_consents pc ON pc.id = u.consent_id
        WHERE u.box_id = $1 AND pc.purpose = $2 AND person_consent_in_force(pc.id, $1)
          AND pc.contact_id IN (SELECT contact_id FROM box_contacts WHERE box_id = $1)`, [boxId, kind])).rows[0]!.n;
    if (covered === people.length) filed.push(type);
  }
  const rules = (await tx.query<{ dealRole: string; required: boolean; validMonths: number | null }>(
    'SELECT deal_role AS "dealRole", required, valid_months AS "validMonths" FROM id_check_rules')).rows;
  const today = todayIso();
  let allId = true;
  for (const p of people) {
    const roles = p.roles.length ? p.roles : ['applicant'];
    const lastOk = (await tx.query<{ d: string | null }>("SELECT max(checked_on)::text AS d FROM identity_references WHERE contact_id = $1 AND result = 'verified'", [p.id])).rows[0]!.d;
    if (!lastOk) { allId = false; break; }
    const st = idStatus(roles, rules, null, lastOk, today);
    if (st.status === 'expired') { allId = false; break; }
  }
  if (allId) filed.push('id_record');
  return filed;
}
