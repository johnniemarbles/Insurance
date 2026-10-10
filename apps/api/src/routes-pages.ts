import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
import { hashToken } from '@pii/platform';
import type { AppDeps } from './app.ts';
import { privacy, support, terms, type Lang, type LegalInfo } from './legal.ts';
import { guideFor, renderGuide, type GuideLang } from './partner-guide.ts';

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
          : `<p>${T.back}</p><p><a href="https://mail.google.com">${T.go}</a></p><p><a href="/guide?lang=${lang}">${lang === 'fr-CA' ? 'Guide du partenaire' : 'Partner guide'}</a></p>`;
        return reply.type('text/html; charset=utf-8').send(page(product, body, T.hi).replace('<html lang="en">', `<html lang="${lang}">`));
      } catch { /* not signed in after all: show the plain signed-in page */ }
      return reply.type('text/html; charset=utf-8').send(page(product, body, product));
    }
    return reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=300').send(homePage(req));
  });

  // Public product home page: what the app is, who it is for, what it reads, where the policies are.
  const homePage = (req: import('fastify').FastifyRequest): string => {
    const q = (req.query as { lang?: string }).lang;
    const lang: Lang = q ? (q.startsWith('fr') ? 'fr-CA' : 'en') : (String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fr') ? 'fr-CA' : 'en');
    const fr = lang === 'fr-CA', l = fr ? 'fr' : 'en';
    const host = String(req.hostname ?? '').toLowerCase().split(':')[0] ?? '';
    const neutral = (process.env.HOME_HOSTS ?? 'punjabinsurance.co,www.punjabinsurance.co').split(',').map((h) => h.trim().toLowerCase()).includes(host);
    const entity = neutral ? 'Punjab Insurance Agency Inc (Canada) and Punjab Insurance Broker Inc (US)' : deps.config.region === 'us' ? 'Punjab Insurance Broker Inc' : 'Punjab Insurance Agency Inc';
    const entityFr = neutral ? 'Punjab Insurance Agency Inc (Canada) et Punjab Insurance Broker Inc (É.-U.)' : entity;
    const ext = process.env.PII_EXTENSION_URL;
    const T = fr ? {
      tag: 'Le CRM d’assurance qui vit dans Gmail',
      lead: `${product} aide les équipes d’assurance à suivre leurs clients, pistes et renouvellements directement dans Gmail, sans quitter la boîte de réception.`,
      cta: ext ? 'Installer l’extension Chrome' : 'Accès sur invitation',
      ctaNote: 'L’accès se fait sur invitation de l’administrateur de votre organisation. Ouvrez votre invitation, puis connectez-vous avec Google.',
      h: 'Ce que vous pouvez faire',
      f: [['Pipelines', 'Suivez chaque piste, police et renouvellement par étape, dans Gmail.'], ['Liez vos courriels', 'Reliez une conversation à un dossier d’un clic. Rien n’est lié sans votre geste.'], ['Rappels et tâches', 'Notes, échéances et suivis sur chaque dossier, partagés avec votre équipe.'], ['Pour toute l’organisation', 'Siège social, sociétés, succursales, partenaires et producteurs, chacun voit ce qui le concerne.']],
      hp: 'Votre vie privée',
      pt: `La connexion Google ne demande que votre nom et votre adresse courriel. ${product} n’accède pas à votre boîte Gmail par l’API de Google et ne lit que la conversation que vous choisissez de lier. Aucune vente de données, aucune publicité. Les données sont hébergées sur des serveurs sécurisés aux États-Unis.`,
      nav: [['/privacy', 'Confidentialité'], ['/terms', 'Conditions'], ['/support', 'Soutien']], other: ['English', 'en'], by: `Exploité par ${entityFr}.`,
    } : {
      tag: 'The insurance CRM that lives in Gmail',
      lead: `${product} helps insurance teams track clients, leads and renewals right inside Gmail, without leaving the inbox.`,
      cta: ext ? 'Install the Chrome extension' : 'Access is by invitation',
      ctaNote: 'Access is by invitation from your organization’s administrator. Open your invitation, then sign in with Google.',
      h: 'What you can do',
      f: [['Pipelines', 'Move every lead, policy and renewal through stages, from Gmail.'], ['Link your emails', 'Link a conversation to a record in one click. Nothing is linked unless you choose to.'], ['Reminders and tasks', 'Notes, due dates and follow-ups on every record, shared with your team.'], ['Built for the organization', 'Head office, companies, branches, partners and producers each see what is theirs.']],
      hp: 'Your privacy',
      pt: `Google sign-in asks only for your name and email address. ${product} does not access your Gmail through Google’s API and reads only the conversation you choose to link. We do not sell data or show ads. Data is stored on secure servers in the United States.`,
      nav: [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/support', 'Support']], other: ['Français', 'fr'], by: `Operated by ${entity}.`,
    };
    const cta = ext ? `<a class="btn" href="${esc(ext)}">${T.cta}</a>` : `<span class="btn off">${T.cta}</span>`;
    const title = `${product} · ${T.tag}`;
    return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><meta name="description" content="${esc(T.lead)}">
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:radial-gradient(1200px 480px at 50% -10%,#dbe7ff 0%,#f8fafc 60%)}
@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#0b1020}.card{background:#111936!important;border-color:#26305a!important}a{color:#8ab4ff}.nav a,.muted{color:#9aa6d1!important}}
main{max-width:860px;margin:0 auto;padding:24px 20px 56px}header{display:flex;align-items:center;gap:12px}header img{width:40px;height:40px;border-radius:10px}.nav{margin-left:auto;display:flex;gap:16px;font-size:14px;flex-wrap:wrap}.nav a{color:#475569;text-decoration:none}
.hero{text-align:center;padding:56px 0 32px}h1{font-size:clamp(30px,5vw,44px);line-height:1.15;margin:0 0 12px;letter-spacing:-.02em}.lead{font-size:18px;max-width:620px;margin:0 auto 24px}
.btn{display:inline-block;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;text-decoration:none;padding:13px 24px;border-radius:12px;font-weight:600;box-shadow:0 6px 16px rgba(37,99,235,.3)}.btn.off{background:#64748b;box-shadow:none}
.muted{color:#64748b;font-size:14px;max-width:520px;margin:12px auto 0}h2{font-size:22px;margin:40px 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px}
.card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px}.card b{display:block;margin-bottom:4px}.card span{color:#64748b;font-size:15px}footer{margin-top:48px;font-size:14px;display:flex;flex-wrap:wrap;gap:8px 18px}a{color:#1d4ed8}</style></head>
<body><main><header><img src="/brand/logo.png" alt=""><b>${esc(product)}</b><nav class="nav" aria-label="Pages">${T.nav.map(([h, t]) => `<a href="${h}?lang=${l}">${t}</a>`).join('')}<a href="/?lang=${T.other[1]}" lang="${T.other[1]}">${T.other[0]}</a></nav></header>
<section class="hero"><h1>${esc(T.tag)}</h1><p class="lead">${esc(T.lead)}</p>${cta}<p class="muted">${esc(T.ctaNote)}</p></section>
<h2>${T.h}</h2><div class="grid">${T.f.map(([a, b]) => `<div class="card"><b>${esc(a!)}</b><span>${esc(b!)}</span></div>`).join('')}</div>
<h2>${T.hp}</h2><p>${esc(T.pt)} <a href="/privacy?lang=${l}">${T.nav[0]![1]}</a></p>
<footer class="muted"><span>${esc(T.by)}</span>${T.nav.map(([h, t]) => `<a href="${h}?lang=${l}">${t}</a>`).join('')}</footer></main></body></html>`;
  };

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
    const q = req.query as { error?: string; lang?: string };
    const fr = q.lang ? q.lang.startsWith('fr') : String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fr');
    const us = deps.config.region === 'us';
    const here = us ? 'United States' : 'Canada', there = us ? 'Canada' : 'United States';
    const hereFr = us ? 'aux États-Unis' : 'au Canada', thereFr = us ? 'Canada' : 'États-Unis';
    const host = String(req.hostname ?? '').toLowerCase();
    const otherHost = host.startsWith('us.') ? host.replace(/^us\./, 'ca.') : host.startsWith('ca.') ? host.replace(/^ca\./, 'us.') : '';
    const kind = q.error === 'unknown_user' || q.error === 'not_invited' ? 'invite' : q.error === 'cancelled' ? 'cancelled' : q.error === 'unverified_email' || q.error === 'email_not_verified' ? 'verify' : 'other';
    const T = fr ? {
      invite: ['Ce compte Google n’a pas accès', `Ce compte n’est pas invité sur le site PII (${hereFr}). PII est sur invitation seulement.`, ['Essayez un autre compte Google (celui de l’invitation).', `Si votre agence est en ${thereFr}, utilisez plutôt le site ${thereFr}.`, 'Sinon, demandez une invitation à votre administrateur.']],
      cancelled: ['Connexion annulée', 'Vous avez quitté Google avant la fin. Rien n’a été modifié.', []],
      verify: ['Courriel non vérifié', 'Google n’a pas pu vérifier l’adresse courriel de ce compte. Essayez un autre compte.', []],
      other: ['La connexion n’a pas abouti', 'Un problème est survenu. Réessayez dans un instant.', []],
      again: 'Réessayer', switchTo: `Passer au site ${thereFr}`, help: 'Besoin d’aide?', lang: 'English', langQ: 'en',
    } : {
      invite: ['This Google account doesn’t have access', `This account hasn’t been invited to the PII ${here} site. PII is invite-only.`, ['Try a different Google account (the one that received the invitation).', `If your agency is in ${there}, use the ${there} site instead.`, 'Otherwise, ask your administrator to invite you.']],
      cancelled: ['Sign-in cancelled', 'You left Google before finishing. Nothing was changed.', []],
      verify: ['Email not verified', 'Google couldn’t verify this account’s email address. Try a different account.', []],
      other: ['Sign-in didn’t complete', 'Something went wrong. Please try again in a moment.', []],
      again: 'Try again', switchTo: `Switch to the ${there} site`, help: 'Need help?', lang: 'Français', langQ: 'fr',
    };
    const [title, lead, tips] = T[kind] as [string, string, string[]];
    const html = `<!doctype html><html lang="${fr ? 'fr' : 'en'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)} · ${esc(product)}</title>
<style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;font:16px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;background:radial-gradient(900px 500px at 0% 0%,#dbe4ff,transparent 60%),#f8fafc}
main{width:100%;max-width:440px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:34px 30px;box-shadow:0 20px 50px -20px rgba(15,23,42,.25)}img{width:56px;height:56px;border-radius:14px}.b{display:flex;align-items:center;gap:12px;font-weight:700;margin-bottom:22px}
.ic{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:22px;background:#fef3c7;margin-bottom:12px}h1{font-size:23px;margin:0 0 8px;letter-spacing:-.01em}p{margin:0 0 14px;color:#475569}ul{margin:0 0 20px;padding-left:20px;color:#334155}li{margin:6px 0}
.btn{display:block;text-align:center;text-decoration:none;font-weight:600;border-radius:12px;padding:12px 16px;margin-top:10px}.p{background:#1d4ed8;color:#fff}.s{border:1px solid #cbd5e1;color:#0f172a}.f{margin-top:20px;font-size:13px;color:#64748b;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.f a{color:#64748b}a:focus-visible{outline:3px solid #93a8f4;outline-offset:2px}
@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#0b1020}main{background:#121a33;border-color:#243055;box-shadow:none}p,ul{color:#a9b4d6}.ic{background:#3a2f12}.s{border-color:#33406b;color:#e5e7eb}.f,.f a{color:#94a3b8}}</style></head>
<body><main><div class="b"><img src="/brand/logo.png" alt="">${esc(product)}</div><div class="ic" aria-hidden="true">${kind === 'cancelled' ? '↩' : '🔒'}</div><h1>${esc(title)}</h1><p>${esc(lead)}</p>
${tips.length ? `<ul>${tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<a class="btn p" href="/auth/google/start">${T.again}</a>${otherHost && kind === 'invite' ? `<a class="btn s" href="https://${esc(otherHost)}/app">${esc(T.switchTo)}</a>` : ''}
<div class="f"><span>${T.help} <a href="mailto:${esc(deps.config.supportEmail)}">${esc(deps.config.supportEmail)}</a></span><a href="/login?${q.error ? `error=${encodeURIComponent(q.error)}&` : ''}lang=${T.langQ}">${T.lang}</a></div></main></body></html>`;
    return reply.code(q.error ? 403 : 200).type('text/html; charset=utf-8').header('cache-control', 'no-store').send(html);
  });

  // Public pages: privacy, terms and support. English and French; ?lang=fr (or a French browser) picks French.
  const info: LegalInfo = {
    country: deps.config.region === 'us' ? 'US' : 'CA',
    entity: deps.config.region === 'us' ? 'Punjab Insurance Broker Inc' : 'Punjab Insurance Agency Inc',
    product: product,
    privacyEmail: deps.config.privacyEmail,
    supportEmail: deps.config.supportEmail,
    stored: deps.config.dataCountry,
    archive: deps.vault ? (deps.vault.region.startsWith('ca-') ? 'CA' : 'US') : null,
    governing: process.env.TERMS_GOVERNING_LAW || undefined,
    updated: process.env.LEGAL_UPDATED ?? '6 October 2026',
  };
  const doc = (kind: 'privacy' | 'terms' | 'support', build: typeof privacy) => async (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => {
    const q = (req.query as { lang?: string }).lang;
    const lang: Lang = q ? (q.startsWith('fr') ? 'fr-CA' : 'en') : (String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fr') ? 'fr-CA' : 'en');
    const d = build(lang === 'fr-CA' ? { ...info, updated: process.env.LEGAL_UPDATED ?? '6 octobre 2026' } : info, lang);
    const other = lang === 'fr-CA' ? { href: `/${kind}?lang=en`, label: 'English' } : { href: `/${kind}?lang=fr`, label: 'Français' };
    const nav = lang === 'fr-CA' ? [['/privacy', 'Confidentialité'], ['/terms', 'Conditions'], ['/support', 'Soutien']] : [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/support', 'Support']];
    const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(d.title)} · ${esc(product)}</title>
<style>:root{color-scheme:light dark}body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;background:#f8fafc}@media(prefers-color-scheme:dark){body{color:#e5e7eb;background:#0b1020}a{color:#8ab4ff}.nav a{color:#9aa6d1}}
main{max-width:720px;margin:0 auto;padding:32px 20px 64px}header{display:flex;align-items:center;gap:12px;margin-bottom:8px}header img{width:40px;height:40px;border-radius:10px}.nav{margin-left:auto;display:flex;gap:14px;font-size:14px}.nav a{color:#475569;text-decoration:none}.nav a[aria-current]{font-weight:600;text-decoration:underline}
h1{font-size:28px;margin:18px 0 8px;letter-spacing:-.01em}h2{font-size:18px;margin:28px 0 4px}p{margin:8px 0}a{color:#1d4ed8}</style></head>
<body><main><header><img src="/brand/logo.png" alt=""><b>${esc(product)}</b><nav class="nav" aria-label="${lang === 'fr-CA' ? 'Pages' : 'Pages'}">${nav.map(([h, t]) => `<a href="${h}?lang=${lang === 'fr-CA' ? 'fr' : 'en'}"${h === '/' + kind ? ' aria-current="page"' : ''}>${t}</a>`).join('')}<a href="${other.href}" lang="${lang === 'fr-CA' ? 'en' : 'fr'}">${other.label}</a></nav></header>
<h1>${esc(d.title)}</h1><p>${esc(d.intro)}</p>${d.sections.map((x) => `<h2>${esc(x.h)}</h2>${x.p.map((t) => `<p>${esc(t)}</p>`).join('')}`).join('')}</main></body></html>`;
    return reply.type('text/html; charset=utf-8').header('cache-control', 'public, max-age=300').send(html);
  };
  app.get('/privacy', doc('privacy', privacy));
  app.get('/terms', doc('terms', terms));
  app.get('/support', doc('support', support));

  // The partner guide. Not public: it needs a signed-in person who belongs to a company here (every role counts). Never cached or indexed.
  app.get('/guide', async (req, reply) => {
    const q = (req.query as { lang?: string }).lang;
    const send = (code: number, html: string) => reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow').send(html);
    let id;
    try { id = await deps.authenticate(req); } catch {
      const fr = q ? q.startsWith('fr') : String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fr');
      return send(401, page(product, fr
        ? '<p>Le guide du partenaire est réservé aux personnes connectées.</p><p><a href="/login?lang=fr-CA">Se connecter</a>, puis rouvrir ce lien.</p>'
        : '<p>The partner guide is for signed-in partners.</p><p><a href="/login">Sign in</a>, then open this link again.</p>', product));
    }
    if (!id.ctx.canUseCrm) return send(403, page(product, '<p>This guide is for people who belong to a partner company. Ask your administrator for a role.</p>', product));
    const lang: GuideLang = q ? (q.startsWith('fr') ? 'fr-CA' : 'en') : id.user.locale === 'fr-CA' ? 'fr-CA' : 'en';
    const country = deps.config.region === 'us' ? 'US' : 'CA';
    const other: GuideLang = lang === 'fr-CA' ? 'en' : 'fr-CA';
    return send(200, renderGuide(guideFor(lang, country), { lang, product, support: deps.config.supportEmail, otherLangHref: `/guide?lang=${other}`, otherLangLabel: other === 'fr-CA' ? 'Français' : 'English' }));
  });

  // The full-page PII app. The same bundle is also built into the Gmail extension.
  app.get('/app', async (_req, reply) =>
    reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('content-security-policy', "frame-ancestors 'self' https://mail.google.com").send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(product)}</title>
<style>html,body{height:100%;margin:0}#pii-root{height:100%}</style></head><body><div id="pii-root"></div><script src="/app/app.js"></script></body></html>`,
    ),
  );
  app.get('/app/app.js', async (_req, reply) => {
    const data = await readFile(new URL('../public/app/app.js', import.meta.url));
    return reply.type('application/javascript; charset=utf-8').header('cache-control', 'no-cache').send(data);
  });

  // Training videos shipped with the starter courses (public, no personal data). Range requests let the player seek.
  app.get('/media/:file', async (req, reply) => {
    const file = (req.params as { file: string }).file;
    if (!/^[a-z0-9-]{1,60}\.mp4$/.test(file)) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    let data: Buffer;
    try { data = await readFile(new URL(`../public/media/${file}`, import.meta.url)); } catch { return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }); }
    reply.type('video/mp4').header('accept-ranges', 'bytes').header('cache-control', 'public, max-age=86400');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (m && (m[1] || m[2])) {
      const start = m[1] ? Number(m[1]) : Math.max(0, data.length - Number(m[2]));
      const end = m[1] && m[2] ? Math.min(Number(m[2]), data.length - 1) : data.length - 1;
      if (start > end || start >= data.length) return reply.code(416).header('content-range', `bytes */${data.length}`).send();
      return reply.code(206).header('content-range', `bytes ${start}-${end}/${data.length}`).send(data.subarray(start, end + 1));
    }
    return reply.send(data);
  });

  for (const file of ['logo.png', 'icon-128.png']) {
    app.get(`/brand/${file}`, async (_req, reply) => {
      const data = await readFile(new URL(`../public/brand/${file}`, import.meta.url));
      return reply.type('image/png').header('cache-control', 'public, max-age=86400').send(data);
    });
  }
}
