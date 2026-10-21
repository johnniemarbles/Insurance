import type { Config } from '@pii/platform';

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { send(m: Mail): Promise<void> }

/** What the last sends did, since this server started. Shown to administrators so a refused send is never silent. */
export const mailStatus: { lastOkAt: string | null; lastErrorAt: string | null; lastError: string | null } = { lastOkAt: null, lastErrorAt: null, lastError: null };

export const mailFrom = (config: Config, env: Record<string, string | undefined> = process.env): string => env.MAIL_FROM ?? `${config.productDisplayName} <notifications@punjabinsurance.co>`;

/** Sends through Resend. With no RESEND_API_KEY it does nothing, so a deployment without a mail account still works (in-app reminders only). */
export function resendMailer(config: Config, env: Record<string, string | undefined> = process.env): Mailer | undefined {
  const key = env.RESEND_API_KEY;
  if (!key) return undefined;
  const from = mailFrom(config, env);
  return {
    async send(m) {
      // Demo users have fictional addresses; nothing is sent to them.
      if (m.to.toLowerCase().endsWith('.invalid')) return;
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
          body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          let why = ''; try { why = ((await res.json()) as { message?: string }).message ?? ''; } catch { /* no body */ }
          throw new Error(`Resend answered ${res.status}${why ? `: ${why.slice(0, 200)}` : ''}`);
        }
        mailStatus.lastOkAt = new Date().toISOString();
      } catch (e) {
        mailStatus.lastErrorAt = new Date().toISOString(); mailStatus.lastError = (e as Error).message;
        throw e;
      }
    },
  };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

type D = Record<string, any>;
type Locale = 'en' | 'fr-CA';

/** The wording of each reminder email. Only reminder kinds are emailed. */
export function reminderText(kind: string, d: D, loc: Locale): { subject: string; line: string } | null {
  const fr = loc === 'fr-CA';
  switch (kind) {
    case 'learning_due': {
      const t = d.title || (fr ? 'Une formation' : 'A course');
      const when = d.daysLeft < 0 ? (fr ? `devait être terminée le ${d.dueOn}` : `was due ${d.dueOn}`) : d.daysLeft === 0 ? (fr ? 'est due aujourd’hui' : 'is due today') : (fr ? `est due dans ${d.daysLeft} jours` : `is due in ${d.daysLeft} days`);
      return { subject: fr ? `Rappel de formation : ${t}` : `Training reminder: ${t}`, line: `${t} ${when}` };
    }
    case 'ce_reminder': {
      const line = d.state === 'overdue'
        ? (fr ? `${d.pack} : votre période s’est terminée le ${d.termEnd} et il manquait ${d.remaining} heures` : `${d.pack}: your term ended ${d.termEnd} and ${d.remaining} hours were still missing`)
        : (fr ? `${d.pack} : il reste ${d.remaining} heures à compléter avant le ${d.termEnd}` : `${d.pack}: ${d.remaining} hours still to complete before ${d.termEnd}`);
      return { subject: fr ? 'Rappel de formation continue' : 'Continuing education reminder', line };
    }
    case 'compliance_expiry': {
      const w = d.daysLeft < 0 ? (fr ? 'est expiré' : 'has expired') : d.daysLeft === 0 ? (fr ? 'expire aujourd’hui' : 'expires today') : (fr ? `expire dans ${d.daysLeft} jours` : `expires in ${d.daysLeft} days`);
      const line = `${d.name ?? (fr ? 'Un partenaire' : 'A partner')} : ${d.label ?? (fr ? 'un permis' : 'a licence')} ${w}${d.company ? ` (${d.company})` : ''}`;
      return { subject: fr ? 'Rappel de conformité' : 'Compliance reminder', line };
    }
    case 'aml_alert': {
      const what = d.issue === 'cash_overdue'
        ? (fr ? `encaissement en espèces de ${d.detail} du ${d.since} sans référence de déclaration` : `cash receipt of ${d.detail} on ${d.since} still has no report reference`)
        : (fr ? `résultat de vérification (${d.detail}) du ${d.since} non examiné` : `screening hit (${d.detail}) from ${d.since} has not been reviewed`);
      return { subject: fr ? 'Conformité : point à traiter' : 'Compliance: item needs attention', line: `${d.name ?? ''} : ${what}` };
    }
    case 'first_week_late': {
      const open = Number(d.total) - Number(d.done);
      return { subject: fr ? 'Nouveau partenaire : première semaine dépassée' : 'New partner: first week is over',
        line: fr ? `${d.name ?? 'Un partenaire'} : la première semaine est terminée et il reste ${open} étape(s) ouverte(s) sur ${d.total}` : `${d.name ?? 'A partner'}: the first week is over and ${open} of ${d.total} steps are still open` };
    }
    case 'vault_alert': {
      const n = Number(d.pending) || 0;
      return { subject: fr ? 'Voûte d’archives : documents en attente' : 'Archive vault: documents waiting',
        line: fr ? `${n} document(s) signé(s) attendent depuis plus d’un jour d’être copiés dans la voûte d’archives` : `${n} signed document${n === 1 ? ' has' : 's have'} waited more than a day to be copied to the archive vault` };
    }
    case 'licence_check': {
      const st = String(d.status ?? '').replace(/_/g, ' ');
      return d.issue === 'adverse'
        ? { subject: fr ? 'Vérification de permis : problème au registre' : 'Licence check: register problem', line: fr ? `${d.name ?? 'Un partenaire'} : le registre de l’organisme de réglementation indique « ${st} » pour ${d.label ?? 'un permis'}. Le partenaire n’est plus autorisé à transiger.` : `${d.name ?? 'A partner'}: the regulator's register shows "${st}" for ${d.label ?? 'a licence'}. The partner is no longer cleared to transact.` }
        : { subject: fr ? 'Vérification de permis à faire' : 'Licence check due', line: fr ? `${d.name ?? 'Un partenaire'} : vérifiez ${d.label ?? 'le permis'} au registre de l’organisme de réglementation (échéance ${d.due}).` : `${d.name ?? 'A partner'}: check ${d.label ?? 'the licence'} on the regulator's register (due ${d.due}).` };
    }
    case 'advice_reviews_waiting': {
      const n = Number(d.pending) || 0, fl = Number(d.flagged) || 0;
      return { subject: fr ? 'Conseils en attente de revue de conformité' : 'Advice waiting for compliance review',
        line: fr ? `${n} dossier(s) de conseil signé(s) attendent une revue de conformité${fl ? `, dont ${fl} signalé(s)` : ''}` : `${n} signed advice file${n === 1 ? ' is' : 's are'} waiting for a compliance review${fl ? `, ${fl} of them flagged` : ''}` };
    }
    case 'needs_review_due': {
      const past = String(d.validUntil ?? '') < new Date().toISOString().slice(0, 10);
      return { subject: fr ? 'Analyse des besoins à revoir' : 'Needs analysis due for review',
        line: fr ? `${d.name ?? 'Un client'} : l’analyse des besoins ${past ? 'a expiré le' : 'expire le'} ${d.validUntil}. Revoyez-la avec le client et faites signer une nouvelle analyse.` : `${d.name ?? 'A client'}: the needs analysis ${past ? 'expired on' : 'expires on'} ${d.validUntil}. Review it with the client and have a new one signed.` };
    }
    case 'advice_review_decided': {
      const ok = d.outcome === 'passed';
      return { subject: fr ? 'Revue de conformité de votre conseil' : 'Compliance review of your advice',
        line: fr ? `« ${d.title ?? ''} » : ${ok ? 'revue réussie' : 'mesures à prendre'}. ${d.findings ?? ''}` : `“${d.title ?? ''}”: ${ok ? 'passed review' : 'needs action'}. ${d.findings ?? ''}` };
    }
    case 'team_overdue': {
      const n = Number(d.overdue) || 0;
      const top = Array.isArray(d.courses) ? (d.courses as { title: string; overdue: number }[]).slice(0, 3).map((c) => `${c.title} (${c.overdue})`).join(', ') : '';
      const line = fr
        ? `Formation : ${n} apprenant(s) en retard dans votre équipe${top ? ` — ${top}` : ''}`
        : `Training: ${n} learner${n === 1 ? ' is' : 's are'} overdue across your team${top ? ` — ${top}` : ''}`;
      return { subject: fr ? 'Résumé hebdomadaire de la formation' : 'Weekly training summary', line };
    }
    default: return null;
  }
}

export function buildReminderMail(config: Config, to: string, kind: string, d: D, loc: Locale): Mail | null {
  const t = reminderText(kind, d, loc);
  if (!t) return null;
  const fr = loc === 'fr-CA';
  const open = fr ? 'Ouvrir dans PII' : 'Open in PII';
  const off = fr ? 'Pour ne plus recevoir ces courriels, désactivez « Rappels par courriel » dans les paramètres de notification de PII.' : 'To stop these emails, turn off “Email reminders” in your PII notification settings.';
  const url = `${config.appOrigin}/app`;
  return {
    to, subject: t.subject,
    text: `${t.line}\n\n${open}: ${url}\n\n${off}\n${config.productDisplayName}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#1c1b1a"><p style="font-size:16px">${esc(t.line)}</p><p><a href="${esc(url)}" style="background:#1f3a5f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(open)}</a></p><p style="color:#6b6b6b;font-size:12px">${esc(off)}<br>${esc(config.productDisplayName)}</p></div>`,
  };
}

/** Several reminders for one person, in one email. */
export function buildDigestMail(config: Config, to: string, items: { kind: string; data: D }[], loc: Locale): Mail | null {
  const lines = items.map((i) => reminderText(i.kind, i.data, loc)?.line).filter((x): x is string => Boolean(x));
  if (lines.length === 0) return null;
  if (lines.length === 1) return buildReminderMail(config, to, items[0]!.kind, items[0]!.data, loc);
  const fr = loc === 'fr-CA';
  const subject = fr ? `${lines.length} rappels dans PII` : `${lines.length} reminders in PII`;
  const open = fr ? 'Ouvrir dans PII' : 'Open in PII';
  const off = fr ? 'Pour ne plus recevoir ces courriels, désactivez « Rappels par courriel » dans les paramètres de notification de PII.' : 'To stop these emails, turn off “Email reminders” in your PII notification settings.';
  const url = `${config.appOrigin}/app`;
  return {
    to, subject,
    text: `${lines.map((l) => `- ${l}`).join('\n')}\n\n${open}: ${url}\n\n${off}\n${config.productDisplayName}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:520px;margin:auto;color:#1c1b1a"><ul style="font-size:16px;padding-left:20px">${lines.map((l) => `<li style="margin:6px 0">${esc(l)}</li>`).join('')}</ul><p><a href="${esc(url)}" style="background:#1f3a5f;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none">${esc(open)}</a></p><p style="color:#6b6b6b;font-size:12px">${esc(off)}<br>${esc(config.productDisplayName)}</p></div>`,
  };
}
