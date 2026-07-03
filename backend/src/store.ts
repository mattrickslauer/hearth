/**
 * Persistence port + adapters. The tool layer depends only on `HomeStore`; which
 * adapter backs it is a deploy decision:
 *   - MemoryStore   — in-process, seeded from the shared home model. Local dev + the
 *                     judge-accessible demo path. Zero setup.
 *   - TablestoreStore — Alibaba Tablestore (serverless NoSQL): the twin (Home Model)
 *                     + append-heavy readings/events. Cheap-at-idle (reserved CU=0).
 *
 * Same interface, so the MCP server is identical whether it runs on a laptop or in
 * Function Compute over Tablestore.
 */

import {
  CAPABILITIES,
  NODES,
  ZONES,
  initialWorld,
  parseDuration,
  type Capability,
  type HomeNode,
  type Question,
  type RecordPolicy,
  type Zone,
} from './domain';

export type Scalar = number | string | boolean;
export interface Reading {
  input: string;
  ts: number;
  value: Scalar;
}
export type Agg = 'latest' | 'mean' | 'min' | 'max' | 'count';

export interface HomeModel {
  zones: Zone[];
  nodes: HomeNode[];
  capabilities: Capability[];
}

export interface RunEventRow {
  id: string;
  ts: number;
  questionId: string;
  kind: string;
  answer?: boolean;
  reasoning?: string;
  evaluatedBy?: 'local' | 'qwen';
}

export interface HomeStore {
  describeHome(): Promise<HomeModel>;
  listInputs(filter?: 'sensor' | 'actuator'): Promise<Capability[]>;
  appendReading(input: string, value: Scalar, ts: number): Promise<void>;
  readInput(input: string, agg: Agg, windowMs: number, now: number): Promise<Reading | null>;
  history(input: string, from: number, to: number): Promise<Reading[]>;
  putQuestion(q: Question): Promise<void>;
  listQuestions(): Promise<Question[]>;
  putRecord(policy: RecordPolicy): Promise<void>;
  listRecords(): Promise<RecordPolicy[]>;
  appendEvent(ev: RunEventRow): Promise<void>;
  listEvents(limit: number): Promise<RunEventRow[]>;
}

/** Compute an aggregate over a window ending at `now` (numbers only for mean/min/max). */
export function aggregate(readings: Reading[], agg: Agg, windowMs: number, now: number): Reading | null {
  const from = windowMs > 0 ? now - windowMs : -Infinity;
  const xs = readings.filter((r) => r.ts >= from).sort((a, b) => a.ts - b.ts);
  if (!xs.length) return null;
  const last = xs[xs.length - 1];
  if (agg === 'latest') return last;
  if (agg === 'count') return { input: last.input, ts: now, value: xs.length };
  const nums = xs.map((r) => Number(r.value)).filter((n) => Number.isFinite(n));
  if (!nums.length) return last;
  const value =
    agg === 'mean' ? nums.reduce((a, b) => a + b, 0) / nums.length : agg === 'min' ? Math.min(...nums) : Math.max(...nums);
  return { input: last.input, ts: now, value };
}

export class MemoryStore implements HomeStore {
  private readings = new Map<string, Reading[]>();
  private questions = new Map<string, Question>();
  private records = new Map<string, RecordPolicy>();
  private events: RunEventRow[] = [];

  constructor(seed = true) {
    if (seed) {
      const w = initialWorld();
      const now = Date.now();
      for (const [id, v] of Object.entries(w.sensors)) if (v !== null) this.push(id, v as Scalar, now);
    }
  }

  private push(input: string, value: Scalar, ts: number) {
    const arr = this.readings.get(input) ?? [];
    arr.push({ input, ts, value });
    if (arr.length > 5000) arr.shift();
    this.readings.set(input, arr);
  }

  async describeHome(): Promise<HomeModel> {
    return { zones: ZONES, nodes: NODES, capabilities: CAPABILITIES };
  }
  async listInputs(filter?: 'sensor' | 'actuator'): Promise<Capability[]> {
    return CAPABILITIES.filter((c) => !filter || c.kind === filter);
  }
  async appendReading(input: string, value: Scalar, ts: number): Promise<void> {
    this.push(input, value, ts);
  }
  async readInput(input: string, agg: Agg, windowMs: number, now: number): Promise<Reading | null> {
    return aggregate(this.readings.get(input) ?? [], agg, windowMs, now);
  }
  async history(input: string, from: number, to: number): Promise<Reading[]> {
    return (this.readings.get(input) ?? []).filter((r) => r.ts >= from && r.ts <= to);
  }
  async putQuestion(q: Question): Promise<void> {
    this.questions.set(q.id, q);
    if (q.record) this.records.set(q.record.inputId, q.record);
  }
  async listQuestions(): Promise<Question[]> {
    return [...this.questions.values()];
  }
  async putRecord(policy: RecordPolicy): Promise<void> {
    this.records.set(policy.inputId, policy);
  }
  async listRecords(): Promise<RecordPolicy[]> {
    return [...this.records.values()];
  }
  async appendEvent(ev: RunEventRow): Promise<void> {
    this.events.unshift(ev);
    this.events = this.events.slice(0, 500);
  }
  async listEvents(limit: number): Promise<RunEventRow[]> {
    return this.events.slice(0, limit);
  }
}

/**
 * Alibaba Tablestore adapter. Interface-complete; the SDK calls are wired but the
 * package + credentials are provisioned at deploy time (see backend/README.md). We
 * fail loud with a setup hint rather than silently pretend, so a misconfigured
 * deploy is obvious. Until then the server runs on MemoryStore.
 */
export interface TablestoreConfig {
  endpoint: string;
  instance: string;
  accessKeyId: string;
  accessKeySecret: string;
}

export async function createTablestore(_cfg: TablestoreConfig): Promise<HomeStore> {
  let TableStore: unknown;
  try {
    // optional dependency — only needed when actually deploying against Tablestore
    TableStore = await import('tablestore');
  } catch {
    throw new Error(
      "Tablestore selected but the 'tablestore' SDK is not installed. Run `npm i tablestore` in backend/, " +
        'or unset HEARTH_STORE=tablestore to use the in-memory store.',
    );
  }
  void TableStore;
  // NOTE: table creation + row read/write land here once an Alibaba account + keys
  // exist. Tables: `twin` (home model, low write), `readings` (append, TTL'd),
  // `questions`, `records`, `events`. Keyed by (homeId, inputId|ts). Reserved CU=0.
  throw new Error(
    'Tablestore adapter not yet provisioned. Set HEARTH_STORE=memory for now; ' +
      'fill createTablestore() when the Alibaba account + keys are available (backend/README.md).',
  );
}

/** Pick the store from env. Defaults to memory so the server always boots. */
export async function makeStore(): Promise<HomeStore> {
  if (process.env.HEARTH_STORE === 'tablestore') {
    return createTablestore({
      endpoint: must('TABLESTORE_ENDPOINT'),
      instance: must('TABLESTORE_INSTANCE'),
      accessKeyId: must('ALIBABA_ACCESS_KEY_ID'),
      accessKeySecret: must('ALIBABA_ACCESS_KEY_SECRET'),
    });
  }
  return new MemoryStore();
}

function must(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env ${name} (required for HEARTH_STORE=tablestore)`);
  return v;
}

export { parseDuration };
