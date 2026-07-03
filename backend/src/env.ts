/**
 * Load a local .env into process.env if present (dev only). On Function Compute
 * there is no .env — vars come from the platform — and the existsSync guards skip
 * it. Uses Node's built-in loader (no dependency). Import this FIRST, for side effects.
 *
 * Resolved from the working directory (not import.meta.url), so it survives being
 * bundled to CommonJS by esbuild (where import.meta.url is stubbed out).
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const candidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
  resolve(process.cwd(), '../../.env'),
];

for (const p of candidates) {
  if (existsSync(p) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(p);
    } catch {
      // malformed or unreadable — ignore, fall back to real process env
    }
  }
}
