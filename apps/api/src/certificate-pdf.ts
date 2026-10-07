import { readFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export interface CertRow { code: string; issued_at: Date; learner: string; course: string; company: string; hours: string | null; category: string | null; pack: string | null; locale: string; version: number | null }

/** Straight quotes and dashes for the typographic ones; anything the standard fonts cannot draw makes the whole certificate fall back. */
const tidy = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');
const drawable = (s: string) => /^[\x20-\x7E\xA0-\xFF]*$/.test(s);

/** An A4 landscape certificate. Returns null when a name or title uses characters the PDF's standard fonts cannot draw. */
export async function certificatePdf(c: CertRow, entity: string, logoPath: string): Promise<Uint8Array | null> {
  const fr = c.locale === 'fr-CA';
  const T = fr
    ? { title: 'Attestation de formation', cert: 'Nous attestons que', did: 'a terminé avec succès', at: 'de', ce: 'Heures de formation continue', cat: 'Catégorie', date: 'Délivrée le', code: 'Code de vérification', valid: 'Authentique : émise par' }
    : { title: 'Certificate of completion', cert: 'This certifies that', did: 'has successfully completed', at: 'at', ce: 'Continuing education hours', cat: 'Category', date: 'Issued', code: 'Verification code', valid: 'Genuine. Issued by' };
  const learner = tidy(c.learner), course = tidy(c.course) + (c.version ? ` (v${c.version})` : ''), company = tidy(c.company), ent = tidy(entity);
  const when = c.issued_at.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const ceLine = c.hours ? `${T.ce}: ${Number(c.hours)}  |  ${T.cat}: ${(c.category ?? '').replace('_', ' ')}` : '';
  const lines = [learner, course, company, ceLine, ent, when, ...Object.values(T)];
  if (!lines.every(drawable)) return null;

  const doc = await PDFDocument.create();
  const W = 842, H = 595;
  const page = doc.addPage([W, H]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold), sans = await doc.embedFont(StandardFonts.Helvetica), sansB = await doc.embedFont(StandardFonts.HelveticaBold);
  const blue = rgb(0.114, 0.306, 0.847), grey = rgb(0.29, 0.33, 0.39);
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: blue, borderWidth: 4 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: blue, borderWidth: 1 });
  // Centre a line, shrinking it to fit if it is long.
  const centre = (text: string, y: number, font: typeof serif, size: number, color = rgb(0.12, 0.16, 0.22)) => {
    let sz = size; const max = W - 140;
    while (font.widthOfTextAtSize(text, sz) > max && sz > 8) sz -= 1;
    page.drawText(text, { x: (W - font.widthOfTextAtSize(text, sz)) / 2, y, size: sz, font, color });
  };
  let top = H - 70;
  try {
    const logo = await doc.embedPng(await readFile(logoPath));
    page.drawImage(logo, { x: (W - 64) / 2, y: top - 64, width: 64, height: 64 }); top -= 74;
  } catch { top -= 10; }
  centre(ent.toUpperCase(), top - 12, sansB, 12, grey);
  centre(T.title, top - 56, bold, 34, blue);
  centre(T.cert, top - 92, serif, 16);
  centre(learner, top - 140, bold, 30);
  page.drawLine({ start: { x: 220, y: top - 150 }, end: { x: W - 220, y: top - 150 }, thickness: 0.8, color: rgb(0.82, 0.84, 0.86) });
  centre(T.did, top - 180, serif, 16);
  centre(course, top - 214, bold, 24);
  centre(`${T.at} ${company}`, top - 242, serif, 16);
  if (ceLine) centre(ceLine, top - 280, sansB, 13, blue);
  centre(`${T.date} ${when}   |   ${T.code}: ${c.code}`, 92, sans, 11, grey);
  centre(`${T.valid} ${ent}`, 74, sans, 10, rgb(0.02, 0.37, 0.27));
  doc.setTitle(`${T.title} - ${learner}`); doc.setProducer('PII'); doc.setCreator('PII');
  return doc.save();
}
