import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';

// The standalone page is served by the API at /app. The same code is bundled into the Gmail extension.
mkdirSync('../api/public/app', { recursive: true });
await build({
  entryPoints: { app: 'src/standalone.tsx' },
  outdir: '../api/public/app', bundle: true, format: 'iife', target: 'es2022', minify: true,
  jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'info',
});
