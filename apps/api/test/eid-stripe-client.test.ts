// The real Stripe Identity client: the birth date and expiry are asked for by name, as Stripe requires for sensitive fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripeIdentityClient } from '../src/eid.ts';

test('getOutcome names the sensitive fields in expand and reads them', async () => {
  const urls: string[] = [];
  const fake = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify({
      status: 'verified',
      verified_outputs: { first_name: 'Raj', last_name: 'Singh', dob: { year: 1980, month: 4, day: 9 } },
      last_verification_report: { document: { type: 'driving_license', issuing_country: 'ca', status: 'verified', expiration_date: { year: 2029, month: 1, day: 31 } }, selfie: { status: 'verified' } },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  const out = await stripeIdentityClient('rk_test_x', fake).getOutcome('vs_123');
  const q = decodeURIComponent(urls[0]!);
  for (const f of ['verified_outputs.dob', 'last_verification_report.document.expiration_date', 'last_verification_report.document.dob']) assert.ok(q.includes(`expand[]=${f}`), f);
  assert.equal(out.dob, '1980-04-09');
  assert.equal(out.expiry, '2029-01-31');
  assert.equal(out.selfieVerified, true);
});
