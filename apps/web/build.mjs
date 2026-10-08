import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The standalone page is served by the API at /app. The same code is bundled into the Gmail extension.
mkdirSync('../api/public/app', { recursive: true });

// The demo inbox mounts the extension's real sidebar. Its api() goes through the extension background worker, so inside this
// bundle only that one import is swapped for a plain request. The extension's own files are never changed.
const sidebarApi = {
  name: 'sidebar-api',
  setup(b) {
    b.onResolve({ filter: /^\.\/api$/ }, (args) =>
      args.importer.endsWith('/extension/src/sidebar.ts') ? { path: fileURLToPath(new URL('./src/demo-api.ts', import.meta.url)) } : undefined);
  },
};

await build({
  entryPoints: { app: 'src/standalone.tsx' },
  outdir: '../api/public/app', bundle: true, format: 'iife', target: 'es2022', minify: true,
  jsx: 'automatic', jsxImportSource: 'preact', logLevel: 'info', plugins: [sidebarApi],
});
