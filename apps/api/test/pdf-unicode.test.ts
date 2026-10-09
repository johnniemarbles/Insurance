import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { sealedAdvicePdf, unsignedAdvicePdf } from '../src/advice-seal.ts';

const base = { adviceId: 'a1', boxId: 'b1', kind: 'needs_analysis' as const, title: 'Needs analysis', body: 'Client wants cover.', clientName: 'ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ', clientEmail: null, contentHash: 'abc', firm: 'Punjab Insurance Agency Inc.', method: 'otp' as const, typedName: 'ਗੁਰਪ੍ਰੀਤ ਸਿੰਘ', ip: null, agent: null, signer: 'client' as const };

test('advice PDFs embed a Unicode font for Gurmukhi names instead of printing question marks', async () => {
  const latin = await sealedAdvicePdf({ ...base, clientName: 'Jane Doe', typedName: 'Jane Doe' }, new Date('2026-01-01T00:00:00Z'));
  const gur = await sealedAdvicePdf(base, new Date('2026-01-01T00:00:00Z'));
  assert.ok(gur.length > latin.length + 5_000, 'a Gurmukhi font is embedded');
  assert.equal((await PDFDocument.load(gur)).getPageCount() >= 2, true);
  const plain = await unsignedAdvicePdf({ kind: base.kind, title: base.title, body: base.body, clientName: 'Jane Doe', firm: base.firm });
  assert.ok(plain.length < 20_000, 'Latin-only documents stay small (no fonts embedded)');
});
