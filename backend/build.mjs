/**
 * Bundle the server into a single self-contained dist/server.js for Function
 * Compute (custom runtime). esbuild follows the cross-package imports into the
 * shared frontend engine/brain and inlines them — one file, no node_modules on
 * the function except the optional cloud SDKs (kept external).
 *
 * CommonJS output: FC's custom runtime runs `server.js` with no package.json in
 * the code dir, so node treats it as CJS. Bundling as cjs avoids an ESM/CJS
 * mismatch; esbuild shims `import.meta.url` for us.
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.cjs', // .cjs = CommonJS everywhere, regardless of package.json type
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['tablestore', 'ali-oss'],
  logLevel: 'info',
});

console.log('built dist/server.cjs');
