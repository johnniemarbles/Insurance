import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideFor, renderGuide } from '../src/partner-guide.ts';

const opts = { product: 'PII', support: 'help@example.com', otherLangHref: '/guide?lang=fr-CA', otherLangLabel: 'Français' };

test('guide: every language and country has the same sections, and the US text names California, not RIBO', () => {
  const ids = (l: 'en' | 'fr-CA', c: 'CA' | 'US') => guideFor(l, c).sections.map((s) => s.id).join(',');
  assert.equal(ids('en', 'CA'), ids('fr-CA', 'CA')); assert.equal(ids('en', 'CA'), ids('en', 'US'));
  const us = renderGuide(guideFor('en', 'US'), { lang: 'en', ...opts });
  assert.match(us, /California Department of Insurance/); assert.doesNotMatch(us, /RIBO/); assert.match(us, /EIN/);
  const ca = renderGuide(guideFor('en', 'CA'), { lang: 'en', ...opts });
  assert.match(ca, /RIBO/); assert.doesNotMatch(ca, /California/);
  const fr = renderGuide(guideFor('fr-CA', 'US'), { lang: 'fr-CA', ...opts });
  assert.match(fr, /California Department of Insurance/);
});
test('guide: text is escaped and the support address is shown', () => {
  const html = renderGuide(guideFor('en', 'CA'), { lang: 'en', ...opts, support: '<b>x</b>@example.com' });
  assert.ok(!html.includes('<b>x</b>')); assert.match(html, /&lt;b&gt;x&lt;\/b&gt;@example.com/);
  assert.match(renderGuide(guideFor('en', 'CA'), { lang: 'en', ...opts }), /help@example\.com/);
});
