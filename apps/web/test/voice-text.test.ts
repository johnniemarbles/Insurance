// Read aloud: only voices that run on the device, in the person's language; references and markdown not spoken.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localVoice, micRoute, speakable } from '../src/voice-text.ts';

const voices = [
  { name: 'Google français', lang: 'fr-FR', localService: false },
  { name: 'Google US English', lang: 'en-US', localService: false },
  { name: 'Amélie', lang: 'fr-CA', localService: true },
  { name: 'Samantha', lang: 'en-US', localService: true },
  { name: 'Daniel', lang: 'en_GB', localService: true },
];

test('picks a local voice in the person\'s language, never an online one', () => {
  assert.equal(localVoice(voices, 'en')?.name, 'Samantha');
  assert.equal(localVoice(voices, 'fr-CA')?.name, 'Amélie');
  assert.equal(localVoice(voices.filter((v) => v.name !== 'Amélie'), 'fr-CA'), null); // only an online French voice: no button
  assert.equal(localVoice(voices.filter((v) => v.name !== 'Samantha'), 'en')?.name, 'Daniel');
});

test('references, placeholders and markdown are not read out', () => {
  assert.equal(speakable('**Raj Singh** renews on 1 Nov [C3]. Call him [C4].'), 'Raj Singh renews on 1 Nov. Call him.');
  assert.equal(speakable('Dear Raj, [TO CONFIRM: premium] per month.'), 'Dear Raj, per month.');
});

test('the microphone: on the page, in a PII window when Gmail\'s frame may not use it, never in Gmail\'s own page', () => {
  assert.equal(micRoute({ host: 'ca.punjabinsurance.co', framed: false, policyAllows: true }), 'here'); // the web app
  assert.equal(micRoute({ host: 'ca.punjabinsurance.co', framed: true, policyAllows: true }), 'here'); // Gmail, extension 1.8.0
  assert.equal(micRoute({ host: 'ca.punjabinsurance.co', framed: true, policyAllows: false }), 'window'); // Gmail, before 1.8.0
  assert.equal(micRoute({ host: 'ca.punjabinsurance.co', framed: true, policyAllows: undefined }), 'here'); // browser cannot tell: try here
  assert.equal(micRoute({ host: 'mail.google.com', framed: false, policyAllows: true }), 'none'); // the extension's built-in copy
});
