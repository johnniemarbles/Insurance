import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const API_BASE = process.env.PII_API_BASE ?? 'https://api-dev-20ea.up.railway.app';
const INBOXSDK_APP_ID = process.env.INBOXSDK_APP_ID ?? 'sdk_PunjabInsurance_b26dfb5691';

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist', { recursive: true });
cpSync('public', 'dist', { recursive: true });
cpSync('../../node_modules/@inboxsdk/core/pageWorld.js', 'dist/pageWorld.js');
await build({
  entryPoints: { background: 'src/background.ts', content: 'src/content.ts', options: 'src/options.ts' },
  outdir: 'dist', bundle: true, format: 'iife', target: 'chrome120', minify: true, sourcemap: false,
  define: { __API_BASE__: JSON.stringify(API_BASE), __INBOXSDK_APP_ID__: JSON.stringify(INBOXSDK_APP_ID) },
  logLevel: 'info',
});
