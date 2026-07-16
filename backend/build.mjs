/**
 * Bundle the server into a single self-contained dist/server.cjs for Function
 * Compute (custom runtime). esbuild follows the cross-package imports into the
 * shared frontend engine/brain and inlines them — one file.
 *
 * CommonJS output: FC's custom runtime runs `server.cjs` with no package.json in
 * the code dir, so node treats it as CJS. Bundling as cjs avoids an ESM/CJS
 * mismatch; esbuild shims `import.meta.url` for us.
 *
 * `tablestore` is deliberately NOT bundled: its lib relies on sloppy implicit-global
 * for-in loops (`for (pro in ...)`, `for (key in ...)`) that create globals in plain
 * CommonJS but throw "X is not defined" once inlined into esbuild's strict, ESM-origin
 * bundle. So we keep it external and install it as a real node_module alongside the
 * bundle, where it runs in native (non-strict) CJS. `ali-oss` is external too — not
 * referenced at runtime yet, so it doesn't need to ship.
 */
import { build } from 'esbuild';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tablestoreVersion = require('tablestore/package.json').version;
const aliOssVersion = require('ali-oss/package.json').version;

// Stamp the build with its git sha + time, surfaced at /health. The frontend auto-deploys on
// every merge while this backend deploys by hand, so the two skew silently — a deploy from a
// stale branch has now twice rolled back the API shape and blanked the dashboard. The tools
// count can miss that (equal counts, different code); the sha cannot.
let sha = 'unknown';
try {
  sha = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  if (execSync('git status --porcelain -- src', { encoding: 'utf8' }).trim()) sha += '-dirty';
} catch {
  /* not a git checkout (CI tarball) — 'unknown' is honest */
}
const buildInfo = `${sha} @ ${new Date().toISOString()}`;

await build({
  entryPoints: ['src/server.ts'],
  outfile: 'dist/server.cjs', // .cjs = CommonJS everywhere, regardless of package.json type
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['ali-oss', 'tablestore'],
  logLevel: 'info',
  define: { 'process.env.BUILD_INFO': JSON.stringify(buildInfo) },
});

// Ship tablestore (+ its deps) as a real node_module in the code dir so `require`
// resolves it at runtime and it runs unbundled, in non-strict CommonJS.
writeFileSync(
  'dist/package.json',
  JSON.stringify(
    { private: true, dependencies: { tablestore: tablestoreVersion, 'ali-oss': aliOssVersion } },
    null,
    2,
  ) + '\n',
);
execSync('npm install --omit=dev --no-audit --no-fund --no-package-lock', { cwd: 'dist', stdio: 'inherit' });

console.log('built dist/server.cjs + dist/node_modules (tablestore + ali-oss)');
