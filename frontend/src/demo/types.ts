/**
 * Hearth demo — domain model for the browser-runnable simulated home.
 *
 * A small, honest model of the real product: self-describing ESP nodes expose
 * capabilities; a world holds live sensor/actuator state; the "brain" (Qwen, or
 * a deterministic mock) compiles a plain-language wish into a Deployment with a
 * machine-checkable condition; the simulation evaluates conditions against the
 * world and, for open-ended/visual predicates, asks the brain to *judge* the
 * situation and explain itself.
 */

import type { CompiledSpec, FirePolicy, RecordPolicy } from './engine/types';

export type ZoneId = 'garage' | 'entry' | 'living';

export interface Zone {
  id: ZoneId;
  name: string;
  icon: string;
}

/** What a node can sense or do. Stable `id` is what deployments bind to. */
export interface Capability {
  id: string; // e.g. 'garage.door', 'garage.heater'
  label: string; // 'Garage door'
  kind: 'sensor' | 'actuator';
  icon: string;
  unit?: string; // '°C'
  /** Human description Qwen sees when authoring, and we show in the UI. */
  describes: string;
  /** True for the camera frame capability — enables Qwen-VL scene reasoning. */
  vision?: boolean;
}

/** A self-describing ESP/hub node. */
export interface Node {
  id: string;
  name: string;
  zone: ZoneId;
  hardware: string; // 'ESP32 + HC-SR04 + DHT11 + relay'
  offGrid?: boolean; // solar-powered outdoor node
  capabilities: Capability[];
}

export type SensorValue = number | string | boolean | null;

export interface ActuatorState {
  on?: boolean;
  angle?: number;
  text?: string;
}

/** Someone the door sensors/camera might perceive. */
export interface Visitor {
  id: string;
  label: string; // 'a delivery courier', 'Alex'
  household: boolean;
  rfid?: string | null; // tag id if they carry one
  emoji: string;
}

/** The live state of the simulated home. */
export interface WorldState {
  clock: number; // minutes since midnight (sim time)
  timeOfDay: 'day' | 'night';
  online: boolean;
  sensors: Record<string, SensorValue>;
  actuators: Record<string, ActuatorState>;
  visitor: Visitor | null;
}

/* ----------------------------------------------------------- Condition DSL */

/**
 * A Question — the compiled product of a wish (02-data-model.md). Carries both
 * the human-facing summary (for the UI) and the runnable `compiledSpec` the
 * engine evaluates. Replaces the old ad-hoc `Deployment`/`Condition`.
 */
export interface Question {
  id: string;
  text: string; // the natural-language wish
  title: string; // short name the brain gives it
  boundInputs: string[]; // inputIds it binds (shown as "watches")
  trigger: string; // plain-language trigger
  action: string; // plain-language action
  actuates: string[]; // actuator inputIds it drives
  push?: boolean;
  usesVision: boolean;
  runsLocally: boolean; // local predicate → fires offline, no tokens
  cost: 'none' | 'cloud';
  compiledTo: 'local' | 'cloud_vl';
  compiledSpec: CompiledSpec;
  /** Capture/sampling policy for cloud watches — the configurable "frame rate". */
  record?: RecordPolicy;
  evalOn: 'event' | 'interval';
  fire: FirePolicy;
  authoring?: string[]; // the brain's authoring reasoning steps (shown once)
}

/** The result of the brain reasoning about a live situation. */
export interface Judgment {
  fired: boolean;
  verdict: string; // 'MATCH' | 'CLEAR' | 'FIRED' …
  reasoning: string; // plain-language why
  steps: string[]; // ↳ trace steps
  privacyNote?: string;
}

export type ActivityKind = 'authored' | 'fired' | 'held' | 'offline' | 'reconnect';

/** A feed item — the demo's RunEvent (an evaluation result / audit line). */
export interface ActivityEvent {
  id: string;
  clock: number;
  time: string; // 'HH:MM'
  questionId: string;
  questionTitle: string;
  kind: ActivityKind;
  judgment?: Judgment;
  push?: string; // phone push text
  local?: boolean; // evaluated locally on the hub (offline-capable)
  detail?: string; // e.g. "held open 5m" — sustained/temporal context
}
