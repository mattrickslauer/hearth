/**
 * Cost estimation — what a compiled Question will spend, *before* it runs.
 *
 * A watch is a declared program with a declared cadence, so its bill is knowable
 * at authoring time: cadence × payload × model are all on the compiled spec. That
 * is the whole trick — we quote the configuration rather than metering the calls.
 *
 * Pure (no React/RN, no I/O), so the browser can re-quote on every slider tick and
 * the cloud can enforce the same number the user was shown. One function, two sides,
 * no drift.
 *
 * The unit is a **Look**: one cloud evaluation at the baseline config (Qwen-VL-plus,
 * one VGA frame, two reference photos). Looks are derived from live USD rates rather
 * than a hand-kept multiplier table, so re-pricing a model can't silently desync the
 * unit from what we actually pay.
 */

import { MODELS, type CloudModel, type CompiledSpec, type RecordPolicy } from './types';
import { meteredInterval } from './record';

/** Qwen-VL tokenizes images at 28×28 px = 1 token, floored at 4 and capped at 16384. */
const PX_PER_IMAGE_TOKEN = 28 * 28;
const MIN_IMAGE_TOKENS = 4;
const MAX_IMAGE_TOKENS = 16_384;

/**
 * USD per 1M tokens — Model Studio international (Singapore) list prices.
 * `qwen-vl` is the catalog's name for qwen-vl-plus (backend `QWEN_VL_MODEL` default).
 * Promotional discounts are deliberately ignored: quote the list price, never the sale.
 */
export const MODEL_RATES: Record<CloudModel, { in: number; out: number }> = {
  'qwen-vl': { in: 0.21, out: 0.63 },
  'qwen-vl-max': { in: 0.8, out: 3.2 },
  'qwen-plus': { in: 0.4, out: 1.6 },
  'qwen-max': { in: 2.5, out: 7.5 },
};

/** Judge-prompt sizes: system + user turn in, verdict + reasoning + steps out. */
const TEXT_TOKENS_IN = 400;
const TOKENS_OUT = 150;

/** The hub camera's default capture size (`hub/camera.mjs`). */
export const VGA: Frame = { width: 640, height: 480 };

/** Watches ship linked memory objects ahead of the live frame; assume a small family. */
const DEFAULT_REFERENCES = 2;

const DAYS_PER_MONTH = 30;
const MS_PER_MONTH = DAYS_PER_MONTH * 86_400_000;

export interface Frame {
  width: number;
  height: number;
}

/**
 * Assumed trigger rate for `on_event` watches. This is the one number the config
 * genuinely cannot tell us — it's a fact about the user's porch, not their spec —
 * so we make the assumption explicit and let them pick it, rather than inventing
 * a precision we don't have.
 */
export const ACTIVITY = { quiet: 20, normal: 50, busy: 200 } as const;
export type ActivityLevel = keyof typeof ACTIVITY;

export interface QuoteInput {
  spec: CompiledSpec;
  record?: RecordPolicy;
  /** Reference photos sent ahead of the live frame (a watch's linked memory objects). */
  references?: number;
  /** Live frame resolution. */
  frame?: Frame;
  /** `on_event` watches only — assumed triggers per day. */
  eventsPerDay?: number;
}

export interface Quote {
  /** Local predicates run on the hub: free, offline, forever. */
  local: boolean;
  model: CloudModel | null;
  mode: RecordPolicy['mode'];
  /** Effective spend interval: the record's own rate, floored by `maxCadence`. */
  intervalMs: number;
  callsPerMonth: number;
  looksPerMonth: number;
  usdPerMonth: number;
  usdPerCall: number;
  /** True when the figure rests on an assumed event rate rather than a declared cadence. */
  assumed: boolean;
  tokens: { image: number; input: number; output: number };
}

const isVision = (m: CloudModel): boolean => MODELS.find((x) => x.id === m)?.vision ?? false;

/** Image tokens for `count` frames of `frame` size, honouring Qwen-VL's floor and cap. */
export function imageTokens(frame: Frame, count: number): number {
  const per = Math.ceil((frame.width * frame.height) / PX_PER_IMAGE_TOKEN);
  return Math.min(MAX_IMAGE_TOKENS, Math.max(MIN_IMAGE_TOKENS, per)) * count;
}

/** USD for a single evaluation at this model + payload. */
export function costPerCall(model: CloudModel, opts: { frame?: Frame; references?: number } = {}): number {
  const rate = MODEL_RATES[model];
  const frame = opts.frame ?? VGA;
  const refs = opts.references ?? DEFAULT_REFERENCES;
  // Text models never receive frames — the vision mismatch is a correctness warning
  // in the UI, but for costing it simply means no image tokens.
  const image = isVision(model) ? imageTokens(frame, 1 + refs) : 0;
  return ((TEXT_TOKENS_IN + image) * rate.in + TOKENS_OUT * rate.out) / 1_000_000;
}

/** The normalized unit: one Qwen-VL-plus eval, one VGA frame, two reference photos. */
export const BASELINE_LOOK_USD = costPerCall('qwen-vl', { frame: VGA, references: DEFAULT_REFERENCES });

const FREE_QUOTE: Quote = {
  local: true,
  model: null,
  mode: 'on_event',
  intervalMs: 0,
  callsPerMonth: 0,
  looksPerMonth: 0,
  usdPerMonth: 0,
  usdPerCall: 0,
  assumed: false,
  tokens: { image: 0, input: 0, output: 0 },
};

/**
 * Quote a compiled Question. Local predicates cost nothing — not as a subsidy, but
 * because they genuinely run on the user's own hub and we never see them.
 */
export function estimate(input: QuoteInput): Quote {
  if (input.spec.kind !== 'cloud') return FREE_QUOTE;

  const { cloud } = input.spec;
  const model = cloud.model;
  const frame = input.frame ?? VGA;
  const references = input.references ?? DEFAULT_REFERENCES;

  const intervalMs = meteredInterval(input.record, cloud);
  const perInterval = intervalMs > 0 ? MS_PER_MONTH / intervalMs : 0;

  // `on_event` fires only when the scene changes, and is still throttled by the
  // metered interval — so the assumed event rate is a ceiling, never an addition.
  const mode = input.record?.mode ?? 'on_event';
  const assumed = mode !== 'interval';
  const events = (input.eventsPerDay ?? ACTIVITY.normal) * DAYS_PER_MONTH;
  const callsPerMonth = Math.round(assumed ? Math.min(events, perInterval) : perInterval);

  const image = isVision(model) ? imageTokens(frame, 1 + references) : 0;
  const usdPerCall = costPerCall(model, { frame, references });
  const usdPerMonth = usdPerCall * callsPerMonth;

  return {
    local: false,
    model,
    mode,
    intervalMs,
    callsPerMonth,
    looksPerMonth: Math.round(usdPerMonth / BASELINE_LOOK_USD),
    usdPerMonth,
    usdPerCall,
    assumed,
    tokens: { image, input: TEXT_TOKENS_IN + image, output: TOKENS_OUT },
  };
}

/* ------------------------------------------------------------------- plans */

/**
 * Reference plan shapes, so a quote can say what it fits. Entitlement is NOT
 * enforced here — this is the number the UI compares against; the cloud will need
 * its own check against the same table before any of it is load-bearing.
 */
export interface Plan {
  id: 'free' | 'home' | 'pro';
  label: string;
  usdPerMonth: number;
  /** Included Looks. Local watches are unlimited on every plan, including free. */
  looks: number;
  /**
   * Fastest cadence this plan may set, for `interval` watches only. An `on_event`
   * watch's spend is bounded by how often the scene actually changes, not by its
   * cadence, so flooring it would reject good configs (the canonical "on motion,
   * ≤ every 20s" porch watch) while saving nothing.
   */
  floorMs: number;
  models: CloudModel[];
}

export const PLANS: Plan[] = [
  { id: 'free', label: 'Free', usdPerMonth: 0, looks: 2_000, floorMs: 10_000, models: ['qwen-vl', 'qwen-plus'] },
  { id: 'home', label: 'Home', usdPerMonth: 9, looks: 10_000, floorMs: 2_000, models: ['qwen-vl', 'qwen-plus', 'qwen-max'] },
  { id: 'pro', label: 'Pro', usdPerMonth: 29, looks: 50_000, floorMs: 500, models: ['qwen-vl', 'qwen-vl-max', 'qwen-plus', 'qwen-max'] },
];

/** Does this quote fit the plan — on volume, on cadence, and on model access? */
export function fitsPlan(q: Quote, plan: Plan): boolean {
  if (q.local) return true;
  if (q.looksPerMonth > plan.looks) return false;
  if (q.mode === 'interval' && q.intervalMs > 0 && q.intervalMs < plan.floorMs) return false;
  return q.model !== null && plan.models.includes(q.model);
}

/** The cheapest plan this quote fits, or null when no plan covers it as configured. */
export function cheapestPlan(q: Quote): Plan | null {
  return PLANS.find((p) => fitsPlan(q, p)) ?? null;
}

/* -------------------------------------------------------------- formatting */

/** Money for humans: sub-cent figures still deserve an honest number, not "$0.00". */
export function formatUsd(usd: number): string {
  if (usd <= 0) return '$0';
  if (usd < 0.01) return '<$0.01';
  if (usd < 10) return `$${usd.toFixed(2)}`;
  return `$${Math.round(usd)}`;
}

/** Compact Look counts: 1400 → "1.4k". */
export function formatLooks(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}
