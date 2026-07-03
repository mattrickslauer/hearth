/**
 * Simulated wall-clock. Sim time is epoch-ms so `schedule` predicates and the
 * displayed clock are real, but derived deterministically (no `Date`/timezone)
 * so it's reproducible. The hub swaps this for actual wall time.
 */

export const SIM_DAY_MS = 86_400_000;
export const SIM_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0); // a Thursday, 00:00

/** Sim epoch-ms for a given minutes-since-midnight (day 0). */
export function simTimeAt(minutesOfDay: number): number {
  return SIM_EPOCH + minutesOfDay * 60_000;
}

/** Minutes since local midnight for a sim timestamp (0..1439). */
export function minutesOfDay(now: number): number {
  const into = (((now - SIM_EPOCH) % SIM_DAY_MS) + SIM_DAY_MS) % SIM_DAY_MS;
  return Math.floor(into / 60_000);
}

/** 0 = Sunday … 6 = Saturday (SIM_EPOCH is a Thursday = 4). */
export function dayOfWeek(now: number): number {
  const days = Math.floor((now - SIM_EPOCH) / SIM_DAY_MS);
  return ((4 + (days % 7)) % 7 + 7) % 7;
}

export function isNight(now: number): boolean {
  const m = minutesOfDay(now);
  return m < 7 * 60 || m >= 19 * 60; // night before 07:00 or from 19:00
}

/** "HH:MM" → minutes since midnight. */
export function hhmmToMinutes(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
