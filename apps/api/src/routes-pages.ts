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
          ? { hi: first ? `Bienvenue, ${esc(first)}` : 'Bienvenue', in: `Vous faites maintenant partie de <b>${esc(company)}</b>.`, s1: 'Installez l\u2019extension Chrome PII', s1x: ext ? 'Installer' : 'Si vous ne l\u2019avez pas encore, demandez-la \u00e0 la personne qui vous a invit\u00e9.', s2: 'Ouvrez Gmail', s3: 'Cherchez <b>PII</b> dans le panneau de gauche', go: 'Ouvrir Gmail', back: 'Vous \u00eates connect\u00e9. Vous pouvez fermer cet onglet.' }
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
    const entityFr = neutral ? 'Punjab Insurance Agency Inc (Canada) et Punjab Insurance Broker Inc (\u00c9.-U.)' : entity;
    const ext = process.env.PII_EXTENSION_URL;
    const storedHere = deps.config.dataCountry === 'CA'
      ? (fr ? 'Les donn\u00e9es sont h\u00e9berg\u00e9es au Canada.' : 'Data is stored in Canada.')
      : (fr ? 'Les donn\u00e9es sont h\u00e9berg\u00e9es sur des serveurs s\u00e9curis\u00e9s aux \u00c9tats-Unis.' : 'Data is stored on secure servers in the United States.');
    const T = fr ? {
      tag: 'Le CRM d\u2019assurance qui vit dans Gmail',
      lead: `${product} aide les \u00e9quipes d\u2019assurance \u00e0 suivre leurs clients, pistes et renouvellements directement dans Gmail, sans quitter la bo\u00eete de r\u00e9ception.`,
      cta: ext ? 'Installer l\u2019extension Chrome' : 'Acc\u00e8s sur invitation',
      ctaNote: 'L\u2019acc\u00e8s se fait sur invitation de l\u2019administrateur de votre organisation. Ouvrez votre invitation, puis connectez-vous avec Google.',
      h: 'Ce que vous pouvez faire',
      f: [['Pipelines', 'Suivez chaque piste, police et renouvellement par \u00e9tape, dans Gmail.'], ['Liez vos courriels', 'Reliez une conversation \u00e0 un dossier d\u2019un clic. Rien n\u2019est li\u00e9 sans votre geste.'], ['Rappels et t\u00e2ches', 'Notes, \u00e9ch\u00e9ances et suivis sur chaque dossier, partag\u00e9s avec votre \u00e9quipe.'], ['Pour toute l\u2019organisation', 'Si\u00e8ge social, soci\u00e9t\u00e9s, succursales, partenaires et producteurs, chacun voit ce qui le concerne.']],
      hp: 'Votre vie priv\u00e9e',
      pt: `La connexion Google ne demande que votre nom et votre adresse courriel. ${product} n\u2019acc\u00e8de pas \u00e0 votre bo\u00eete Gmail par l\u2019API de Google et ne lit que la conversation que vous choisissez de lier. Aucune vente de donn\u00e9es, aucune publicit\u00e9. ${storedHere}`,
      nav: [['/privacy', 'Confidentialit\u00e9'], ['/terms', 'Conditions'], ['/support', 'Soutien']], other: ['English', 'en'], by: `Exploit\u00e9 par ${entityFr}.`,
    } : {
      tag: 'The insurance CRM that lives in Gmail',
      lead: `${product} helps insurance teams track clients, leads and renewals right inside Gmail, without leaving the inbox.`,
      cta: ext ? 'Install the Chrome extension' : 'Access is by invitation',
      ctaNote: 'Access is by invitation from your organization\u2019s administrator. Open your invitation, then sign in with Google.',
      h: 'What you can do',
      f: [['Pipelines', 'Move every lead, policy and renewal through stages, from Gmail.'], ['Link your emails', 'Link a conversation to a record in one click. Nothing is linked unless you choose to.'], ['Reminders and tasks', 'Notes, due dates and follow-ups on every record, shared with your team.'], ['Built for the organization', 'Head office, companies, branches, partners and producers each see what is theirs.']],
      hp: 'Your privacy',
      pt: `Google sign-in asks only for your name and email address. ${product} does not access your Gmail through Google\u2019s API and reads only the conversation you choose to link. We do not sell data or show ads. ${storedHere}`,
      nav: [['/privacy', 'Privacy'], ['/terms', 'Terms'], ['/support', 'Support']], other: ['Fran\u00e7ais', 'fr'], by: `Operated by ${entity}.`,
    };
    const cta = ext ? `<a class="btn" href="${esc(ext)}">${T.cta}</a>` : `<span class="btn off">${T.cta}</span>`;
    const title = `${product} \u00b7 ${T.tag}`;
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

  // RESTORED_PARTIAL - see continuation
