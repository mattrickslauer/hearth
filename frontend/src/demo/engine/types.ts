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

export type CloudModel = 'qwen-vl' | 'qwen-vl-max' | 'qwen-max' | 'qwen-plus';

/** Model catalog the UI offers when you pick which brain runs a cloud check. */
export const MODELS: { id: CloudModel; label: string; vision: boolean; note: string }[] = [
  { id: 'qwen-vl', label: 'Qwen-VL', vision: true, note: 'vision · fast · cheap' },
  { id: 'qwen-vl-max', label: 'Qwen-VL-Max', vision: true, note: 'vision · sharpest eyes' },
  { id: 'qwen-max', label: 'Qwen-Max', vision: false, note: 'text reasoning · no frames' },
  { id: 'qwen-plus', label: 'Qwen-Plus', vision: false, note: 'text reasoning · cheapest' },
];

export interface CloudCheck {
  model: CloudModel;
  question: string; // the VL / reasoning question
  gate?: PredicateNode; // cheap local precondition before spending a cloud call
  maxCadence?: Duration; // hard budget floor — never sample faster than this
}

/**
 * A capture policy (`02` Record): how often an input is sampled and how much is
 * retained. For a camera input this is literally the *frame rate* of the watch —
 * `interval` mode meters a sample every `every`; `on_event` samples only when the
 * scene changes, still capped by the cloud check's `maxCadence`.
 */
export interface RecordPolicy {
  inputId: string; // the sampled input (e.g. 'camera.frame')
  mode: 'interval' | 'on_event';
  every: Duration; // metered sample rate, e.g. '10s'
  retain: number; // how many samples to keep
  transform?: 'raw' | 'crop' | 'downscale' | 'redact'; // privacy / bandwidth
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
  heldSceneKey?: string; // last scene we emitted a non-firing "held" for (feed de-noise)
  evalCount?: number; // cloud calls this watch has spent (metering visibility)
  busy?: boolean; // a cloud eval is in flight
}
