/**
 * Cost recommendations — the agent negotiating your bill down.
 *
 * `04:102` already says image/open-ended wishes compile to a CloudCheck and that a
 * cheap local gate should precede any cloud call. This turns that policy into
 * arithmetic: for each cheaper configuration, re-quote it and report what it saves.
 *
 * Every recommendation is priced by actually calling `estimate()` on the proposed
 * config — never by a hand-written "saves ~90%" string. A suggestion that doesn't
 * measurably save money is not emitted, so the list can't fill with noise.
 *
 * Pure and RN-free, like the rest of the engine. Gate candidates are passed in
 * rather than imported, so this stays below the home/capability layer.
 */

import { estimate, type Frame, type Quote, type QuoteInput } from './pricing';
import type { CloudModel, PredicateNode, RecordPolicy } from './types';

/**
 * A local sensor that could front a cloud call. `duty` is the fraction of the day
 * the predicate is expected to hold — a front-door presence sensor is true ~2% of
 * the day, so gating on it removes ~98% of the calls.
 */
export interface GateCandidate {
  inputId: string;
  label: string;
  /** 0..1 — assumed fraction of the day this gate holds. */
  duty: number;
  predicate: PredicateNode;
  /** False when the sensor isn't in the home yet — a hardware suggestion, not a tap. */
  installed: boolean;
  /** Rough hardware cost when `installed` is false, e.g. "~$5 ESP32 + PIR". */
  hardware?: string;
}

export type RecommendKind = 'gate' | 'hardware' | 'mode' | 'cadence' | 'model' | 'references';

export interface Recommendation {
  id: string;
  kind: RecommendKind;
  /** Short imperative — "Gate on doorway presence". */
  title: string;
  why: string;
  /** What it saves per month, measured by re-quoting, not asserted. */
  savedUsd: number;
  savedPct: number;
  /** The projected quote if applied. */
  projected: Quote;
  /** Present when the change is one tap. Absent for hardware (you must go buy it). */
  patch?: QuestionPatch;
}

/** A one-tap change to a compiled watch. Mirrors the sim's `configureQuestion`. */
export interface QuestionPatch {
  mode?: RecordPolicy['mode'];
  every?: string;
  model?: CloudModel;
  gate?: PredicateNode;
  gateDuty?: number;
}

export interface RecommendOpts {
  gates?: GateCandidate[];
  /** Cadence stops the UI offers, slowest-first preference order. */
  slower?: string[];
  frame?: Frame;
}

const pct = (before: number, after: number): number => (before <= 0 ? 0 : ((before - after) / before) * 100);

/** Only worth a user's attention if it saves at least this much of the bill. */
const MIN_SAVED_PCT = 5;

/**
 * Rank cost reductions for a compiled watch, best-saving first. Returns [] for local
 * watches — they already cost nothing, and there is nothing honest left to suggest.
 */
export function recommend(input: QuoteInput, opts: RecommendOpts = {}): Recommendation[] {
  const base = estimate(input);
  if (base.local || base.usdPerMonth <= 0) return [];

  const out: Recommendation[] = [];
  const add = (
    id: string,
    kind: RecommendKind,
    title: string,
    why: string,
    next: QuoteInput,
    patch?: QuestionPatch,
  ): void => {
    const projected = estimate(next);
    const savedUsd = base.usdPerMonth - projected.usdPerMonth;
    const savedPct = pct(base.usdPerMonth, projected.usdPerMonth);
    if (savedPct < MIN_SAVED_PCT) return;
    out.push({ id, kind, title, why, savedUsd, savedPct, projected, patch });
  };

  const spec = input.spec;
  if (spec.kind !== 'cloud') return [];
  const cloud = spec.cloud;

  // ── a local gate in front of the call — usually the single biggest win ──────
  // This is the architecture's own advice (`04:102`), priced.
  if (!base.gated) {
    for (const g of opts.gates ?? []) {
      const next: QuoteInput = {
        ...input,
        spec: { kind: 'cloud', cloud: { ...cloud, gate: g.predicate } },
        gateDuty: g.duty,
      };
      if (g.installed) {
        add(
          `gate:${g.inputId}`,
          'gate',
          `Gate on ${g.label.toLowerCase()}`,
          `You already have this sensor. Qwen only Looks while it reads true — the rest of the day costs nothing.`,
          next,
          { gate: g.predicate, gateDuty: g.duty },
        );
      } else {
        add(
          `hw:${g.inputId}`,
          'hardware',
          `Add ${g.label.toLowerCase()} (${g.hardware ?? 'a small node'})`,
          `You don't have this sensor yet. Adding it pays for itself — the camera stops Looking at an empty scene.`,
          next,
          undefined, // you can't tap your way to hardware
        );
      }
    }
  }

  // ── stop sampling on a timer; sample when the scene changes ────────────────
  if (base.mode === 'interval') {
    add(
      'mode:on_event',
      'mode',
      'Only Look when the scene changes',
      'Fixed-interval vision spends on every tick, including an empty porch at 4am.',
      { ...input, record: input.record ? { ...input.record, mode: 'on_event' } : undefined },
      { mode: 'on_event' },
    );
  }

  // ── slow the metered rate ─────────────────────────────────────────────────
  for (const every of opts.slower ?? []) {
    if (!input.record) break;
    const next: QuoteInput = { ...input, record: { ...input.record, every } };
    const p = estimate(next);
    if (p.usdPerMonth >= base.usdPerMonth) continue;
    add(
      `cadence:${every}`,
      'cadence',
      `Slow to every ${every}`,
      'The cheapest cadence that still satisfies the wish is almost always slower than it feels.',
      next,
      { every },
    );
    break; // one cadence suggestion is enough; the slider is right there
  }

  // ── a cheaper brain ───────────────────────────────────────────────────────
  if (cloud.model === 'qwen-vl-max') {
    add(
      'model:qwen-vl',
      'model',
      'Use Qwen-VL instead of Qwen-VL-Max',
      'Max has sharper eyes and costs ~4× per Look. Most "is this someone we know" calls do not need it.',
      { ...input, spec: { kind: 'cloud', cloud: { ...cloud, model: 'qwen-vl' } } },
      { model: 'qwen-vl' },
    );
  }

  // ── trim the reference payload ────────────────────────────────────────────
  // Every reference photo rides along on *every* call, so they are a per-Look tax.
  const refs = input.references ?? 2;
  if (refs > 3) {
    add(
      'references:3',
      'references',
      `Link 3 reference photos instead of ${refs}`,
      'References are re-sent on every Look, so each one is a permanent surcharge.',
      { ...input, references: 3 },
    );
  }

  return out.sort((a, b) => b.savedUsd - a.savedUsd);
}
