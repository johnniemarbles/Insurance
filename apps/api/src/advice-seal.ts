import { createHash, randomUUID } from 'node:crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Tx } from '@pii/db';
import { ADVICE_LABELS, gateTypeFor, type AdviceKind, type RequestContext } from '@pii/domain';
import { seal, type KeyProvider } from '@pii/platform';
import { audit } from './audit.ts';

export interface SealInput {
  adviceId: string; boxId: string; kind: AdviceKind; title: string; body: string; clientName: string; clientEmail: string | null; contentHash: string;
  firm: string; method: 'otp'; typedName: string | null; ip: string | null; agent: string | null; signer: 'client' | 'advisor';
}
const clean = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...').replace(/[^\x20-\x7E\xA0-\xFF\n]/g, '?');

/** The advice wording as a PDF with no signature page, for sending to a vendor to be signed. */
export async function unsignedAdvicePdf(i: Pick<SealInput, 'kind' | 'title' | 'body' | 'clientName' | 'firm'>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 54;
  let page = doc.addPage([W, H]); let y = H - M;
  const wrap = (text: string, f = font, sz = 10.5, color = rgb(0.1, 0.1, 0.1)) => {
    for (const para of clean(text).split('\n')) {
      let cur = '';
      const flush = () => { if (y < M + 15) { page = doc.addPage([W, H]); y = H - M; } page.drawText(cur, { x: M, y, size: sz, font: f, color }); y -= sz + 4; cur = ''; };
      for (const w of para.split(' ')) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, sz) > W - 2 * M && cur) { flush(); cur = w; } else cur = t; }
      flush();
    }
  };
  wrap(i.firm, bold, 10, rgb(0.35, 0.35, 0.35)); y -= 4;
  wrap(i.title, bold, 17); wrap(`${ADVICE_LABELS[i.kind].en} - prepared for ${i.clientName}`, font, 10, rgb(0.35, 0.35, 0.35)); y -= 8;
  wrap(i.body);
  doc.setTitle(clean(i.title)); doc.setProducer('PII');
  return doc.save();
}

/** The signed advice as a PDF with a signature page: who signed, when, how, from where, and the fingerprint of the wording. */
export async function sealedAdvicePdf(i: SealInput, signedAt: Date): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica); const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 54, size = 10.5, lead = 15;
  let page = doc.addPage([W, H]); let y = H - M;
  const ensure = () => { if (y < M + lead) { page = doc.addPage([W, H]); y = H - M; } };
  const wrap = (text: string, f = font, sz = size, color = rgb(0.1, 0.1, 0.1), gap = 4) => {
    for (const para of clean(text).split('\n')) {
      let cur = '';
      const flush = () => { ensure(); page.drawText(cur, { x: M, y, size: sz, font: f, color }); y -= sz + gap; cur = ''; };
      for (const w of para.split(' ')) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, sz) > W - 2 * M && cur) { flush(); cur = w; } else cur = t; }
      flush();
    }
  };
  wrap(i.firm, bold, 10, rgb(0.35, 0.35, 0.35)); y -= 4;
  wrap(i.title, bold, 17); wrap(`${ADVICE_LABELS[i.kind].en} - prepared for ${i.clientName}`, font, 10, rgb(0.35, 0.35, 0.35)); y -= 8;
  wrap(i.body);
  // Signature page
  page = doc.addPage([W, H]); y = H - M;
  wrap('Signature record', bold, 15); y -= 6;
  const rows: [string, string][] = [
    ['Signed by', i.typedName ?? i.clientName], ['Client on file', `${i.clientName}${i.clientEmail ? ` <${i.clientEmail}>` : ''}`],
    ['Signed at (UTC)', signedAt.toISOString()], ['Method', 'One-time code sent to the client\'s email address'],
    ['Recorded by', i.signer === 'client' ? 'The client, on their private signing link' : 'The advisor, with the code the client gave them'],
    ['From address', i.ip ?? 'not recorded'], ['Device', (i.agent ?? 'not recorded').slice(0, 120)],
    ['Fingerprint of the wording (SHA-256)', i.contentHash], ['Record', i.adviceId],
  ];
  for (const [k, v] of rows) { wrap(k, bold, 9, rgb(0.35, 0.35, 0.35), 1); wrap(v, font, 10.5, rgb(0.1, 0.1, 0.1), 7); }
  y -= 6;
  wrap('The fingerprint above is calculated from the title, wording, client name and email shown in this document. A change to any of them gives a different fingerprint. The SHA-256 of this PDF file is kept in the audit package manifest.', font, 9, rgb(0.35, 0.35, 0.35));
  doc.setTitle(clean(i.title)); doc.setProducer('PII'); doc.setCreationDate(signedAt);
  return doc.save();
}

/** Seal one advice record: file the PDF as typed paperwork and lock the record as signed. Runs inside the caller's transaction. */
export async function sealAdvice(tx: Tx, ctx: RequestContext, keys: KeyProvider | undefined, i: SealInput): Promise<{ documentId: string | null }> {
  const now = new Date();
  let documentId: string | null = null; let sha: string | null = null;
  if (keys) {
    const pdf = Buffer.from(await sealedAdvicePdf(i, now));
    sha = createHash('sha256').update(pdf).digest('hex');
    documentId = randomUUID();
    const sealed = seal(keys, pdf, `${ctx.tenantId}:doc:${documentId}`);
    await tx.query(`INSERT INTO box_documents (id, tenant_id, box_id, name, mime, size_bytes, data_enc, key_id, uploaded_by, doc_type) VALUES ($1,$2,$3,$4,'application/pdf',$5,$6,$7,$8,$9)`,
      [documentId, ctx.tenantId, i.boxId, `${i.title.replace(/[^\w .-]/g, '_').slice(0, 150)} (signed).pdf`, pdf.length, sealed.data, sealed.keyId, ctx.userId, gateTypeFor(i.kind)]);
  }
  await tx.query(`UPDATE advice_records SET status = 'signed', signed_at = $2, signed_method = 'otp', document_id = $3, otp_hash = NULL, otp_expires_at = NULL, signer_typed_name = $4, signer_ip = $5, signer_agent = $6, document_sha256 = $7, updated_at = now() WHERE id = $1`,
    [i.adviceId, now.toISOString(), documentId, i.typedName, i.ip, i.agent?.slice(0, 300) ?? null, sha]);
  await audit(tx, ctx, 'advice_signed', 'box', i.boxId, { adviceId: i.adviceId, method: 'otp', signer: i.signer, contentHash: i.contentHash, documentSha256: sha, ip: i.ip });
  return { documentId };
}
