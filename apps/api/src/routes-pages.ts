import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { hashToken } from '@pii/platform';
import type { AppDeps } from './app.ts';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const ERRORS: Record<string, string> = {
  not_invited: 'This Google account has not been invited. Ask your administrator for an invitation.',
  unverified_email: 'Google could not verify this email address.',
};

function page(title: string, body: string, product: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;color:#1f2937;background:#f9fafb;margin:0;display:grid;place-items:center;min-height:100vh}
main{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:32px;max-width:440px;text-align:center}img{width:72px;height:72px}h1{font-size:20px;margin:12px 0 8px}p{color:#4b5563}a{color:#1d4ed8}</style></head>
<body><main><img src="/brand/logo.png" alt=""><h1>${esc(product)}</h1>${body}</main></body></html>`;
}

/** Small landing pages for the places the server sends people: after sign-in, sign-in errors, privacy. */
export function registerPageRoutes(app: FastifyInstance, deps: AppDeps): void {
  const product = deps.config.productDisplayName;

  app.get('/', async (req, reply) => {
    const q = req.query as { signed_in?: string; welcome?: string };
    let body = '<p>Open Gmail with the PII extension installed to get started.</p>';
    let lang: 'en' | 'fr-CA' = 'en';
    if (q.signed_in) {
      body = '<p><b>You are signed in.</b></p><p>You can close this tab and return to Gmail. Open an email and use the PII panel.</p>';
      try {
        const id = await deps.authenticate(req);
        lang = id.user.locale === 'fr-CA' ? 'fr-CA' : 'en';
        const company = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [id.ctx.tenantId])).rows[0]?.name ?? product;
        const first = (id.user.displayName ?? '').split(' ')[0] ?? '';
        const ext = process.env.PII_EXTENSION_URL;
        const T = lang === 'fr-CA'
          ? { hi: first ? `Bienvenue, ${esc(first)}` : 'Bienvenue', in: `Vous faites maintenant partie de <b>${esc(company)}</b>.`, s1: 'Installez l’extension Chrome PII', s1x: ext ? 'Installer' : 'Si vous ne l’avez pas encore, demandez-la à la personne qui vous a invité.', s2: 'Ouvrez Gmail', s3: 'Cherchez <b>PII</b> dans le panneau de gauche', go: 'Ouvrir Gmail', back: 'Vous êtes connecté. Vous pouvez fermer cet onglet.' }
          : { hi: first ? `Welcome, ${esc(first)}` : 'Welcome', in: `You are now part of <b>${esc(company)}</b>.`, s1: 'Install the PII Chrome extension', s1x: ext ? 'Install it' : 'If you do not have it yet, ask the person who invited you.', s2: 'Open Gmail', s3: 'Look for <b>PII</b> in the left panel', go: 'Open Gmail', back: 'You are signed in. You can close this tab.' };
        body = q.welcome
          ? `<p>${T.in}</p><ol style="text-align:left;line-height:1.7;padding-left:22px"><li><b>${T.s1}</b><br><span style="color:#6b7280;font-size:14px">${ext ? `<a href="${esc(ext)}">${T.s1x}</a>` : T.s1x}</span></li><li><b>${T.s2}</b></li><li>${T.s3}</li></ol><p><a href="https://mail.google.com" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${T.go}</a></p>`
          : `<p>${T.back}</p><p><a href="https://mail.google.com">${T.go}</a></p>`;
        return reply.type('text/html; charset=utf-8').send(page(product, body, T.hi).replace('<html lang="en">', `<html lang="${lang}">`));
      } catch { /* not signed in after all: fall through to the plain page */ }
    }
    return reply.type('text/html; charset=utf-8').send(page(product, body, product));
  });

  // The page behind the link in an invitation email: who invited you, to what, and one button.
  const T = {
    'en': { invited: 'You are invited', by: (w: string, c: string) => `${w} invited you to join <b>${c}</b>.`, as: 'Your role', place: 'Where', go: 'Continue with Google', hint: (e: string) => `Use the Google account for <b>${e}</b>.`, privacy: 'Privacy', expiredT: 'This invitation has expired', expired: (w: string) => `Ask ${w} to send you a new one. It only takes a moment.`, usedT: 'You have already joined', used: 'Open Gmail and use the PII panel.', badT: 'This link does not work', bad: 'It may have been copied incompletely, or withdrawn. Ask the person who invited you for a new one.', off: 'Sign-in is not set up on this server yet.' },
    'fr-CA': { invited: 'Vous êtes invité', by: (w: string, c: string) => `${w} vous invite à joindre <b>${c}</b>.`, as: 'Votre rôle', place: 'Où', go: 'Continuer avec Google', hint: (e: string) => `Utilisez le compte Google associé à <b>${e}</b>.`, privacy: 'Confidentialité', expiredT: 'Cette invitation a expiré', expired: (w: string) => `Demandez à ${w} de vous en envoyer une nouvelle. Cela ne prend qu’un instant.`, usedT: 'Vous avez déjà joint l’équipe', used: 'Ouvrez Gmail et utilisez le panneau PII.', badT: 'Ce lien ne fonctionne pas', bad: 'Il a peut-être été copié en partie, ou retiré. Demandez-en un nouveau à la personne qui vous a invité.', off: 'La connexion n’est pas encore configurée sur ce serveur.' },
  } as const;
  const ROLE = { en: { admin: 'Admin', manager: 'Manager', trainer: 'Trainer', partner: 'Partner', learner: 'Learner' }, 'fr-CA': { admin: 'Administrateur', manager: 'Gestionnaire', trainer: 'Formateur', partner: 'Partenaire', learner: 'Apprenant' } } as const;
  const inviteShell = (lang: string, title: string, inner: string, tone: 'ok' | 'warn' = 'ok') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:radial-gradient(1200px 500px at 50% -10%,#dbe7ff 0%,#f8fafc 60%)}
main{width:min(460px,92vw);background:#fff;border-radius:20px;box-shadow:0 20px 50px rgba(30,64,175,.12),0 2px 6px rgba(15,23,42,.06);padding:36px 32px;text-align:center}
.logo{width:64px;height:64px;border-radius:16px}h1{font-size:24px;margin:14px 0 6px;letter-spacing:-.01em}p{margin:6px 0;color:#475569}
.card{margin:20px 0;border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;text-align:left;background:#f8fafc}.row{display:flex;justify-content:space-between;gap:12px;padding:4px 0}.row span{color:#64748b}.row b{text-align:right}
.btn{display:block;margin-top:18px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:600;box-shadow:0 6px 16px rgba(37,99,235,.35)}.btn:hover{filter:brightness(1.06)}
.btn.off{background:#cbd5e1;box-shadow:none;pointer-events:none}.dot{width:44px;height:44px;border-radius:50%;margin:0 auto;display:grid;place-items:center;font-size:22px;background:${tone === 'ok' ? '#dcfce7' : '#fef3c7'}}.small{font-size:13px;color:#64748b;margin-top:18px}a.l{color:#2563eb}</style></head>
<body><main><img class="logo" src="/brand/logo.png" alt="">${inner}</main></body></html>`;

  app.get('/accept', async (req, reply) => {
    const token = String((req.query as { token?: string }).token ?? '');
    const send = (lang: 'en' | 'fr-CA', title: string, inner: string, code = 200, tone: 'ok' | 'warn' = 'ok') => reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').send(inviteShell(lang, title, inner, tone));
    const row = token.length >= 20 ? (await deps.authPool.query<{ id: string; tenant_id: string; node_id: string; role: string; email: string; locale: 'en' | 'fr-CA'; accepted_at: string | null; expired: boolean; opened: string | null; company: string; place: string; inviter: string | null }>(
      `SELECT i.id, i.tenant_id, i.node_id, i.role::text AS role, i.email::text AS email, i.locale::text AS locale, i.accepted_at, (i.expires_at <= now()) AS expired, i.link_opened_at AS opened,
              t.name AS company, n.name AS place, coalesce(u.display_name, u.email::text) AS inviter
         FROM invitations i JOIN tenants t ON t.id = i.tenant_id JOIN org_nodes n ON n.id = i.node_id LEFT JOIN app_users u ON u.id = i.invited_by
        WHERE i.token_hash = $1`, [hashToken(token)])).rows[0] : undefined;
    if (!row) { const t = T.en; return send('en', t.badT, `<div class="dot">?</div><h1>${t.badT}</h1><p>${t.bad}</p>`, 404, 'warn'); }
    const t = T[row.locale] ?? T.en, lang = row.locale ?? 'en';
    if (row.accepted_at) return send(lang, t.usedT, `<div class="dot">✓</div><h1>${t.usedT}</h1><p>${t.used}</p>`);
    if (row.expired) return send(lang, t.expiredT, `<div class="dot">⏳</div><h1>${t.expiredT}</h1><p>${t.expired(esc(row.inviter ?? 'your administrator'))}</p>`, 410, 'warn');
    if (!row.opened) {
      await deps.authPool.query('UPDATE invitations SET link_opened_at = now() WHERE id = $1 AND link_opened_at IS NULL', [row.id]).catch(() => undefined);
      await deps.authPool.query(`INSERT INTO audit_log (tenant_id, action, entity_type, entity_id, detail, owner_node_id) VALUES ($1, 'invitation_opened', 'invitation', $2, $3, $4)`, [row.tenant_id, row.id, JSON.stringify({ email: row.email }), row.node_id]).catch(() => undefined);
    }
    const href = `/auth/google/start?invite=${encodeURIComponent(token)}&hint=${encodeURIComponent(row.email)}`;
    const roleName = (ROLE[lang] as Record<string, string>)[row.role] ?? row.role;
    const inner = `<h1>${t.invited}</h1><p>${t.by(esc(row.inviter ?? '—'), esc(row.company))}</p>
<div class="card"><div class="row"><span>${t.place}</span><b>${esc(row.place)}</b></div><div class="row"><span>${t.as}</span><b>${esc(roleName)}</b></div></div>
${deps.google ? `<a class="btn" href="${esc(href)}">${t.go}</a>` : `<a class="btn off">${t.go}</a><p class="small">${t.off}</p>`}
<p class="small">${t.hint(esc(row.email))}</p><p class="small"><a class="l" href="/privacy">${t.privacy}</a></p>`;
    return send(lang, t.invited, inner);
  });

  app.get('/login', async (req, reply) => {
    const q = req.query as { error?: string };
    const msg = ERRORS[q.error ?? ''] ?? 'Sign-in did not complete. Close this tab and try again from the PII panel in Gmail.';
    return reply.code(q.error ? 403 : 200).type('text/html; charset=utf-8').send(page('Sign-in', `<p>${esc(msg)}</p>`, product));
  });

  app.get('/privacy', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').send(
      page('Privacy', `<p>The full privacy policy is being finalized. For questions or requests about your information, contact <a href="mailto:${esc(deps.config.privacyEmail)}">${esc(deps.config.privacyEmail)}</a>.</p>`, product),
    ),
  );

  // The full-page PII app. The same bundle is also built into the Gmail extension.
  app.get('/app', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(product)}</title>
<style>html,body{height:100%;margin:0}#pii-root{height:100%}</style></head><body><div id="pii-root"></div><script src="/app/app.js"></script></body></html>`,
    ),
  );
  app.get('/app/app.js', async (_req, reply) => {
    const data = await readFile(new URL('../public/app/app.js', import.meta.url));
    return reply.type('application/javascript; charset=utf-8').header('cache-control', 'no-cache').send(data);
  });

  for (const file of ['logo.png', 'icon-128.png']) {
    app.get(`/brand/${file}`, async (_req, reply) => {
      const data = await readFile(new URL(`../public/brand/${file}`, import.meta.url));
      return reply.type('image/png').header('cache-control', 'public, max-age=86400').send(data);
    });
  }
}
