import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { withRequestTx, type Tx } from '@pii/db';
import { ADVICE_LABELS, OTP_MAX_ATTEMPTS, OTP_MINUTES, consentStates, type AdviceKind, type RequestContext } from '@pii/domain';
import { audit } from './audit.ts';
import { sealAdvice } from './advice-seal.ts';
import { actingAs } from './effects.ts';
import { HttpError, invalid, notFound } from './errors.ts';
import { requireCrm, requireEdit, uuid } from './crm-helpers.ts';
import type { AppDeps } from './app.ts';

const LINK_DAYS = 7;
const MAX_SENDS = 5;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const tokenHash = (t: string) => createHash('sha256').update(t).digest();
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const mask = (e: string | null) => (e ? e.replace(/^(.).*(@.*)$/, '$1***$2') : '');

interface Link { id: string; tenant_id: string; advice_id: string; created_by: string; node_id: string; expires_at: Date; otp_hash: string | null; otp_expires_at: Date | null; otp_attempts: number; sends: number; used_at: Date | null }
interface Adv { id: string; box_id: string; kind: AdviceKind; title: string; body: string; client_name: string; client_email: string | null; status: string; content_hash: string | null; tier: string }

/** The client side of signing: a private link, a code sent to the email on file, and a sealed PDF. Plus the advisor's button that makes the link. */
export function registerSignRoutes(app: FastifyInstance, deps: AppDeps): void {
  const idp = { type: 'object', properties: { id: uuid } } as const;
  const tokenP = { type: 'object', properties: { token: { type: 'string', pattern: '^[A-Za-z0-9_-]{20,80}$' } } } as const;
  const actor = (l: Link): RequestContext => ({ ...actingAs(l.tenant_id, l.created_by, l.node_id), isTenantAdmin: true });
  const contentHash = (a: Adv) => sha(JSON.stringify({ box: a.box_id, kind: a.kind, title: a.title, body: a.body, client: a.client_name, email: a.client_email ?? '' }));

  async function linkFor(token: string): Promise<Link> {
    const l = (await deps.authPool.query<Link>('SELECT * FROM signing_links WHERE token_hash = $1', [tokenHash(token)])).rows[0];
    if (!l || l.used_at || l.expires_at.getTime() < Date.now()) throw notFound('This signing link is not valid any more. Ask your advisor for a new one.');
    return l;
  }
  const loadAdvice = async (tx: Tx, id: string) => {
    const a = (await tx.query<Adv>('SELECT id, box_id, kind, title, body, client_name, client_email, status, content_hash, tier FROM advice_records WHERE id = $1', [id])).rows[0];
    if (!a) throw notFound('Not found');
    return a;
  };

  // ---- the advisor makes a link ----
  app.post('/v1/advice/:id/signing-link', { schema: { params: idp } }, async (req) => {
    const { ctx } = await deps.authenticate(req);
    requireCrm(ctx);
    const { id } = req.params as { id: string };
    const info = await withRequestTx(deps.appPool, ctx, async (tx) => {
      const r = (await tx.query<Adv & { owner_node_id: string }>('SELECT a.id, a.box_id, a.kind, a.title, a.body, a.client_name, a.client_email, a.status, a.content_hash, a.tier, b.owner_node_id FROM advice_records a JOIN boxes b ON b.id = a.box_id WHERE a.id = $1', [id])).rows[0];
      if (!r) throw notFound('Advice record not found');
      requireEdit(ctx, r.owner_node_id);
      if (r.tier !== 'builtin') throw new HttpError(409, 'needs_vendor', 'This kind of paperwork must be signed through a certified e-signature vendor.');
      if (r.status === 'signed') throw new HttpError(409, 'advice_locked', 'Already signed');
      if (!r.client_email) throw invalid('Add the client’s email address first');
      const cs = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>(`SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 AND kind = 'electronic_comms' ORDER BY created_at`, [r.box_id])).rows;
      const canEmail = !consentStates(cs).withdrawn.includes('electronic_comms');
      await audit(tx, ctx, 'signing_link_created', 'box', r.box_id, { adviceId: id });
      const firm = (await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
      return { r, canEmail, firm };
    });
    const token = randomBytes(24).toString('base64url');
    const expires = new Date(Date.now() + LINK_DAYS * 86_400_000);
    await deps.authPool.query('DELETE FROM signing_links WHERE advice_id = $1 AND used_at IS NULL', [id]);
    await deps.authPool.query('INSERT INTO signing_links (tenant_id, advice_id, created_by, node_id, token_hash, expires_at) VALUES ($1,$2,$3,$4,$5,$6)', [ctx.tenantId, id, ctx.userId, ctx.nodeIds[0], tokenHash(token), expires]);
    const url = `${deps.config.appOrigin}/sign/${token}`;
    let emailed = false;
    if (deps.mailer && info.canEmail) {
      const text = `Hello ${info.r.client_name},\n\n${info.firm} has prepared “${info.r.title}” for you. Please read it and sign here:\n${url}\n\nThe link works for ${LINK_DAYS} days. If you were not expecting this, ignore this email.`;
      try { await deps.mailer.send({ to: info.r.client_email!, subject: `Please review and sign: ${info.r.title}`, text, html: `<p>${esc(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br>')}</p>` }); emailed = true; } catch { emailed = false; }
    }
    return { url, expiresAt: expires.toISOString(), emailed, emailBlocked: !info.canEmail };
  });

  // ---- the client's page ----
  app.get('/sign/:token', { schema: { params: tokenP } }, async (req, reply) => {
    const nonce = randomBytes(12).toString('base64');
    return reply.type('text/html; charset=utf-8').header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
      .header('content-security-policy', `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`)
      .send(signPage(nonce));
  });

  const fail = (reply: FastifyReply, e: unknown) => { throw e; void reply; };

  app.get('/v1/public/sign/:token', { schema: { params: tokenP } }, async (req) => {
    const { token } = req.params as { token: string };
    const l = await linkFor(token);
    const firm = (await deps.authPool.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [l.tenant_id])).rows[0]?.name ?? '';
    return withRequestTx(deps.appPool, actor(l), async (tx) => {
      const a = await loadAdvice(tx, l.advice_id);
      return { firm, title: a.title, kind: ADVICE_LABELS[a.kind], body: a.body, clientName: a.client_name, emailHint: mask(a.client_email), signed: a.status === 'signed', codeSent: !!l.otp_hash && !!l.otp_expires_at && l.otp_expires_at.getTime() > Date.now(), minutes: OTP_MINUTES };
    });
  });

  app.post('/v1/public/sign/:token/code', { schema: { params: tokenP } }, async (req) => {
    const { token } = req.params as { token: string };
    const l = await linkFor(token);
    if (l.sends >= MAX_SENDS) throw new HttpError(429, 'too_many_codes', 'Too many codes were sent. Ask your advisor for a new link.');
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const info = await withRequestTx(deps.appPool, actor(l), async (tx) => {
      const a = await loadAdvice(tx, l.advice_id);
      if (a.status === 'signed') throw new HttpError(409, 'advice_locked', 'This has already been signed.');
      const cs = (await tx.query<{ kind: string; createdAt: string; withdrawnAt: string | null }>(`SELECT kind, created_at AS "createdAt", withdrawn_at AS "withdrawnAt" FROM client_consents WHERE box_id = $1 AND kind = 'electronic_comms' ORDER BY created_at`, [a.box_id])).rows;
      if (consentStates(cs).withdrawn.includes('electronic_comms')) throw new HttpError(409, 'comms_withdrawn', 'Electronic messages are turned off for this file. Please contact your advisor to sign another way.');
      await tx.query(`UPDATE advice_records SET status = 'awaiting_signature', content_hash = $2, updated_at = now() WHERE id = $1`, [a.id, contentHash(a)]);
      return a;
    });
    await deps.authPool.query(`UPDATE signing_links SET otp_hash = $2, otp_expires_at = now() + ($3 || ' minutes')::interval, otp_attempts = 0, sends = sends + 1 WHERE id = $1`, [l.id, sha(`${code}:${l.id}`), String(OTP_MINUTES)]);
    let sent = false;
    if (deps.mailer && info.client_email) {
      const text = `Your confirmation code for “${info.title}” is ${code}. It expires in ${OTP_MINUTES} minutes. Enter it on the signing page only.`;
      try { await deps.mailer.send({ to: info.client_email, subject: `Your confirmation code: ${code}`, text, html: `<p>${esc(text)}</p>` }); sent = true; } catch { sent = false; }
    }
    return { sent, minutes: OTP_MINUTES, ...(deps.config.appEnv === 'test' ? { devCode: code } : {}) };
  });

  app.post('/v1/public/sign/:token/confirm', {
    schema: { params: tokenP, body: { type: 'object', required: ['code', 'typedName', 'agree'], additionalProperties: false, properties: { code: { type: 'string', pattern: '^[0-9]{6}$' }, typedName: { type: 'string', minLength: 2, maxLength: 200 }, agree: { const: true } } } },
  }, async (req) => {
    const { token } = req.params as { token: string };
    const b = req.body as { code: string; typedName: string };
    const l = await linkFor(token);
    if (!l.otp_hash || !l.otp_expires_at) throw new HttpError(409, 'not_awaiting', 'Ask for a code first.');
    if (l.otp_attempts >= OTP_MAX_ATTEMPTS) throw new HttpError(429, 'too_many_attempts', 'Too many wrong codes. Ask for a new code.');
    if (l.otp_expires_at.getTime() < Date.now()) throw new HttpError(409, 'code_expired', 'That code has expired. Ask for a new one.');
    if (!timingSafeEqual(Buffer.from(sha(`${b.code}:${l.id}`)), Buffer.from(l.otp_hash))) {
      await deps.authPool.query('UPDATE signing_links SET otp_attempts = otp_attempts + 1 WHERE id = $1', [l.id]);
      throw new HttpError(422, 'wrong_code', 'That code is not right.');
    }
    const ctx = actor(l);
    await withRequestTx(deps.appPool, ctx, async (tx) => {
      const a = await loadAdvice(tx, l.advice_id);
      if (a.status === 'signed') throw new HttpError(409, 'advice_locked', 'This has already been signed.');
      const firm = (await tx.query<{ name: string }>('SELECT name FROM tenants WHERE id = $1', [ctx.tenantId])).rows[0]?.name ?? '';
      await sealAdvice(tx, ctx, deps.keys, { adviceId: a.id, boxId: a.box_id, kind: a.kind, title: a.title, body: a.body, clientName: a.client_name, clientEmail: a.client_email, contentHash: a.content_hash ?? contentHash(a), firm, method: 'otp', typedName: b.typedName.trim(), ip: req.ip, agent: String(req.headers['user-agent'] ?? ''), signer: 'client' });
    });
    await deps.authPool.query('UPDATE signing_links SET used_at = now(), otp_hash = NULL WHERE id = $1', [l.id]);
    return { ok: true };
  });
  void fail;
}

function signPage(nonce: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Review and sign</title>
<style>body{margin:0;background:#f3f4f6;font:16px/1.55 system-ui,sans-serif;color:#1f2937}main{max-width:720px;margin:0 auto;padding:16px}.card{background:#fff;border-radius:12px;padding:20px 22px;margin:14px 0;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:22px;margin:0 0 4px}.firm{font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280}pre{white-space:pre-wrap;font:inherit;margin:12px 0 0}label{display:block;margin:12px 0 4px;font-weight:600}
input[type=text]{width:100%;box-sizing:border-box;padding:10px;font:inherit;border:1px solid #9ca3af;border-radius:8px}button{font:600 16px system-ui;background:#1d4ed8;color:#fff;border:0;border-radius:8px;padding:11px 18px;cursor:pointer;margin-top:12px}button:disabled{opacity:.5}
.err{color:#b3261e;font-weight:600;margin-top:10px}.ok{color:#137333;font-weight:700}.muted{color:#6b7280;font-size:14px}.lang{float:right;background:none;color:#1d4ed8;margin:0;padding:0;font-size:14px}</style></head><body><main>
<div class="card" id="doc"><button class="lang" id="lang" type="button">Français</button><div class="muted" id="loading">…</div></div><div class="card" id="sign" hidden></div></main>
<script nonce="${nonce}">
(function(){
var T={en:{sign:'Sign',read:'Read the document above. When you are ready, we will send a 6-digit code to your email address on file (',send:'Send me a code',sent:'A code was sent. It works for ',min:' minutes.',code:'6-digit code',name:'Type your full name',agree:'I have read this document and I agree to sign it electronically.',go:'Sign',done:'Signed. Thank you. Your advisor has the signed copy; you can close this page.',already:'This document has already been signed.',gone:'This signing link is not valid any more. Ask your advisor for a new one.',fail:'Something went wrong. Please try again.',lang:'Français',dev:'Test code: '},
fr:{sign:'Signer',read:'Lisez le document ci-dessus. Lorsque vous êtes prêt, nous enverrons un code à 6 chiffres à votre adresse courriel au dossier (',send:'Envoyez-moi un code',sent:'Un code a été envoyé. Il est valide ',min:' minutes.',code:'Code à 6 chiffres',name:'Écrivez votre nom complet',agree:'J’ai lu ce document et j’accepte de le signer électroniquement.',go:'Signer',done:'Signé. Merci. Votre conseiller a la copie signée; vous pouvez fermer cette page.',already:'Ce document a déjà été signé.',gone:'Ce lien de signature n’est plus valide. Demandez-en un nouveau à votre conseiller.',fail:'Une erreur est survenue. Veuillez réessayer.',lang:'English',dev:'Code de test : '}};
var L=(navigator.language||'en').toLowerCase().indexOf('fr')===0?'fr':'en';var token=location.pathname.split('/').pop();var data=null;
function $(i){return document.getElementById(i)}function el(t,p,c){var e=document.createElement(t);if(p)for(var k in p)e[k]=p[k];(c||[]).forEach(function(x){e.append(x)});return e}
function api(path,body){return fetch('/v1/public/sign/'+token+path,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{}).then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j&&j.message||T[L].fail);return j})})}
function msg(box,t,cls){var m=box.querySelector('.msg');if(!m){m=el('div',{className:'msg'});box.append(m)}m.className='msg '+(cls||'err');m.textContent=t}
function render(){var d=data,doc=$('doc');doc.textContent='';doc.append(el('button',{id:'lang',className:'lang',type:'button',textContent:T[L].lang,onclick:function(){L=L==='fr'?'en':'fr';render()}}),el('div',{className:'firm',textContent:d.firm}),el('h1',{textContent:d.title}),el('div',{className:'muted',textContent:d.kind[L==='fr'?'fr-CA':'en']+' · '+d.clientName}),el('pre',{textContent:d.body}));
var s=$('sign');s.hidden=false;s.textContent='';if(d.signed){s.append(el('div',{className:'ok',textContent:T[L].already}));return}
s.append(el('p',{textContent:T[L].read+d.emailHint+').'}));var send=el('button',{type:'button',textContent:T[L].send,onclick:function(){send.disabled=true;api('/code',{}).then(function(r){msg(s,T[L].sent+r.minutes+T[L].min+(r.devCode?' '+T[L].dev+r.devCode:''),'ok');form()}).catch(function(e){send.disabled=false;msg(s,e.message)})}});s.append(send);if(d.codeSent)form();
function form(){if($('f'))return;var f=el('div',{id:'f'});var code=el('input',{type:'text',id:'code',inputMode:'numeric',maxLength:6,autocomplete:'one-time-code'});var nm=el('input',{type:'text',id:'nm',autocomplete:'name'});var ag=el('input',{type:'checkbox',id:'ag'});var go=el('button',{type:'button',textContent:T[L].go,onclick:function(){go.disabled=true;api('/confirm',{code:code.value.trim(),typedName:nm.value.trim(),agree:ag.checked}).then(function(){s.textContent='';s.append(el('div',{className:'ok',textContent:T[L].done}))}).catch(function(e){go.disabled=false;msg(s,e.message)})}});
f.append(el('label',{htmlFor:'code',textContent:T[L].code}),code,el('label',{htmlFor:'nm',textContent:T[L].name}),nm,el('label',{},[ag,' '+T[L].agree]),go);s.append(f)}}
api('').then(function(d){data=d;render()}).catch(function(e){$('loading').textContent=e.message||T[L].gone});
})();
</script></body></html>`;
}
