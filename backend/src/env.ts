/**
 * Load a local .env into process.env if present (dev only). On Function Compute
 * there is no .env — vars come from s.yaml — and the existsSync guards skip it.
 * Uses Node's built-in loader (no dependency). Import this FIRST, for side effects.
 *
 * Looks at the repo-root .env (../../.env from src/) and backend/.env (../.env).
 */

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const candidates = [resolve(here, '../../.env'), resolve(here, '../.env')];

for (const p of candidates) {
  if (existsSync(p) && typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(p);
    } catch {
      // malformed or unreadable — ignore, fall back to real process env
    }
  }
}
