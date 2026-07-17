/**
 * Shared cost-view helpers for a watch, used by both the inline `CostQuote` (watches list,
 * billing) and the `TuneWatch` sheet — one source of truth for how gates are resolved and how a
 * per-day check count is worded.
 */

import { gatesFor } from '@/demo/gates';
import type { GateCandidate } from '@/demo/engine/recommend';
import { gatesFromHome } from '@/lib/gates';
import type { HomeModel, Watch } from '@/lib/home';

/**
 * The gates a watch could use. `describe_home` is authoritative once a hub has reported its
 * devices, but it's EMPTY until one does — so fall back to the static capability catalog the
 * brain authors against, or a gated watch shows no gates on a home with no hub yet.
 */
export function resolveGates(watch: Watch, home: HomeModel | null): GateCandidate[] {
  const homeGates = gatesFromHome(home, watch.boundInputs);
  return homeGates.length ? homeGates : gatesFor(watch.boundInputs);
}

/**
 * Checks a day, rounded for humans. Deliberately NOT Looks: a Look is a normalized cost unit
 * (a sharper model spends ~4 per check), so showing Looks here would read as "the model
 * quadrupled how often it looks" when it only quadrupled the price. "<1" beats a misleading "0".
 */
export function perDay(callsPerMonth: number): string {
  const d = callsPerMonth / 30;
  if (d === 0) return '0';
  if (d < 1) return '<1';
  return String(Math.round(d));
}
