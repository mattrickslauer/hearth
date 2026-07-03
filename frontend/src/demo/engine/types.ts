/**
 * The compiled-spec grammar — the runnable form of a Question. Adopts
 * `02-data-model.md`'s `PredicateNode` and adds the two ops it was missing:
 * `sustained` (duration) and `schedule` (real time-of-day). Pure data; the
 * evaluator in `predicate.ts` interprets it against a `ReadingStore` + clock.
 */

import type { Duration } from './duration';

export type Scalar = number | string | boolean;
export type Agg = 'latest' | 'mean' | 'min' | 'max' | 'count';
export type Comparator = '>' | '>=' | '<' | '<=' | '==' | '!=';

export interface InputRef {
  input: string; // inputId
  agg?: Agg; // default "latest"
  window?: Duration; // aggregation window ending at now
}

/** Wall-clock window (local time-of-day / weekdays). `cron` reserved for later. */
export type TimeWindow =
  | { after?: string; before?: string; days?: number[] } // "HH:MM", days 0..6 (0 = Sun)
  | { cron: string };

export type PredicateNode =
  | { op: Comparator; left: InputRef; right: Scalar }
  | { op: 'and' | 'or'; nodes: PredicateNode[] }
  | { op: 'not'; node: PredicateNode }
  | { op: 'changed'; input: InputRef; window: Duration }
  | { op: 'delta'; input: InputRef; window: Duration; threshold: number }
  | { op: 'sustained'; node: PredicateNode; for: Duration } // node true continuously ≥ for
  | { op: 'schedule'; window: TimeWindow };

export interface LocalPredicate {
  expr: PredicateNode;
}

export interface CloudCheck {
  model: 'qwen-plus' | 'qwen-max' | 'qwen-vl';
  question: string; // the VL / reasoning question
  gate?: PredicateNode; // cheap local precondition before spending a cloud call
  maxCadence?: Duration; // budget guard
}

export type CompiledSpec =
  | { kind: 'local'; local: LocalPredicate }
  | { kind: 'cloud'; cloud: CloudCheck };

export interface FirePolicy {
  edge: 'rising' | 'level'; // rising: fire once per false→true. level: each due eval while true.
  cooldown?: Duration; // min time between fires
}

/** One retained sample of an input. */
export interface Reading {
  input: string;
  ts: number; // epoch ms (sim or wall)
  value: Scalar;
}

/** A latching actuation — mirrors `02` Command (here applied to sim state). */
export interface Command {
  input: string;
  desired: Scalar;
  issuedBy: string; // runId
  ts: number;
  clearAt?: number; // timed-off: when to auto-revert (undefined = latch)
}

/** Per-question runtime state the scheduler carries (mirrors `Run`). */
export interface RunState {
  lastAnswer: boolean;
  lastEvalAt: number;
  lastFiredAt: number;
  trueSince?: number | null;
  sceneKey?: string; // for cloud re-eval when the scene changes
  busy?: boolean; // a cloud eval is in flight
}
