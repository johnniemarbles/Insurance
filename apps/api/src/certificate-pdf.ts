import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts, rgb, type PDFFont } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import 'regenerator-runtime/runtime.js';

const NO_POSITIONING = { mark: false, mkmk: false, dist: false, abvm: false, blwm: false, kern: false, curs: false };
const require = createRequire(import.meta.url);
const noto = (pkg: string, file: string) => readFile(require.resolve(`@fontsource/${pkg}/files/${file}`));

export interface CertRow { code: string; issued_at: Date; learner: string; course: string; company: string; hours: string | null; category: string | null; pack: string | null; locale: string; version: number | null }

/** Straight quotes and dashes for the typographic ones; anything the standard fonts cannot draw makes the whole certificate fall back. */
const tidy = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/…/g, '...');
const drawable = (s: string) => /^[\x20-\x7E\xA0-\xFF]*$/.test(s);

/** Fonts for names and titles the standard fonts cannot draw (Gurmukhi, Devanagari, accented capitals): each character uses the first face that has it. */
async function loadFallbacks(doc: PDFDocument, weight: 400 | 700): Promise<{ font: PDFFont; has: Set<number> }[]> {
  doc.registerFontkit(fontkit);
  const files: [string, string][] = [
    ['noto-sans', `noto-sans-latin-${weight}-normal.woff`], ['noto-sans', `noto-sans-latin-ext-${weight}-normal.woff`],
    ['noto-sans-gurmukhi', `noto-sans-gurmukhi-gurmukhi-${weight}-normal.woff`], ['noto-sans-devanagari', `noto-sans-devanagari-devanagari-${weight}-normal.woff`],
  ];
  const out: { font: PDFFont; has: Set<number> }[] = [];
  for (const [pkg, f] of files) { const font = await doc.embedFont(await noto(pkg, f), { subset: true, features: NO_POSITIONING }); out.push({ font, has: new Set(font.getCharacterSet()) }); }
  return out;
}

/** An A4 landscape certificate. Returns null only when a character is in no available font. */
export async function certificatePdf(c: CertRow, entity: string, logoPath: string): Promise<Uint8Array | null> {
  const fr = c.locale === 'fr-CA';
  const T = fr
    ? { title: 'Attestation de formation', cert: 'Nous attestons que', did: 'a terminé avec succès', at: 'de', ce: 'Heures de formation continue', cat: 'Catégorie', date: 'Délivrée le', code: 'Code de vérification', valid: 'Authentique : émise par' }
    : { title: 'Certificate of completion', cert: 'This certifies that', did: 'has successfully completed', at: 'at', ce: 'Continuing education hours', cat: 'Category', date: 'Issued', code: 'Verification code', valid: 'Genuine. Issued by' };
  const learner = tidy(c.learner), course = tidy(c.course) + (c.version ? ` (v${c.version})` : ''), company = tidy(c.company), ent = tidy(entity);
  const when = c.issued_at.toLocaleDateString(fr ? 'fr-CA' : 'en-CA', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const ceLine = c.hours ? `${T.ce}: ${Number(c.hours)}  |  ${T.cat}: ${(c.category ?? '').replace('_', ' ')}` : '';
  const lines = [learner, course, company, ceLine, ent, when, ...Object.values(T)];
  const needsUnicode = !lines.every(drawable);

  const doc = await PDFDocument.create();
  const W = 842, H = 595;
  const page = doc.addPage([W, H]);
  const serif = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold), sans = await doc.embedFont(StandardFonts.Helvetica), sansB = await doc.embedFont(StandardFonts.HelveticaBold);
  const uni = needsUnicode ? { regular: await loadFallbacks(doc, 400), bold: await loadFallbacks(doc, 700) } : null;
  if (uni && !lines.every((l) => [...l].every((ch) => drawable(ch) || uni.regular.some((f) => f.has.has(ch.codePointAt(0)!))))) return null;
  // Split text into runs, each in the first face that has its characters.
  const runsOf = (text: string, std: PDFFont): { t: string; font: PDFFont }[] => {
    if (!uni || drawable(text)) return [{ t: text, font: std }];
    const set = std === bold || std === sansB ? uni.bold : uni.regular;
    const out: { t: string; font: PDFFont }[] = [];
    for (const ch of text) {
      const f = set.find((x) => x.has.has(ch.codePointAt(0)!))?.font ?? set[0]!.font;
      const last = out[out.length - 1];
      if (last && last.font === f) last.t += ch; else out.push({ t: ch, font: f });
    }
    return out;
  };
  const widthOf = (runs: { t: string; font: PDFFont }[], sz: number) => runs.reduce((a, r) => a + r.font.widthOfTextAtSize(r.t, sz), 0);
  const blue = rgb(0.114, 0.306, 0.847), grey = rgb(0.29, 0.33, 0.39);
  page.drawRectangle({ x: 24, y: 24, width: W - 48, height: H - 48, borderColor: blue, borderWidth: 4 });
  page.drawRectangle({ x: 34, y: 34, width: W - 68, height: H - 68, borderColor: blue, borderWidth: 1 });
  // Centre a line, shrinking it to fit if it is long.
  const centre = (text: string, y: number, font: typeof serif, size: number, color = rgb(0.12, 0.16, 0.22)) => {
    let sz = size; const max = W - 140; const runs = runsOf(text, font);
    while (widthOf(runs, sz) > max && sz > 8) sz -= 1;
    let x = (W - widthOf(runs, sz)) / 2;
    for (const r of runs) { page.drawText(r.t, { x, y, size: sz, font: r.font, color }); x += r.font.widthOfTextAtSize(r.t, sz); }
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
