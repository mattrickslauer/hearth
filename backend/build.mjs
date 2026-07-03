/**
 * Bundle the server into a single self-contained dist/server.js for Function
 * Compute (custom runtime). esbuild follows the cross-package imports into the
 * shared frontend engine/brain and inlines them — one file, no node_modules on
 * the function except the optional cloud SDKs (kept external).
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  external: ['tablestore', 'ali-oss'],
  logLevel: 'info',
});

console.log('built dist/server.js');
