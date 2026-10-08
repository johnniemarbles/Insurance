import type { Config } from '@pii/platform';

export interface Mail { to: string; subject: string; text: string; html: string }
export interface Mailer { send(m: Mail): Promise<void> }

/** Sends through Resend. With no RESEND_API_KEY it does nothing, so a deployment without a mail account still works (in-app reminders only). */
export function resendMailer(config: Config, env: Record<string, string | undefined> = process.env): Mailer | undefined {
  const key = env.RESEND_API_KEY;
  if (!key) return undefined;
  const from = env.MAIL_FROM ?? `${config.productDisplayName} <notifications@punjabinsurance.co>`;
  return {
    async send(m) {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend answered ${res.status}`);
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
