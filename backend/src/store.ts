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

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

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
  getQuestion(id: string): Promise<Question | null>;
  deleteQuestion(id: string): Promise<boolean>;
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

/** Serializable form of a home — what FileStore reads/writes. */
interface StoreSnapshot {
  model: HomeModel;
  questions: Question[];
  records: RecordPolicy[];
  events: RunEventRow[];
  readings: [string, Reading[]][];
}

const emptyModel = (): HomeModel => ({ zones: [], nodes: [], capabilities: [] });

export class MemoryStore implements HomeStore {
  protected model: HomeModel = emptyModel();
  protected readings = new Map<string, Reading[]>();
  protected questions = new Map<string, Question>();
  protected records = new Map<string, RecordPolicy>();
  protected events: RunEventRow[] = [];

  /**
   * A new home is EMPTY — no zones, devices, watches, or readings. Pass seed=true
   * only for the legacy demo world (kept for tests / the judge-accessible path).
   */
  constructor(seed = false) {
    if (seed) {
      this.model = { zones: ZONES, nodes: NODES, capabilities: CAPABILITIES };
      const w = initialWorld();
      const now = Date.now();
      for (const [id, v] of Object.entries(w.sensors)) if (v !== null) this.push(id, v as Scalar, now);
    }
  }

  /** Persistence hook — a no-op in memory; FileStore overrides it to flush to disk. */
  protected persist(): void {}

  protected snapshot(): StoreSnapshot {
    return {
      model: this.model,
      questions: [...this.questions.values()],
      records: [...this.records.values()],
      events: this.events,
      readings: [...this.readings.entries()],
    };
  }
  protected restore(s: Partial<StoreSnapshot>): void {
    this.model = s.model ?? emptyModel();
    this.questions = new Map((s.questions ?? []).map((q) => [q.id, q]));
    this.records = new Map((s.records ?? []).map((r) => [r.inputId, r]));
    this.events = s.events ?? [];
    this.readings = new Map(s.readings ?? []);
  }

  private push(input: string, value: Scalar, ts: number) {
    const arr = this.readings.get(input) ?? [];
    arr.push({ input, ts, value });
    if (arr.length > 5000) arr.shift();
    this.readings.set(input, arr);
  }

  async describeHome(): Promise<HomeModel> {
    return this.model;
  }
  async listInputs(filter?: 'sensor' | 'actuator'): Promise<Capability[]> {
    return this.model.capabilities.filter((c) => !filter || c.kind === filter);
  }
  async appendReading(input: string, value: Scalar, ts: number): Promise<void> {
    this.push(input, value, ts);
    this.persist();
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
    this.persist();
  }
  async getQuestion(id: string): Promise<Question | null> {
    return this.questions.get(id) ?? null;
  }
  async deleteQuestion(id: string): Promise<boolean> {
    const existed = this.questions.delete(id);
    if (existed) this.persist();
    return existed;
  }
  async listQuestions(): Promise<Question[]> {
    return [...this.questions.values()];
  }
  async putRecord(policy: RecordPolicy): Promise<void> {
    this.records.set(policy.inputId, policy);
    this.persist();
  }
  async listRecords(): Promise<RecordPolicy[]> {
    return [...this.records.values()];
  }
  async appendEvent(ev: RunEventRow): Promise<void> {
    this.events.unshift(ev);
    this.events = this.events.slice(0, 500);
    this.persist();
  }
  async listEvents(limit: number): Promise<RunEventRow[]> {
    return this.events.slice(0, limit);
  }
}

/**
 * File-backed home — one JSON file per account, loaded on open and flushed on every
 * mutation (atomic temp-write + rename). Zero deps, survives restarts. Local dev only:
 * on Function Compute's ephemeral/multi-instance disk this does NOT persist — use the
 * Tablestore adapter (or a hosted DB) for production durability.
 */
export class FileStore extends MemoryStore {
  private constructor(private readonly file: string) {
    super(false);
  }

  static open(file: string): FileStore {
    const s = new FileStore(file);
    if (existsSync(file)) {
      try {
        s.restore(JSON.parse(readFileSync(file, 'utf8')) as Partial<StoreSnapshot>);
      } catch {
        /* corrupt/empty file → start fresh */
      }
    }
    return s;
  }

  protected persist(): void {
    const dir = dirname(this.file);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.snapshot()));
    renameSync(tmp, this.file);
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
  // NOTE: the control plane (accounts + OTP) is now Tablestore-backed — see
  // src/tablestore.ts + src/auth.ts. HomeStore is the remaining data-plane piece:
  // tables `twin` (home model, low write), `readings` (append, TTL'd), `questions`,
  // `records`, `events`, keyed by (homeId, inputId|ts). It's append/aggregation-heavy
  // (a time-series shape) — implement it on the shared tablestore.ts helpers, or point
  // it at a TSDB (Lindorm), when the home data plane goes live. Until then, loud-fail.
  throw new Error(
    'Tablestore HomeStore not implemented yet (accounts + OTP already are — set ' +
      'HEARTH_STORE=tablestore for those). For home/readings persistence use ' +
      'HEARTH_STORE=file locally, or implement createTablestore() (backend/README.md).',
  );
}

/** Root dir for file-backed persistence (HEARTH_STORE=file). */
export function dataDir(): string {
  return process.env.HEARTH_DATA_DIR || join(process.cwd(), '.data');
}

/** Filesystem-safe form of an account id (used as a filename). */
function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'default';
}

/**
 * Pick the store for an account from env. Each account gets its own home:
 *   - file       → .data/homes/<account>.json (persists across restarts, local dev)
 *   - tablestore → Alibaba Tablestore (production; not yet provisioned)
 *   - default    → in-memory (empty, lost on restart)
 */
export async function makeStore(accountId = 'default'): Promise<HomeStore> {
  const mode = process.env.HEARTH_STORE;
  if (mode === 'tablestore') {
    return createTablestore({
      endpoint: must('TABLESTORE_ENDPOINT'),
      instance: must('TABLESTORE_INSTANCE'),
      accessKeyId: must('ALI_ACCESS_KEY_ID', 'ALIBABA_ACCESS_KEY_ID'),
      accessKeySecret: must('ALI_ACCESS_KEY_SECRET', 'ALIBABA_ACCESS_KEY_SECRET'),
    });
  }
  if (mode === 'file') {
    return FileStore.open(join(dataDir(), 'homes', `${safeId(accountId)}.json`));
  }
  return new MemoryStore();
}

/** First present env var among the given names, else throw with a clear hint. */
function must(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`missing env ${names.join('/')} (required for HEARTH_STORE=tablestore)`);
}

export { parseDuration };
