/** Duration strings — the `02` convention: "2s" "5m" "1h". */
export type Duration = string;

const RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/;
const MULT: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(d: Duration | number | undefined): number {
  if (typeof d === 'number') return d;
  if (!d) return 0;
  const m = RE.exec(String(d).trim());
  if (!m) return 0;
  return Number(m[1]) * MULT[m[2]];
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}h`;
  if (ms % 60_000 === 0) return `${ms / 60_000}m`;
  if (ms % 1000 === 0) return `${ms / 1000}s`;
  return `${ms}ms`;
}
