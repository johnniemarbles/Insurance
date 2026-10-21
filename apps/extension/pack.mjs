// Builds the zip copy of the extension that partners download from the install page.
// The zip gets a fixed public key (zip-key.txt) so its Chrome extension ID never changes; that ID must be in EXTENSION_ORIGINS.
// The key is added to the packed manifest only. The repository manifest is unchanged (see freeze.json).
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extensionIdFor, listFiles, makeZip } from './zip.mjs';

export { extensionIdFor, makeZip };

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PACK = join(ROOT, 'pack');
const key = readFileSync(join(ROOT, 'zip-key.txt'), 'utf8').trim();

execFileSync(process.execPath, ['build.mjs'], { cwd: ROOT, stdio: 'inherit' });
const dist = join(ROOT, 'dist');
const manifestPath = join(dist, 'manifest.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.key = key;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const files = listFiles(dist).sort().map((p) => ({ name: relative(dist, p).split('\\').join('/'), data: readFileSync(p) }));
const zip = makeZip(files);
const file = `pii-extension-${manifest.version}.zip`;
rmSync(PACK, { recursive: true, force: true });
mkdirSync(PACK, { recursive: true });
writeFileSync(join(PACK, file), zip);
const info = {
  version: manifest.version,
  extensionId: extensionIdFor(key),
  file,
  sha256: createHash('sha256').update(zip).digest('hex'),
  size: zip.length,
  builtAt: new Date().toISOString(),
};
writeFileSync(join(PACK, 'pii-extension.json'), JSON.stringify(info, null, 2));
console.log(`Packed ${file}: ${zip.length} bytes, ID ${info.extensionId}, SHA-256 ${info.sha256}`);
