/**
 * ReadingStore — the append-only, bounded reading history temporal predicates
 * query. In the demo it's in-memory; on the hub the same interface is backed by
 * a local buffer that syncs to Tablestore. Also the substrate the MCP read
 * tools (`read_input`, `query_history`) will sit on.
 */

import { parseDuration } from './duration';
import type { Agg, Reading, Scalar } from './types';

const CAP = 600; // per-input ring size

export class ReadingStore {
  private buf = new Map<string, Reading[]>();

  append(input: string, value: Scalar, ts: number): void {
    const arr = this.buf.get(input) ?? [];
    const last = arr[arr.length - 1];
    // keep transitions, not noise: only append when the value actually changed
    if (!last || last.value !== value) {
      arr.push({ input, ts, value });
      if (arr.length > CAP) arr.shift();
      this.buf.set(input, arr);
    }
  }

  latest(input: string): Reading | null {
    const a = this.buf.get(input);
    return a && a.length ? a[a.length - 1] : null;
  }

  /** The value in effect at time `ts` (step function — latest reading ≤ ts). */
  valueAsOf(input: string, ts: number): Scalar | null {
    const a = this.buf.get(input);
    if (!a) return null;
    let v: Scalar | null = null;
    for (const r of a) {
      if (r.ts <= ts) v = r.value;
      else break;
    }
    return v;
  }

  history(input: string, from: number, to: number): Reading[] {
    return (this.buf.get(input) ?? []).filter((r) => r.ts >= from && r.ts <= to);
  }

  /** Transition timestamps at/after `from` (the points where value changed). */
  transitionsSince(input: string, from: number): number[] {
    return (this.buf.get(input) ?? []).filter((r) => r.ts >= from).map((r) => r.ts);
  }

  agg(input: string, agg: Agg | undefined, window: string | number, now: number): Scalar | null {
    if (!agg || agg === 'latest') return this.valueAsOf(input, now);
    const w = parseDuration(window);
    const rows = this.history(input, now - w, now)
      .map((r) => Number(r.value))
      .filter((n) => !Number.isNaN(n));
    if (!rows.length) return null;
    switch (agg) {
      case 'mean':
        return rows.reduce((a, b) => a + b, 0) / rows.length;
      case 'min':
        return Math.min(...rows);
      case 'max':
        return Math.max(...rows);
      case 'count':
        return rows.length;
      default:
        return null;
    }
  }

  clear(): void {
    this.buf.clear();
  }
}
