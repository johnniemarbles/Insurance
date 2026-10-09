import { StandardFonts, type PDFDocument, type PDFFont, type PDFPage, type RGB } from 'pdf-lib';
import { loadFallbacks } from './certificate-pdf.ts';

type Face = { font: PDFFont; has: Set<number> };
export interface Run { t: string; font: PDFFont }
const drawable = (s: string) => /^[\x20-\x7E\xA0-\xFF\n]*$/.test(s);
const tidy = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');

/**
 * Text for generated PDFs. Standard Helvetica draws Latin text; when `probe` (all the text the document will hold)
 * contains Gurmukhi, Devanagari or other characters it cannot draw, embedded Noto faces are used for those characters.
 * A character in no face prints as ?.
 */
export async function pdfText(doc: PDFDocument, probe: string) {
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const uni: { regular: Face[]; bold: Face[] } | null = drawable(tidy(probe)) ? null : { regular: await loadFallbacks(doc, 400), bold: await loadFallbacks(doc, 700) };
  const known = (ch: string, set: Face[]) => drawable(ch) || set.some((f) => f.has.has(ch.codePointAt(0)!));
  const clean = (s: string) => { const t = tidy(s); return [...t].map((ch) => (known(ch, uni ? uni.regular : []) ? ch : '?')).join(''); };
  const runs = (text: string, f: PDFFont): Run[] => {
    const t = clean(text);
    if (!uni || drawable(t)) return [{ t, font: f }];
    const set = f === bold ? uni.bold : uni.regular;
    const out: Run[] = [];
    for (const ch of t) {
      const face = drawable(ch) ? f : (set.find((x) => x.has.has(ch.codePointAt(0)!))?.font ?? f);
      const last = out[out.length - 1];
      if (last && last.font === face) last.t += ch; else out.push({ t: ch, font: face });
    }
    return out;
  };
  const width = (r: Run[], sz: number) => r.reduce((a, x) => a + x.font.widthOfTextAtSize(x.t, sz), 0);
  const draw = (page: PDFPage, r: Run[], x: number, y: number, size: number, color: RGB) => { for (const p of r) { page.drawText(p.t, { x, y, size, font: p.font, color }); x += p.font.widthOfTextAtSize(p.t, size); } };
  return { font, bold, clean, runs, width, draw };
}
