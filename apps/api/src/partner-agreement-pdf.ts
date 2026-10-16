import { createHash } from 'node:crypto';
import { PDFDocument, rgb } from 'pdf-lib';
import { pdfText } from './pdf-text.ts';

export interface PartnerAgreementSeal {
  firm: string; partnerName: string; title: string; body: string; version: string;
  typedName: string; signedAt: Date; ip: string | null; agent: string | null;
  countersigner?: { name: string; signedAt: Date } | null;
}

/** The fingerprint of the agreement wording, so the signed copy can be matched to exactly what was shown. */
export const agreementHash = (title: string, body: string, version: string): string =>
  createHash('sha256').update(JSON.stringify({ title, body, version })).digest('hex');

/** The signed agency agreement as a PDF with a signature page: who signed, when, from where, and the wording fingerprint. */
export async function sealedPartnerAgreementPdf(i: PartnerAgreementSeal): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const tk = await pdfText(doc, [i.firm, i.partnerName, i.title, i.body, i.typedName, i.ip ?? '', i.agent ?? ''].join(' '));
  const font = tk.font, bold = tk.bold;
  const W = 595, H = 842, M = 54;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const grey = rgb(0.35, 0.35, 0.35);
  const newPage = () => { page = doc.addPage([W, H]); y = H - M; };
  const wrap = (text: string, f = font, sz = 10.5, color = rgb(0.1, 0.1, 0.1)) => {
    for (const para of text.split('\n')) {
      let cur = '';
      const flush = () => {
        if (y < M + 15) newPage();
        tk.draw(page, tk.runs(cur, f), M, y, sz, color);
        y -= sz + 4;
        cur = '';
      };
      for (const w of para.split(' ')) {
        const t = cur ? `${cur} ${w}` : w;
        if (tk.width(tk.runs(t, f), sz) > W - 2 * M && cur) { flush(); cur = w; } else cur = t;
      }
      flush();
    }
  };

  wrap(i.firm, bold, 10, grey);
  y -= 4;
  wrap(i.title, bold, 17);
  wrap(`Agency agreement, version ${i.version}. Prepared for ${i.partnerName}.`, font, 10, grey);
  y -= 8;
  wrap(i.body);

  y -= 18;
  if (y < M + 160) newPage();
  wrap('Signature', bold, 13);
  y -= 4;
  wrap(`Signed by: ${i.typedName}`);
  wrap(`For: ${i.partnerName}`);
  wrap(`Signed on: ${i.signedAt.toISOString()}`);
  wrap(`Signed from: ${i.ip ?? 'not recorded'}${i.agent ? ` (${i.agent})` : ''}`);
  wrap('Method: one-time code sent to the email on file, then typed name', font, 10, grey);
  if (i.countersigner) {
    y -= 6;
    wrap(`Countersigned by: ${i.countersigner.name}`);
    wrap('For: Punjab Insurance Inc.');
    wrap(`Countersigned on: ${i.countersigner.signedAt.toISOString()}`);
    wrap('Method: signed in PII by the compliance manager named on the agreement', font, 10, grey);
  }
  wrap(`Wording fingerprint (SHA-256): ${agreementHash(i.title, i.body, i.version)}`, font, 8.5, grey);

  doc.setTitle(tk.clean(i.title));
  doc.setProducer('PII');
  return doc.save();
}
