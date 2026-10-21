// Annuity training gate (US plan, step 1). California and Texas require annuity training before a producer sells annuities.
// When ANNUITY_GATE_ENABLED=1, a deal whose needs analysis is for an annuity cannot move into a stage that needs paperwork
// until the deal's advisor has finished the initial annuity training for every licence of theirs that carries an annuity rule.
// Advisors with no such licence (all Canadian licences today) are not affected.
import type { Tx } from '@pii/db';
import { annuityStatus, termWindow, type AnnuityRule, type AnnuityStatus } from '@pii/domain';
import { HttpError } from './errors.ts';

export const annuityGateEnabled = () => process.env.ANNUITY_GATE_ENABLED === '1';
const today = () => new Date().toISOString().slice(0, 10);

interface Row { pack_code: string; pack_name: string; term_start_month: number; term_start_day: number; term_months: number; term_anchor: string | null; rule: AnnuityRule; entries: { completedOn: string; hours: number }[] }

/** One advisor's annuity training, per licence with an annuity rule (empty when none of their licences has one). */
export async function annuityTrainingOf(tx: Tx, userId: string, day = today()): Promise<({ packCode: string; packName: string } & AnnuityStatus)[]> {
  const rows = (await tx.query<Row>(
    `SELECT pack_code, pack_name, term_start_month, term_start_day, term_months, term_anchor::text, rule, entries FROM annuity_training_for($1)`, [userId])).rows;
  return rows.map((r) => {
    const term = termWindow({ termStartMonth: r.term_start_month, termStartDay: r.term_start_day, termMonths: r.term_months, termAnchor: r.term_months > 12 ? r.term_anchor : null }, day);
    return { packCode: r.pack_code, packName: r.pack_name, ...annuityStatus(r.rule, r.entries.map((e) => ({ completedOn: String(e.completedOn).slice(0, 10), hours: Number(e.hours) })), term) };
  });
}

/** Whether the deal is for an annuity: its latest needs analysis says so. */
async function isAnnuityDeal(tx: Tx, boxId: string): Promise<boolean> {
  const r = (await tx.query<{ line: string | null }>(
    `SELECT answers ->> 'productLine' AS line FROM advice_records WHERE box_id = $1 AND kind = 'needs_analysis' ORDER BY created_at DESC LIMIT 1`, [boxId])).rows[0];
  return r?.line === 'annuity';
}

/** Throws 409 when an annuity deal's advisor has not finished their initial annuity training. */
export async function checkAnnuityTraining(tx: Tx, boxId: string, stageName: string): Promise<void> {
  if (!annuityGateEnabled() || !(await isAnnuityDeal(tx, boxId))) return;
  const advisor = (await tx.query<{ owner: string | null; name: string | null }>(
    `SELECT b.owner_user_id AS owner, coalesce(u.display_name, u.email::text) AS name FROM boxes b LEFT JOIN app_users u ON u.id = b.owner_user_id WHERE b.id = $1`, [boxId])).rows[0];
  if (!advisor?.owner) return;
  const short = (await annuityTrainingOf(tx, advisor.owner)).filter((s) => !s.initialDone);
  if (!short.length) return;
  const what = short.map((s) => `${s.initialHours} of ${s.initialRequired} hours for ${s.packName}`).join('; ');
  throw new HttpError(409, 'annuity_training', `To move to “${stageName}”, ${advisor.name ?? 'the advisor'} needs to finish annuity training first (${what}). Log the hours under Training, CE, as “Annuity training”.`);
}
