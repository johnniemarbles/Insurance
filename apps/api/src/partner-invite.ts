// The partner invite: one email that gives an agency's admin a PII login and asks them to install the Gmail extension.
// The invitation is linked to the onboarding case; accepting it marks the case "login created" (see signInWithGoogle).
// Reminders go at 24, 48 and 72 hours while the link is unopened. Each reminder issues a new link, so only the latest works.
import type { Tx } from '@pii/db';
import { withRequestTx } from '@pii/db';
import { newToken } from '@pii/platform';
import type { RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { escapeHtml } from './merge-render.ts';
import type { AppDeps } from './app.ts';
import type { Mail } from './mailer.ts';
import { COUNTRY_NAME, countryOf, storeUrl } from './countries.ts';

export const PARTNER_INVITE_DAYS = 7;
export const REMINDER_HOURS = 24;
export const MAX_REMINDERS = 3;

export type Locale = 'en' | 'fr-CA';

const COPY = {
  en: {
    subject: (firm: string) => `${firm} invites you to PII`,
    reminderSubject: (firm: string) => `Reminder: ${firm} is waiting for you on PII`,
    intro: (firm: string) => `${firm} has invited you to PII, the partner system for onboarding and compliance.`,
    reminder: (n: number) => `This is reminder ${n} of ${MAX_REMINDERS}. The link above is new, and the older one no longer works.`,
    step1: 'Step 1: create your PII login',
    step1Body: (email: string) => `Open the link and sign in with Google, using ${email}. The link works once and expires in ${PARTNER_INVITE_DAYS} days.`,
    cta1: 'Create my PII login',
    step2: 'Step 2: add PII to Gmail',
    step2Body: 'Add the PII extension to Chrome, then open Gmail and sign in with the same Google account.',
    cta2: 'Add PII to Gmail',
    step3: 'Or use PII in your browser',
    step3Body: 'No extension needed: sign in and use PII in a browser tab.',
    cta3: 'Open PII',
    country: (c: string) => `Your PII site: ${c}.`,
    foot: (firm: string) => `Questions? Ask ${firm}. This message was sent because someone invited you to PII.`,
  },
  'fr-CA': {
    subject: (firm: string) => `${firm} vous invite à PII`,
    reminderSubject: (firm: string) => `Rappel : ${firm} vous attend sur PII`,
    intro: (firm: string) => `${firm} vous a invité à PII, le système des partenaires pour l’intégration et la conformité.`,
    reminder: (n: number) => `Ceci est le rappel ${n} sur ${MAX_REMINDERS}. Le lien ci-dessus est nouveau, et l’ancien ne fonctionne plus.`,
    step1: 'Étape 1 : créez votre connexion PII',
    step1Body: (email: string) => `Ouvrez le lien et connectez-vous avec Google, avec ${email}. Le lien ne fonctionne qu’une fois et expire dans ${PARTNER_INVITE_DAYS} jours.`,
    cta1: 'Créer ma connexion PII',
    step2: 'Étape 2 : ajoutez PII à Gmail',
    step2Body: 'Ajoutez l’extension PII à Chrome, puis ouvrez Gmail et connectez-vous avec le même compte Google.',
    cta2: 'Ajouter PII à Gmail',
    step3: 'Ou utilisez PII dans votre navigateur',
    step3Body: 'Aucune extension requise : connectez-vous et utilisez PII dans un onglet.',
    cta3: 'Ouvrir PII',
    country: (c: string) => `Votre site PII : ${c}.`,
    foot: (firm: string) => `Des questions ? Écrivez à ${firm}. Ce message vous est envoyé parce que quelqu’un vous a invité à PII.`,
  },
} as const;

export function partnerInviteMail(p: { firm: string; email: string; acceptUrl: string; installUrl: string; appUrl?: string; country?: string; locale: Locale; reminder?: number }): Mail {
  const c = COPY[p.locale === 'fr-CA' ? 'fr-CA' : 'en'];
  const subject = p.reminder ? c.reminderSubject(p.firm) : c.subject(p.firm);
  const reminder = p.reminder ? `${c.reminder(p.reminder)}\n\n` : '';
  const where = p.country ? `${c.country(p.country)}\n\n` : '';
  const web = p.appUrl ? `\n\n${c.step3}\n${c.step3Body}\n${p.appUrl}` : '';
  const text = `${c.intro(p.firm)}\n\n${where}${reminder}${c.step1}\n${c.step1Body(p.email)}\n${p.acceptUrl}\n\n${c.step2}\n${c.step2Body}\n${p.installUrl}${web}\n\n${c.foot(p.firm)}`;
  const btn = (href: string, label: string, main: boolean) => `<a href="${escapeHtml(href)}" style="display:inline-block;${main ? 'background:#1d4ed8;color:#ffffff' : 'background:#ffffff;color:#1d4ed8;border:1px solid #c7d2fe'};text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:bold">${escapeHtml(label)}</a>`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a;max-width:560px"><p>${escapeHtml(c.intro(p.firm))}</p>${p.country ? `<p><b>${escapeHtml(c.country(p.country))}</b></p>` : ''}${p.reminder ? `<p>${escapeHtml(c.reminder(p.reminder))}</p>` : ''}`
    + `<h3>${escapeHtml(c.step1)}</h3><p>${escapeHtml(c.step1Body(p.email))}</p><p>${btn(p.acceptUrl, c.cta1, true)}</p>`
    + `<h3>${escapeHtml(c.step2)}</h3><p>${escapeHtml(c.step2Body)}</p><p>${btn(p.installUrl, c.cta2, false)}</p>`
    + (p.appUrl ? `<h3>${escapeHtml(c.step3)}</h3><p>${escapeHtml(c.step3Body)}</p><p>${btn(p.appUrl, c.cta3, false)}</p>` : '')
    + `<p style="color:#666">${escapeHtml(c.foot(p.firm))}</p></div>`;
  return { to: p.email, subject, text, html };
}

/** Creates the invitation for one partner email. Earlier open links for the same case and email stop working at once. */
export async function createPartnerInvitation(
  tx: Tx, ctx: RequestContext, p: { caseId: string; nodeId: string; email: string; locale: Locale },
): Promise<{ id: string; token: string }> {
  await tx.query(
    `UPDATE invitations SET expires_at = now() WHERE onboarding_case_id = $1 AND email = $2 AND accepted_at IS NULL AND expires_at > now()`,
    [p.caseId, p.email],
  );
  const { token, hash } = newToken();
  const expiresAt = new Date(Date.now() + PARTNER_INVITE_DAYS * 86_400_000);
  const { rows } = await tx.query<{ id: string }>(
    `INSERT INTO invitations (tenant_id, email, node_id, role, locale, token_hash, invited_by, expires_at, onboarding_case_id)
     VALUES ($1, $2, $3, 'partner', $4, $5, $6, $7, $8) RETURNING id`,
    [ctx.tenantId, p.email, p.nodeId, p.locale, hash, ctx.userId, expiresAt, p.caseId],
  );
  const id = rows[0]!.id;
  await audit(tx, ctx, 'invitation_created', 'invitation', id, { email: p.email, nodeId: p.nodeId, role: 'partner', onboardingCase: p.caseId }, p.nodeId);
  return { id, token };
}

/** Where to get the extension: the Chrome Web Store listing when it is set, else this server's install page. */
export const installUrl = (appOrigin: string) => storeUrl() ?? `${appOrigin}/install`;
export const appUrlFor = (appOrigin: string) => `${appOrigin}/app`;
export const acceptUrlFor = (appOrigin: string, token: string) => `${appOrigin}/accept?token=${token}`;

async function firmName(deps: AppDeps, tenantId: string): Promise<string> {
  return (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [tenantId])).rows[0]?.name ?? 'PII';
}

/** Records how the send went on the invitation, so the officer can see it and a refused send is never silent. */
export async function recordDelivery(deps: AppDeps, ctx: RequestContext, invitationId: string, ok: boolean, error?: string): Promise<void> {
  await withRequestTx(deps.appPool, ctx, (tx) => tx.query(
    `UPDATE invitations SET attempts = attempts + 1, last_attempt_at = now(), delivery_method = 'resend',
            sent_at = CASE WHEN $2 THEN now() ELSE sent_at END, delivery_error = CASE WHEN $2 THEN NULL ELSE $3 END
      WHERE id = $1`,
    [invitationId, ok, (error ?? 'Not sent').slice(0, 300)],
  ));
}

/** Sends the invitation email and records the outcome. Returns the status shown to the officer. */
export async function sendPartnerInvitation(
  deps: AppDeps, ctx: RequestContext, inv: { id: string; token: string; email: string; locale: Locale; tenantId: string },
): Promise<{ status: 'sent' | 'not_sent'; error?: string }> {
  if (!deps.mailer) {
    await recordDelivery(deps, ctx, inv.id, false, 'Email is not set up on this server');
    return { status: 'not_sent', error: 'Email is not set up on this server' };
  }
  const firm = await firmName(deps, inv.tenantId);
  try {
    await deps.mailer.send(partnerInviteMail({ firm, email: inv.email, acceptUrl: acceptUrlFor(deps.config.appOrigin, inv.token), installUrl: installUrl(deps.config.appOrigin), appUrl: appUrlFor(deps.config.appOrigin), country: COUNTRY_NAME[countryOf(deps.config.region)][inv.locale === 'fr-CA' ? 'fr-CA' : 'en'], locale: inv.locale }));
    await recordDelivery(deps, ctx, inv.id, true);
    return { status: 'sent' };
  } catch (e) {
    const error = (e as Error).message || 'The mail service refused the message';
    await recordDelivery(deps, ctx, inv.id, false, error);
    return { status: 'not_sent', error };
  }
}

/** Background: send the 24, 48 and 72 hour reminders for invitations whose link has not been opened. */
export async function sweepPartnerInviteReminders(deps: AppDeps): Promise<number> {
  if (!deps.mailer) return 0;
  const due = (await deps.authPool.query<{ id: string; tenant_id: string; email: string; locale: string; n: number }>(
    `SELECT id, tenant_id, email::text AS email, locale::text AS locale, reminders_sent + 1 AS n FROM invitations
      WHERE accepted_at IS NULL AND link_opened_at IS NULL AND expires_at > now() AND onboarding_case_id IS NOT NULL
        AND delivery_method = 'resend' AND sent_at IS NOT NULL AND reminders_sent < $1
        AND sent_at + (reminders_sent + 1) * make_interval(hours => $2) <= now()
      LIMIT 200`,
    [MAX_REMINDERS, REMINDER_HOURS],
  )).rows;
  let sent = 0;
  for (const d of due) {
    const { token, hash } = newToken();
    // Claim the reminder first, so two servers cannot both send it. The new token replaces the old link.
    const claimed = await deps.authPool.query(
      `UPDATE invitations SET reminders_sent = reminders_sent + 1, last_reminder_at = now(), token_hash = $2
        WHERE id = $1 AND reminders_sent = $3 AND accepted_at IS NULL AND link_opened_at IS NULL RETURNING id`,
      [d.id, hash, d.n - 1],
    );
    if (!claimed.rowCount) continue;
    try {
      const firm = await firmName(deps, d.tenant_id);
      const locale: Locale = d.locale === 'fr-CA' ? 'fr-CA' : 'en';
      await deps.mailer.send(partnerInviteMail({ firm, email: d.email, acceptUrl: acceptUrlFor(deps.config.appOrigin, token), installUrl: installUrl(deps.config.appOrigin), appUrl: appUrlFor(deps.config.appOrigin), country: COUNTRY_NAME[countryOf(deps.config.region)][locale === 'fr-CA' ? 'fr-CA' : 'en'], locale, reminder: d.n }));
      sent += 1;
    } catch {
      // Put the count back so the next sweep tries again; the reminder is not counted as sent.
      await deps.authPool.query('UPDATE invitations SET reminders_sent = reminders_sent - 1 WHERE id = $1', [d.id]);
    }
  }
  return sent;
}
