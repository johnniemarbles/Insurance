// The Gmail extension: check-in (its install is recorded when someone signs in to it), the zip copy partners download from the
// install page, and the install page itself. The zip is served only to people who are signed in (they got here through their invite).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import type { RequestContext } from '@pii/domain';
import type { AppDeps } from './app.ts';
import { escapeHtml } from './merge-render.ts';
import { COUNTRY_NAME, countryOf, storeExtensionId, storeUrl } from './countries.ts';

const EXTENSION_ID = /^[a-p]{32}$/;
type Lang = 'en' | 'fr-CA';

interface PackInfo { version: string; extensionId: string; file: string; sha256: string; size: number; builtAt: string }

/** Where the packed zip lives: apps/extension/pack, written by `npm run pack --workspace @pii/extension`. */
export function packDir(): string {
  return process.env.EXTENSION_PACK_DIR ?? fileURLToPath(new URL('../../extension/pack', import.meta.url));
}

export function packInfo(): PackInfo | null {
  const p = join(packDir(), 'pii-extension.json');
  if (!existsSync(p)) return null;
  try {
    const info = JSON.parse(readFileSync(p, 'utf8')) as PackInfo;
    return existsSync(join(packDir(), info.file)) ? info : null;
  } catch { return null; }
}

const COPY = {
  en: {
    title: 'Install the PII Gmail extension', intro: 'The extension puts PII beside your Gmail conversations. Install it once, then sign in with the same Google account you use for Gmail.',
    signIn: 'Sign in to PII first, then open this page again.', signInLink: 'Sign in',
    installed: (v: string) => `The extension is installed and has connected (version ${v}). You are all set.`,
    notYet: 'We have not seen the extension yet. Follow the steps below, then open Gmail once.',
    unavailable: 'The extension is not available on this server yet. Ask your administrator.',
    s1: 'Download and check', s1Body: 'Download the zip. Check that its SHA-256 value matches the one shown here.', download: 'Download the extension (zip)', version: 'Version', sha: 'SHA-256', size: 'Size',
    s2: 'Unzip it to a folder you will keep', s2Body: 'For example Documents/PII-extension. Do not delete the folder afterwards: Chrome reads the extension from it.',
    s3: 'Load it in Chrome', s3Body: 'Open chrome://extensions, turn on Developer mode (top right), click Load unpacked, and choose the folder.',
    s4: 'Sign in', s4Body: 'Open Gmail, click the PII icon, and sign in to PII with the same Google account.',
    note: 'Chrome may warn about developer-mode extensions. That is expected for this copy. When the Chrome Web Store version is available, install that instead and remove this copy.',
    help: (s: string) => `Need help? Write to ${s}.`,
    otherLang: 'Français',
  },
  'fr-CA': {
    title: 'Installer l’extension Gmail de PII', intro: 'L’extension affiche PII à côté de vos conversations Gmail. Installez-la une fois, puis connectez-vous avec le même compte Google que pour Gmail.',
    signIn: 'Connectez-vous d’abord à PII, puis rouvrez cette page.', signInLink: 'Se connecter',
    installed: (v: string) => `L’extension est installée et connectée (version ${v}). Tout est prêt.`,
    notYet: 'Nous n’avons pas encore vu l’extension. Suivez les étapes ci-dessous, puis ouvrez Gmail une fois.',
    unavailable: 'L’extension n’est pas encore disponible sur ce serveur. Demandez à votre administrateur.',
    s1: 'Télécharger et vérifier', s1Body: 'Téléchargez le fichier zip. Vérifiez que sa valeur SHA-256 correspond à celle affichée ici.', download: 'Télécharger l’extension (zip)', version: 'Version', sha: 'SHA-256', size: 'Taille',
    s2: 'Décompressez-le dans un dossier que vous garderez', s2Body: 'Par exemple Documents/PII-extension. Ne supprimez pas ce dossier ensuite : Chrome lit l’extension à partir de lui.',
    s3: 'Chargez-la dans Chrome', s3Body: 'Ouvrez chrome://extensions, activez le mode développeur (en haut à droite), cliquez sur Charger l’extension non empaquetée et choisissez le dossier.',
    s4: 'Connectez-vous', s4Body: 'Ouvrez Gmail, cliquez sur l’icône PII et connectez-vous à PII avec le même compte Google.',
    note: 'Chrome peut afficher un avertissement au sujet des extensions en mode développeur. C’est normal pour cette copie. Quand la version du Chrome Web Store sera disponible, installez-la et retirez cette copie.',
    help: (s: string) => `Besoin d’aide ? Écrivez à ${s}.`,
    otherLang: 'English',
  },
} as const;

const STORE_COPY = {
  en: {
    add: 'Add PII to Chrome', s1: 'Add it from the Chrome Web Store', s1Body: 'Click the button above, then Add to Chrome. Chrome keeps it up to date from then on.',
    s2: 'Open Gmail', s2Body: 'Reload Gmail once. PII appears in the left panel, with its mark in the top bar.',
    s3: 'Sign in', s3Body: 'Click the PII mark, choose your country, and sign in with the same Google account you use for Gmail.',
    zip: 'Installed an earlier copy from a zip file? Remove it in chrome://extensions after adding this one.',
    web: 'No extension? You can also use PII in your browser:', webLink: 'Open PII',
  },
  'fr-CA': {
    add: 'Ajouter PII à Chrome', s1: 'Ajoutez-la depuis le Chrome Web Store', s1Body: 'Cliquez sur le bouton ci-dessus, puis sur Ajouter à Chrome. Chrome la tient ensuite à jour.',
    s2: 'Ouvrez Gmail', s2Body: 'Rechargez Gmail une fois. PII apparaît dans le panneau de gauche, avec sa marque en haut.',
    s3: 'Connectez-vous', s3Body: 'Cliquez sur la marque PII, choisissez votre pays et connectez-vous avec le même compte Google que pour Gmail.',
    zip: 'Vous aviez installé une copie à partir d’un fichier zip? Retirez-la dans chrome://extensions après avoir ajouté celle-ci.',
    web: 'Pas d’extension? Vous pouvez aussi utiliser PII dans votre navigateur :', webLink: 'Ouvrir PII',
  },
} as const;

export function registerExtensionRoutes(app: FastifyInstance, deps: AppDeps): void {
  const run = <T>(ctx: RequestContext, fn: (tx: Tx) => Promise<T>) => withRequestTx(deps.appPool, ctx, fn);

  app.post('/v1/extension/check-in', {
    schema: {
      body: {
        type: 'object',
        required: ['extensionId', 'version'],
        additionalProperties: false,
        properties: {
          extensionId: { type: 'string', pattern: '^[a-p]{32}$' },
          version: { type: 'string', minLength: 1, maxLength: 20 },
        },
      },
    },
  }, async (req, reply) => {
    const { ctx } = await deps.authenticate(req);
    const b = req.body as { extensionId: string; version: string };
    if (!EXTENSION_ID.test(b.extensionId)) return reply.code(400).send({ error: { code: 'invalid', message: 'Unknown extension ID' } });
    await run(ctx, (tx) => tx.query(
      `INSERT INTO extension_installs (tenant_id, user_id, extension_id, version) VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, extension_id) DO UPDATE SET version = EXCLUDED.version, last_seen_at = now()`,
      [ctx.tenantId, ctx.userId, b.extensionId, b.version],
    ));
    // The first install is recorded on the partner's onboarding cases (auth pool, like the sign-in does).
    await deps.authPool.query(
      `UPDATE onboarding_cases SET extension_installed_at = now()
        WHERE extension_installed_at IS NULL AND tenant_id = $1
          AND node_id IN (SELECT node_id FROM user_node_roles WHERE user_id = $2)`,
      [ctx.tenantId, ctx.userId],
    );
    return reply.code(204).send();
  });

  // The two ways in, for invitation emails written in the app: the Chrome Web Store (else the install page) and the web app.
  app.get('/v1/access-links', async (req) => {
    await deps.authenticate(req);
    const c = countryOf(deps.config.region);
    return { installUrl: storeUrl() ?? `${deps.config.appOrigin}/install`, appUrl: `${deps.config.appOrigin}/app`, country: COUNTRY_NAME[c] };
  });

  // What this person's install looks like, for the install page and the partner's checklist.
  app.get('/v1/extension/status', async (req) => {
    const { ctx } = await deps.authenticate(req);
    const row = (await run(ctx, (tx) => tx.query<{ version: string; last_seen_at: string }>(
      `SELECT version, last_seen_at FROM extension_installs WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 1`, [ctx.userId]))).rows[0];
    // A copy loaded from the old zip (any extension ID but the store's) seen in the last two weeks: the app asks them to switch.
    const storeId = storeExtensionId();
    const zipSeen = storeId ? (await run(ctx, (tx) => tx.query(
      `SELECT 1 FROM extension_installs WHERE user_id = $1 AND extension_id <> $2 AND last_seen_at > now() - interval '14 days' LIMIT 1`, [ctx.userId, storeId]))).rowCount! > 0 : false;
    return { installed: Boolean(row), version: row?.version ?? null, lastSeenAt: row?.last_seen_at ?? null, storeUrl: storeUrl(), zipCopySeen: zipSeen };
  });

  app.get('/v1/extension/info', async (req) => {
    await deps.authenticate(req);
    const info = packInfo();
    return info
      ? { available: true, version: info.version, extensionId: info.extensionId, sha256: info.sha256, size: info.size, builtAt: info.builtAt }
      : { available: false };
  });

  // The zip copy. Signed-in people only: the person got here through their invitation.
  app.get('/v1/extension/download', async (req, reply) => {
    await deps.authenticate(req);
    if (storeUrl()) return reply.code(410).send({ error: { code: 'gone', message: 'Install PII from the Chrome Web Store instead', storeUrl: storeUrl() } });
    const info = packInfo();
    if (!info) return reply.code(404).send({ error: { code: 'not_found', message: 'The extension is not available on this server yet' } });
    return reply.type('application/zip').header('cache-control', 'no-store').header('content-disposition', `attachment; filename="${info.file}"`)
      .send(readFileSync(join(packDir(), info.file)));
  });

  app.get('/install', async (req, reply) => {
    const q = (req.query as { lang?: string }).lang;
    const lang: Lang = q ? (q.startsWith('fr') ? 'fr-CA' : 'en') : (String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('fr') ? 'fr-CA' : 'en');
    const t = COPY[lang];
    const other: Lang = lang === 'fr-CA' ? 'en' : 'fr-CA';
    const send = (code: number, body: string) => reply.code(code).type('text/html; charset=utf-8').header('cache-control', 'no-store').header('x-robots-tag', 'noindex, nofollow')
      .send(shell(lang, t.title, deps.config.productDisplayName, body, other, t.otherLang));
    // The Chrome Web Store copy, when its listing is set: anyone may see this page, and no zip is offered.
    const store = storeUrl();
    if (store) {
      const s = STORE_COPY[lang];
      return send(200, `
      <h1>${t.title}</h1>
      <p>${t.intro}</p>
      <p><a class="btn" href="${escapeHtml(store)}" target="_blank" rel="noopener">${s.add}</a></p>
      <ol class="steps">
        <li><b>${s.s1}</b><p>${s.s1Body}</p></li>
        <li><b>${s.s2}</b><p>${s.s2Body}</p></li>
        <li><b>${s.s3}</b><p>${s.s3Body}</p></li>
      </ol>
      <p class="muted">${s.zip}</p>
      <p class="muted">${s.web} <a href="/app">${s.webLink}</a></p>
      <p class="muted">${escapeHtml(t.help(deps.config.supportEmail))}</p>`);
    }
    let id;
    try { id = await deps.authenticate(req); } catch {
      return send(401, `<p>${t.signIn}</p><p><a class="btn" href="/login?lang=${lang === 'fr-CA' ? 'fr-CA' : 'en'}">${t.signInLink}</a></p>`);
    }
    const info = packInfo();
    const status = (await run(id.ctx, (tx) => tx.query<{ version: string }>(
      `SELECT version FROM extension_installs WHERE user_id = $1 ORDER BY last_seen_at DESC LIMIT 1`, [id.ctx.userId]))).rows[0];
    const statusLine = status ? `<p class="ok">${escapeHtml(t.installed(status.version))}</p>` : `<p class="muted">${t.notYet}</p>`;
    const downloadBlock = info
      ? `<p><a class="btn" href="/v1/extension/download">${t.download}</a></p>
         <p class="muted">${t.version}: ${escapeHtml(info.version)} · ${t.size}: ${Math.round(info.size / 1024)} KB · ${t.sha}: <code>${escapeHtml(info.sha256)}</code></p>`
      : `<p class="muted">${t.unavailable}</p>`;
    return send(200, `
      <h1>${t.title}</h1>
      <p>${t.intro}</p>
      ${statusLine}
      <ol class="steps">
        <li><b>${t.s1}</b><p>${t.s1Body}</p>${downloadBlock}</li>
        <li><b>${t.s2}</b><p>${t.s2Body}</p></li>
        <li><b>${t.s3}</b><p>${t.s3Body}</p></li>
        <li><b>${t.s4}</b><p>${t.s4Body}</p></li>
      </ol>
      <p class="muted">${t.note}</p>
      <p class="muted">${escapeHtml(t.help(deps.config.supportEmail))}</p>`);
  });
}

function shell(lang: Lang, title: string, product: string, body: string, other: Lang, otherLabel: string): string {
  return `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)} · ${escapeHtml(product)}</title>
<style>
body{margin:0;font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1d1d1f;background:#fff}
main{max-width:680px;margin:0 auto;padding:24px 16px 48px}
h1{font-size:24px;margin:8px 0 12px}
.steps{padding-left:20px}.steps li{margin:0 0 18px}.steps p{margin:4px 0}
.btn{display:inline-block;background:#1f3a8a;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600}
.muted{color:#6b6b72;font-size:14px}.ok{color:#0a6b2b;font-weight:600}
code{word-break:break-all;font-size:12px}
.lang{float:right;font-size:14px}
</style></head><body><main>
<p class="lang"><a href="/install?lang=${other}">${escapeHtml(otherLabel)}</a></p>
${body}
</main></body></html>`;
}
