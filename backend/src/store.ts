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

/** One sensor a real hub-reported node exposes. */
export interface HubSensorReport {
  key: string; // e.g. 'board.temp'
  kind?: string; // 'temperature' | 'humidity' | ...
  unit?: string;
}
/** A real ESP32 node as reported by a paired on-prem hub. */
export interface HubNodeReport {
  id: string;
  board?: string;
  fw?: string;
  online: boolean;
  lastSeen: number;
  sensors: HubSensorReport[];
  readings: Record<string, number | null>;
}
/** A paired hub's live device snapshot, pushed up by the hub agent. */
export interface HubDeviceSnapshot {
  hubId: string;
  hubName?: string;
  platform?: string;
  fw?: string;
  nodes: HubNodeReport[];
  syncedAt: number;
}

/** Emoji marker for a sensor kind — mirrors the demo Capability.icon convention. */
const iconFor = (kind?: string): string =>
  kind === 'temperature' ? '🌡️' : kind === 'humidity' ? '💧' : kind === 'distance' ? '📏' : kind === 'motion' ? '🚶' : '📟';

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
  /** Upsert a paired hub's device snapshot (keyed by hubId). Feeds the Home Model. */
  putHubDevices(snap: HubDeviceSnapshot): Promise<void>;
  /** All paired hubs' latest device snapshots. */
  listHubDevices(): Promise<HubDeviceSnapshot[]>;
  /** The desired per-node sample cadence (nodeId → ms) the account has requested. */
  getCadences(): Promise<Record<string, number>>;
  /** Set (or clear, when ms is null) a node's desired sample cadence in milliseconds. */
  setCadence(nodeId: string, intervalMs: number | null): Promise<void>;
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
  hubDevices: HubDeviceSnapshot[];
  cadences: [string, number][];
}

const emptyModel = (): HomeModel => ({ zones: [], nodes: [], capabilities: [] });

export class MemoryStore implements HomeStore {
  protected model: HomeModel = emptyModel();
  protected readings = new Map<string, Reading[]>();
  protected questions = new Map<string, Question>();
  protected records = new Map<string, RecordPolicy>();
  protected events: RunEventRow[] = [];
  protected hubDevices = new Map<string, HubDeviceSnapshot>();
  // Per-node desired sample cadence in ms (nodeId → ms). Relayed to the owning hub on
  // its next device sync, which in turn tells the node on its next ingest POST.
  protected cadences = new Map<string, number>();

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
      hubDevices: [...this.hubDevices.values()],
      cadences: [...this.cadences.entries()],
    };
  }
  protected restore(s: Partial<StoreSnapshot>): void {
    this.model = s.model ?? emptyModel();
    this.questions = new Map((s.questions ?? []).map((q) => [q.id, q]));
    this.records = new Map((s.records ?? []).map((r) => [r.inputId, r]));
    this.events = s.events ?? [];
    this.readings = new Map(s.readings ?? []);
    this.hubDevices = new Map((s.hubDevices ?? []).map((h) => [h.hubId, h]));
    this.cadences = new Map(s.cadences ?? []);
  }

  /** Capabilities derived from every paired hub's real nodes (merged into the model). */
  private hubCapabilities(): Capability[] {
    const caps: Capability[] = [];
    for (const snap of this.hubDevices.values())
      for (const n of snap.nodes)
        for (const s of n.sensors)
          caps.push({
            id: `${n.id}.${s.key}`,
            label: `${n.id} · ${s.key}`,
            kind: 'sensor',
            icon: iconFor(s.kind),
            unit: s.unit,
            describes: `live ${s.kind ?? 'sensor'} on hub node ${n.id}${snap.hubName ? ` (hub: ${snap.hubName})` : ''}`,
          });
    return caps;
  }
  /** Home-Model nodes derived from paired hubs' real ESP32 nodes. */
  private hubModelNodes(): HomeNode[] {
    const out: HomeNode[] = [];
    for (const snap of this.hubDevices.values())
      for (const n of snap.nodes)
        out.push({
          id: n.id,
          name: n.id,
          // Real hub nodes aren't bound to the demo zones; label the zone by hub.
          zone: snap.hubName ?? snap.hubId,
          hardware: n.board ?? 'esp32',
          capabilities: n.sensors.map((s) => ({
            id: `${n.id}.${s.key}`,
            label: `${n.id} · ${s.key}`,
            kind: 'sensor' as const,
            icon: iconFor(s.kind),
            unit: s.unit,
            describes: `live ${s.kind ?? 'sensor'} on ${n.id}`,
          })),
        } as HomeNode);
    return out;
  }

  private push(input: string, value: Scalar, ts: number) {
    const arr = this.readings.get(input) ?? [];
    arr.push({ input, ts, value });
    if (arr.length > 5000) arr.shift();
    this.readings.set(input, arr);
  }

  async describeHome(): Promise<HomeModel> {
    const hubNodes = this.hubModelNodes();
    if (!hubNodes.length) return this.model;
    return {
      zones: this.model.zones,
      nodes: [...this.model.nodes, ...hubNodes],
      capabilities: [...this.model.capabilities, ...this.hubCapabilities()],
    };
  }
  async listInputs(filter?: 'sensor' | 'actuator'): Promise<Capability[]> {
    const caps = [...this.model.capabilities, ...this.hubCapabilities()];
    return caps.filter((c) => !filter || c.kind === filter);
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
  async putHubDevices(snap: HubDeviceSnapshot): Promise<void> {
    this.hubDevices.set(snap.hubId, snap);
    this.persist();
  }
  async listHubDevices(): Promise<HubDeviceSnapshot[]> {
    return [...this.hubDevices.values()];
  }
  async getCadences(): Promise<Record<string, number>> {
    return Object.fromEntries(this.cadences);
  }
  async setCadence(nodeId: string, intervalMs: number | null): Promise<void> {
    if (intervalMs == null) this.cadences.delete(nodeId);
    else this.cadences.set(nodeId, intervalMs);
    this.persist();
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
 * Alibaba Tablestore adapter — durable, multi-instance-safe persistence for authored
 * watches. One table `hearth_home` with a composite primary key (account, sk); each
 * watch is a row `sk = q#<id>` holding the Question JSON.
 *
 * Question reads AND writes go THROUGH to Tablestore on every call (they are not
 * served from instance memory), so every Function Compute instance sees the same set
 * of watches — which is exactly what the in-memory / file stores could not guarantee
 * across FC's multiple, recycled instances. The home model + live readings stay
 * in-memory (the model is static; readings are transient telemetry that repopulate
 * from sensors), so only the durable, low-volume authored config hits Tablestore.
 */
export interface TablestoreConfig {
  endpoint: string;
  instance: string;
  accessKeyId: string;
  accessKeySecret: string;
}

const TS_TABLE = 'hearth_home';

// The `tablestore` SDK ships no type declarations; treat it as an opaque handle.
type TsModule = {
  Client: new (opts: object) => TsClient;
  Condition: new (existence: unknown, columnCondition: unknown) => unknown;
  RowExistenceExpectation: { IGNORE: unknown };
  Direction: { FORWARD: unknown };
};
type TsAttr = { columnName: string; columnValue: unknown };
type TsClient = {
  createTable(p: object): Promise<unknown>;
  putRow(p: object): Promise<unknown>;
  getRow(p: object): Promise<{ row?: { attributes?: TsAttr[] } }>;
  deleteRow(p: object): Promise<unknown>;
  getRange(p: object): Promise<{ rows?: { attributes: TsAttr[] }[]; next_start_primary_key?: unknown[] | null }>;
};

class TablestoreStore extends MemoryStore {
  private constructor(
    private readonly ts: TsModule,
    private readonly client: TsClient,
    private readonly account: string,
  ) {
    super(false);
  }

  static async open(ts: TsModule, cfg: TablestoreConfig, account: string): Promise<TablestoreStore> {
    const client = new ts.Client({
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.accessKeySecret,
      endpoint: cfg.endpoint,
      instancename: cfg.instance,
    });
    const store = new TablestoreStore(ts, client, account);
    await store.ensureTable();
    return store;
  }

  private pk(sk: string) {
    return [{ account: this.account }, { sk }];
  }
  private ignore() {
    return new this.ts.Condition(this.ts.RowExistenceExpectation.IGNORE, null);
  }
  private dataOf(attrs?: TsAttr[]): string | null {
    const v = attrs?.find((a) => a.columnName === 'data')?.columnValue;
    return typeof v === 'string' ? v : null;
  }

  /** Create the shared table on first use; a pre-existing table is the steady state. */
  private async ensureTable(): Promise<void> {
    try {
      await this.client.createTable({
        tableMeta: {
          tableName: TS_TABLE,
          primaryKey: [
            { name: 'account', type: 'STRING' },
            { name: 'sk', type: 'STRING' },
          ],
        },
        reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
        tableOptions: { timeToLive: -1, maxVersions: 1 },
      });
    } catch (e) {
      if (!/already exist/i.test((e as Error).message || '')) throw e;
    }
  }

  async putQuestion(q: Question): Promise<void> {
    await this.client.putRow({
      tableName: TS_TABLE,
      condition: this.ignore(),
      primaryKey: this.pk(`q#${q.id}`),
      attributeColumns: [{ data: JSON.stringify(q) }],
    });
  }
  async getQuestion(id: string): Promise<Question | null> {
    const res = await this.client.getRow({ tableName: TS_TABLE, primaryKey: this.pk(`q#${id}`), maxVersions: 1 });
    const data = this.dataOf(res.row?.attributes);
    return data ? (JSON.parse(data) as Question) : null;
  }
  async deleteQuestion(id: string): Promise<boolean> {
    if (!(await this.getQuestion(id))) return false;
    await this.client.deleteRow({ tableName: TS_TABLE, condition: this.ignore(), primaryKey: this.pk(`q#${id}`) });
    return true;
  }
  async listQuestions(): Promise<Question[]> {
    const out: Question[] = [];
    // Scan the account's q# rows. '$' (0x24) sorts just after '#' (0x23), so the
    // exclusive end 'q$' captures every 'q#...' row and nothing beyond it.
    let start: unknown[] | null = [{ account: this.account }, { sk: 'q#' }];
    const end = [{ account: this.account }, { sk: 'q$' }];
    while (start) {
      const res = await this.client.getRange({
        tableName: TS_TABLE,
        direction: this.ts.Direction.FORWARD,
        inclusiveStartPrimaryKey: start,
        exclusiveEndPrimaryKey: end,
        limit: 200,
      });
      for (const row of res.rows ?? []) {
        const data = this.dataOf(row.attributes);
        if (data) out.push(JSON.parse(data) as Question);
      }
      start = res.next_start_primary_key ?? null;
    }
    return out;
  }
}

export async function createTablestore(cfg: TablestoreConfig, accountId: string): Promise<HomeStore> {
  let mod: unknown;
  try {
    // optional dependency — only needed when actually deploying against Tablestore
    mod = await import('tablestore');
  } catch {
    throw new Error(
      "Tablestore selected but the 'tablestore' SDK is not installed. Run `npm i tablestore` in backend/, " +
        'or unset HEARTH_STORE=tablestore to use the in-memory store.',
    );
  }
  // tablestore ships CommonJS; under esbuild's interop the namespace may nest it in `.default`.
  const ts = ((mod as { default?: unknown }).default ?? mod) as TsModule;
  return TablestoreStore.open(ts, cfg, accountId);
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
    return createTablestore(
      {
        endpoint: must('TABLESTORE_ENDPOINT'),
        instance: must('TABLESTORE_INSTANCE'),
        accessKeyId: must('ALI_ACCESS_KEY_ID', 'ALIBABA_ACCESS_KEY_ID'),
        accessKeySecret: must('ALI_ACCESS_KEY_SECRET', 'ALIBABA_ACCESS_KEY_SECRET'),
      },
      accountId,
    );
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
