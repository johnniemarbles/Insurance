import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
const f = JSON.parse(readFileSync('freeze.json', 'utf8'));
const now = { ...Object.fromEntries(Object.keys(f).filter((k) => k !== 'content_script_matches').map((k) => [k, m[k]])), content_script_matches: m.content_scripts.map((c) => c.matches) };
const bad = Object.keys(f).filter((k) => JSON.stringify(f[k]) !== JSON.stringify(now[k]));
if (bad.length) { console.error('Frozen manifest fields changed (this triggers Chrome Web Store review):', bad.join(', ')); process.exit(1); }
console.log('Extension freeze OK');
