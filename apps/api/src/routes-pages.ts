import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';
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
    const q = req.query as { signed_in?: string };
    const body = q.signed_in
      ? '<p><b>You are signed in.</b></p><p>You can close this tab and return to Gmail. Open an email and use the PII panel.</p>'
      : '<p>Open Gmail with the PII extension installed to get started.</p>';
    return reply.type('text/html; charset=utf-8').send(page(product, body, product));
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

  for (const file of ['logo.png', 'icon-128.png']) {
    app.get(`/brand/${file}`, async (_req, reply) => {
      const data = await readFile(new URL(`../public/brand/${file}`, import.meta.url));
      return reply.type('image/png').header('cache-control', 'public, max-age=86400').send(data);
    });
  }
}
