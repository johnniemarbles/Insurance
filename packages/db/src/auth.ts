import { createHash, randomBytes } from 'node:crypto';
import type { Db } from './index.ts';
import { findLoginCandidates, type LoginCandidate } from './index.ts';

export const SESSION_DAYS = 14;
const hash = (t: string) => createHash('sha256').update(t).digest();

export const EMBED_TOKEN_MINUTES = 30;

/** How often to touch last_seen_at (reduces write load under active CRM use). */
const LAST_SEEN_TOUCH_MS = 10 * 60_000;

/** A new session token. Cookie sign-in uses the default 14 days; the embedded screens inside Gmail use a short one. */
export async function createSession(authPool: Db, tenantId: string, userId: string, ttlMinutes = SESSION_DAYS * 24 * 60): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await authPool.query(
    `INSERT INTO sessions (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + make_interval(mins => $4))`,
    [tenantId, userId, hash(token), ttlMinutes],
  );
  return token;
}

/** Returns the signed-in user for a session token, or null if missing, expired or the user is disabled. */
export async function findSessionUser(authPool: Db, token: string): Promise<LoginCandidate | null> {
  const tokenHash = hash(token);
  const { rows } = await authPool.query<{ email: string; tenant_id: string; user_id: string; last_seen_at: Date | string | null }>(
    `SELECT u.email::text AS email, s.tenant_id, s.user_id, s.last_seen_at
       FROM sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status <> 'disabled'`,
    [tokenHash],
  );
  const r = rows[0];
  if (!r) return null;
  const last = r.last_seen_at ? new Date(r.last_seen_at).getTime() : 0;
  if (!last || Date.now() - last > LAST_SEEN_TOUCH_MS) {
    await authPool.query(`UPDATE sessions SET last_seen_at = now() WHERE token_hash = $1`, [tokenHash]).catch(() => undefined);
  }
  const candidates = await findLoginCandidates(authPool, r.email);
  return candidates.find((c) => c.userId === r.user_id) ?? null;
}

export const API_KEY_DAYS = 365;
export interface ApiKeyRow { id: string; name: string; prefix: string; createdAt: string; expiresAt: string; lastUsedAt: string | null; revokedAt: string | null }

/** Makes a read-only API key for a person. The token is returned once; only its hash is kept. */
export async function createApiKey(authPool: Db, tenantId: string, userId: string, name: string): Promise<{ id: string; token: string }> {
  const token = `pii_k_${randomBytes(32).toString('base64url')}`;
  const { rows } = await authPool.query<{ id: string }>(
    `INSERT INTO api_keys (tenant_id, user_id, name, token_hash, token_prefix, expires_at) VALUES ($1,$2,$3,$4,$5, now() + make_interval(days => $6)) RETURNING id`,
    [tenantId, userId, name, hash(token), token.slice(0, 12), API_KEY_DAYS],
  );
  return { id: rows[0]!.id, token };
}

export async function listApiKeys(authPool: Db, userId: string): Promise<ApiKeyRow[]> {
  const { rows } = await authPool.query(
    `SELECT id, name, token_prefix AS prefix, created_at AS "createdAt", expires_at AS "expiresAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt"
       FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC`,
    [userId],
  );
  return rows as ApiKeyRow[];
}

export async function revokeApiKey(authPool: Db, userId: string, id: string): Promise<boolean> {
  const r = await authPool.query(`UPDATE api_keys SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [id, userId]);
  return (r.rowCount ?? 0) > 0;
}

/** Returns the person behind an API key, or null if the key is unknown, revoked, expired, or the person is disabled. */
export async function findApiKeyUser(authPool: Db, token: string): Promise<LoginCandidate | null> {
  const { rows } = await authPool.query<{ email: string; user_id: string }>(
    `UPDATE api_keys k SET last_used_at = now()
       FROM app_users u
      WHERE k.token_hash = $1 AND k.revoked_at IS NULL AND k.expires_at > now() AND u.id = k.user_id AND u.status = 'active'
      RETURNING u.email::text AS email, k.user_id`,
    [hash(token)],
  );
  const r = rows[0];
  if (!r) return null;
  const candidates = await findLoginCandidates(authPool, r.email);
  return candidates.find((c) => c.userId === r.user_id) ?? null;
}

export async function deleteSession(authPool: Db, token: string): Promise<void> {
  await authPool.query('DELETE FROM sessions WHERE token_hash = $1', [hash(token)]);
}

export type SignInResult =
  | { ok: true; user: LoginCandidate; accepted: boolean }
  | { ok: false; reason: 'unknown_user' | 'tenant_required' | 'invitation_invalid' | 'email_mismatch' | 'identity_conflict' | 'disabled' };

export interface GoogleIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

/**
 * Turns a verified Google identity into a local user.
 * - With an invitation token: validates it (unexpired, unused, same email), creates or extends the user, marks it used.
 * - Without: the email must already belong to a user (invite-only; there is no self-registration).
 * - The Google account id is bound to the user on first sign-in; a different Google id for the same user is refused.
 */
export async function signInWithGoogle(
  authPool: Db,
  id: GoogleIdentity,
  opts: { inviteToken?: string; tenantId?: string; locale?: 'en' | 'fr-CA' } = {},
): Promise<SignInResult> {
  const email = id.email.trim().toLowerCase();
  const client = await authPool.connect();
  try {
    await client.query('BEGIN');
    let accepted = false;
    if (opts.inviteToken) {
      const inv = (
        await client.query<{ id: string; tenant_id: string; node_id: string; role: string; email: string; locale: string; invited_by: string | null; onboarding_case_id: string | null; audit_engagement_id: string | null }>(
          `SELECT id, tenant_id, node_id, role::text AS role, email::text AS email, locale::text AS locale, invited_by, onboarding_case_id, audit_engagement_id FROM invitations
            WHERE token_hash = $1 AND accepted_at IS NULL AND expires_at > now() FOR UPDATE`,
          [hash(opts.inviteToken)],
        )
      ).rows[0];
      if (!inv) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'invitation_invalid' };
      }
      if (inv.email.toLowerCase() !== email) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'email_mismatch' };
      }
      let userId = (await client.query<{ id: string; status: string }>(`SELECT id, status::text AS status FROM app_users WHERE tenant_id = $1 AND email = $2`, [inv.tenant_id, email])).rows[0];
      if (userId?.status === 'disabled') {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'disabled' };
      }
      let uid = userId?.id;
      if (!uid) {
        uid = (
          await client.query<{ id: string }>(
            `INSERT INTO app_users (tenant_id, email, display_name, google_sub, locale, status, home_node_id)
             VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
            [inv.tenant_id, email, id.name ?? null, id.sub, inv.locale, inv.node_id],
          )
        ).rows[0]!.id;
      }
      // An external auditor (annual-review plan, section C) gets a login and no role: its access is the engagement alone.
      if (inv.audit_engagement_id) {
        await client.query(`UPDATE audit_engagements SET auditor_user_id = $2 WHERE id = $1 AND auditor_user_id IS NULL`, [inv.audit_engagement_id, uid]);
      } else {
        await client.query(`INSERT INTO user_node_roles (tenant_id, user_id, node_id, role) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [inv.tenant_id, uid, inv.node_id, inv.role]);
      }
      await client.query('UPDATE invitations SET accepted_at = now() WHERE id = $1', [inv.id]);
      // A partner invitation from onboarding: the partner now has a login.
      if (inv.onboarding_case_id) await client.query('UPDATE onboarding_cases SET login_created_at = coalesce(login_created_at, now()) WHERE id = $1', [inv.onboarding_case_id]);
      await client.query(
        `INSERT INTO audit_log (tenant_id, actor_user_id, action, entity_type, entity_id, detail, owner_node_id) VALUES ($1, $2, 'invitation_accepted', 'invitation', $3, $4, $5)`,
        [inv.tenant_id, uid, inv.id, JSON.stringify({ nodeId: inv.node_id, role: inv.role, email: inv.email }), inv.node_id],
      );
      if (inv.invited_by && inv.invited_by !== uid) {
        await client.query(
          `INSERT INTO notifications (tenant_id, user_id, kind, actor_id, data) VALUES ($1, $2, 'invite_accepted', $3, $4)`,
          [inv.tenant_id, inv.invited_by, uid, JSON.stringify({ email: inv.email, role: inv.role })],
        );
      }
      accepted = true;
      opts = { ...opts, tenantId: inv.tenant_id };
    }
    await client.query('COMMIT');

    const candidates = await findLoginCandidates(authPool, email);
    const list = opts.tenantId ? candidates.filter((c) => c.tenantId === opts.tenantId) : candidates;
    if (list.length === 0) return { ok: false, reason: 'unknown_user' };
    if (list.length > 1) return { ok: false, reason: 'tenant_required' };
    const user = list[0]!;

    // Bind the Google account on first sign-in; refuse a different one afterwards.
    const bound = await authPool.query<{ google_sub: string | null }>('SELECT google_sub FROM app_users WHERE id = $1', [user.userId]);
    const existingSub = bound.rows[0]?.google_sub;
    if (existingSub && existingSub !== id.sub) return { ok: false, reason: 'identity_conflict' };
    await authPool.query(
      `UPDATE app_users SET google_sub = $2, last_login_at = now(),
              display_name = coalesce(display_name, $3),
              picture_url = coalesce($4, picture_url),
              status = CASE WHEN status = 'invited' THEN 'active'::user_status ELSE status END
        WHERE id = $1`,
      [user.userId, id.sub, id.name ?? null, id.picture ?? null],
    );
    return { ok: true, user: { ...user, status: user.status === 'invited' ? 'active' : user.status }, accepted };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
