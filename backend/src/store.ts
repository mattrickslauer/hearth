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
// Type-only, so the notify ↔ store cycle is erased at compile time (no runtime import).
import type { NotifyConfig } from './notify';

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
  vision?: boolean; // true for a camera frame sensor (cam.frame) — enables the Qwen-VL path + camera card
}
/** One actuator a real hub-reported node exposes — something the cloud can command. */
export interface HubActuatorReport {
  key: string; // e.g. 'led', 'motor'
  kind?: string; // 'switch' | 'relay' | ...
}
/** A real ESP32 node as reported by a paired on-prem hub. */
export interface HubNodeReport {
  id: string;
  board?: string;
  fw?: string;
  online: boolean;
  lastSeen: number;
  sensors: HubSensorReport[];
  actuators?: HubActuatorReport[];
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

/** Last-wins dedupe by id, preserving order. Callers put the entry that should win last. */
const dedupeById = <T extends { id: string }>(items: T[]): T[] => [...new Map(items.map((i) => [i.id, i])).values()];

/** Emoji marker for a sensor kind — mirrors the demo Capability.icon convention. */
const iconFor = (kind?: string): string =>
  kind === 'temperature'
    ? '🌡️'
    : kind === 'humidity'
      ? '💧'
      : kind === 'distance'
        ? '📏'
        : kind === 'motion'
          ? '🚶'
          : kind === 'camera'
            ? '📷'
            : '📟';

/** Emoji marker for an actuator kind. */
const actuatorIconFor = (kind?: string): string =>
  kind === 'relay' ? '🔌' : kind === 'motor' ? '🌀' : kind === 'servo' ? '⚙️' : '🎛️';

export interface RunEventRow {
  id: string;
  ts: number;
  questionId: string;
  kind: string;
  answer?: boolean;
  reasoning?: string;
  evaluatedBy?: 'local' | 'qwen';
}

/**
 * A household member the homeowner uploaded a reference photo of. At judge time these
 * become reference images for Qwen-VL so it can tell family from strangers. `image` is a
 * `data:` URI (base64) now; when OSS is provisioned it becomes a durable OSS URL instead.
 */
export interface HouseholdMember {
  id: string;
  label: string; // name, e.g. "Alex", "the grey Honda", "Rex"
  tags: string[]; // categories for AI reasoning, e.g. ["family"], ["vehicle","allowed"], ["pet"]
  image: string; // data: URI or `oss://` handle
  addedAt: number;
}

/**
 * A cloud watch's evaluation bookkeeping — what the runtime needs to honour
 * `maxCadence` (budget floor), `fire.edge` (rising) and `fire.cooldown`.
 *
 * This deliberately does NOT live in the event feed. The feed de-noises: a watch that
 * keeps judging "nothing there" writes no rows, so deriving `lastJudgedAt` from events
 * would leave it stale forever and the budget floor would never meter the quiet case —
 * which is exactly the case that burns tokens. Separate concerns, separate records.
 *
 * Kept per-question so two FC instances converge on the same row rather than each
 * holding their own idea of when the watch last looked.
 */
export interface WatchRunState {
  questionId: string;
  lastJudgedAt: number; // when we last spent a cloud call (0 = never)
  lastFiredAt: number; // when it last fired (0 = never)
  lastAnswer: boolean; // the previous verdict — the rising edge compares against this
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
  /** Forget a hub's devices (on unpair). Without this its nodes haunt the Home Model forever. */
  deleteHubDevices(hubId: string): Promise<boolean>;
  /**
   * Drop a node from every hub snapshot reporting it; resolves to the number of snapshots
   * changed (0 = no such node). Deliberately not scoped to one hub: the case this exists for
   * is a node duplicated ACROSS snapshots, where naming the right hub is precisely what the
   * user can't do — the stale hub isn't in the registry to be named.
   *
   * A node still physically attached comes back on its hub's next sync, by design: this
   * prunes the RECORD, and only records with no hardware behind them stay pruned.
   */
  removeHubNode(nodeId: string): Promise<number>;
  /** The desired per-sensor sample cadence (input id "<node>.<key>" → ms) the account requested. */
  getCadences(): Promise<Record<string, number>>;
  /** Set (or clear, when ms is null) one sensor's desired sample cadence in milliseconds. */
  setCadence(input: string, intervalMs: number | null): Promise<void>;
  /** Upsert a household member (reference photo Qwen-VL uses to recognise family). */
  putHouseholdMember(m: HouseholdMember): Promise<void>;
  /** All household members with their reference images. */
  listHousehold(): Promise<HouseholdMember[]>;
  /** Remove a household member; true if one was removed. */
  deleteHouseholdMember(id: string): Promise<boolean>;
  /** A cloud watch's eval bookkeeping (cadence floor / rising edge / cooldown). */
  getRunState(questionId: string): Promise<WatchRunState | null>;
  /** Persist a cloud watch's eval bookkeeping. */
  putRunState(state: WatchRunState): Promise<void>;
  /** The desired actuator states (input id "<node>.<key>" → on/off) — the device shadow. */
  getDesired(): Promise<Record<string, boolean>>;
  /** Set (or clear, when on is null) one actuator's desired state — the cloud→node command. */
  setDesired(input: string, on: boolean | null): Promise<void>;
  /** Where this account's "notify me" pushes are delivered (Telegram / email). */
  getNotifyConfig(): Promise<NotifyConfig>;
  /** Replace this account's notification channels. Holds a live bot token — backend only. */
  setNotifyConfig(config: NotifyConfig): Promise<void>;
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
  household: HouseholdMember[];
  desired: [string, boolean][];
  notifyConfig: NotifyConfig;
  runs: WatchRunState[];
}

const emptyModel = (): HomeModel => ({ zones: [], nodes: [], capabilities: [] });

export class MemoryStore implements HomeStore {
  protected model: HomeModel = emptyModel();
  protected readings = new Map<string, Reading[]>();
  protected questions = new Map<string, Question>();
  protected records = new Map<string, RecordPolicy>();
  protected events: RunEventRow[] = [];
  protected hubDevices = new Map<string, HubDeviceSnapshot>();
  // Per-sensor desired sample cadence in ms (input id "<node>.<key>" → ms). Relayed to the
  // owning hub on its next device sync, which in turn tells the node on its next ingest POST.
  protected cadences = new Map<string, number>();
  // Household members' reference photos — Qwen-VL's ground truth for "who is family".
  protected household = new Map<string, HouseholdMember>();
  // Desired actuator state (input id "<node>.<key>" → on/off) — the "desired" half of the
  // device shadow. Set by the actuate tool; delivered to the node the same way cadences are
  // (hub device sync → node ingest response), where the node converges its output to match.
  protected desired = new Map<string, boolean>();
  // Where this account's "notify me" pushes land (Telegram chat / email address). Read by
  // the /hub/notify fan-out and the notify tool; set from the dashboard. Holds a live bot
  // token, so it is redacted on the way out (notify.ts redactNotifyConfig).
  protected notifyConfig: NotifyConfig = { telegram: null, email: null, updatedAt: 0 };
  // Per-cloud-watch eval bookkeeping — see WatchRunState on why this isn't derived from events.
  protected runs = new Map<string, WatchRunState>();

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
      household: [...this.household.values()],
      desired: [...this.desired.entries()],
      notifyConfig: this.notifyConfig,
      runs: [...this.runs.values()],
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
    this.household = new Map((s.household ?? []).map((m) => [m.id, m]));
    this.desired = new Map(s.desired ?? []);
    this.notifyConfig = s.notifyConfig ?? { telegram: null, email: null, updatedAt: 0 };
    this.runs = new Map((s.runs ?? []).map((r) => [r.questionId, r]));
  }

  /**
   * Hub snapshots oldest-sync-first, so that folding them into a map keyed by id leaves the
   * FRESHEST hub owning any contested id.
   *
   * Node ids are only unique within a hub — a camera self-describes as `hub-cam` on every hub
   * by default — so two hubs reporting one id is not a corrupt state, it's the default one.
   * It happens routinely: a hub that re-enrolls (401 → fresh hubId) leaves its old snapshot
   * behind, and both then claim `hub-cam.cam.frame`. Whoever synced most recently is the one
   * still plugged in, so let them win.
   */
  private snapshotsOldestFirst(): HubDeviceSnapshot[] {
    return [...this.hubDevices.values()].sort((a, b) => (a.syncedAt ?? 0) - (b.syncedAt ?? 0));
  }

  /** Capabilities derived from every paired hub's real nodes (merged into the model). */
  private hubCapabilities(): Capability[] {
    // Keyed by capability id: duplicates here reach the dashboard as two React children with
    // the same key, and reach Qwen as the same sensor listed twice.
    const byId = new Map<string, Capability>();
    const add = (c: Capability) => byId.set(c.id, c);
    for (const snap of this.snapshotsOldestFirst())
      for (const n of snap.nodes) {
        for (const s of n.sensors)
          add({
            id: `${n.id}.${s.key}`,
            label: `${n.id} · ${s.key}`,
            kind: 'sensor',
            icon: iconFor(s.vision ? 'camera' : s.kind),
            unit: s.unit,
            describes: `live ${s.vision ? 'camera' : (s.kind ?? 'sensor')} on hub node ${n.id}${snap.hubName ? ` (hub: ${snap.hubName})` : ''}`,
            vision: s.vision,
          });
        for (const a of n.actuators ?? [])
          add({
            id: `${n.id}.${a.key}`,
            label: `${n.id} · ${a.key}`,
            kind: 'actuator',
            icon: actuatorIconFor(a.kind),
            describes: `commandable ${a.kind ?? 'actuator'} on hub node ${n.id}${snap.hubName ? ` (hub: ${snap.hubName})` : ''} — drive it with the actuate tool`,
          });
      }
    return [...byId.values()];
  }
  /** Home-Model nodes derived from paired hubs' real ESP32 nodes. */
  private hubModelNodes(): HomeNode[] {
    // Same contested-id story as hubCapabilities(): freshest hub wins the node.
    const byId = new Map<string, HomeNode>();
    for (const snap of this.snapshotsOldestFirst())
      for (const n of snap.nodes)
        byId.set(n.id, {
          id: n.id,
          name: n.id,
          // Real hub nodes aren't bound to the demo zones; label the zone by hub.
          zone: snap.hubName ?? snap.hubId,
          hardware: n.board ?? 'esp32',
          capabilities: [
            ...n.sensors.map((s) => ({
              id: `${n.id}.${s.key}`,
              label: `${n.id} · ${s.key}`,
              kind: 'sensor' as const,
              icon: iconFor(s.vision ? 'camera' : s.kind),
              unit: s.unit,
              describes: `live ${s.vision ? 'camera' : (s.kind ?? 'sensor')} on ${n.id}`,
              vision: s.vision,
            })),
            ...(n.actuators ?? []).map((a) => ({
              id: `${n.id}.${a.key}`,
              label: `${n.id} · ${a.key}`,
              kind: 'actuator' as const,
              icon: actuatorIconFor(a.kind),
              describes: `commandable ${a.kind ?? 'actuator'} on ${n.id}`,
            })),
          ],
        } as HomeNode);
    return [...byId.values()];
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
    // Hub entries come last, so real hardware outranks a same-id model entry.
    return {
      zones: this.model.zones,
      nodes: dedupeById([...this.model.nodes, ...hubNodes]),
      capabilities: dedupeById([...this.model.capabilities, ...this.hubCapabilities()]),
    };
  }
  async listInputs(filter?: 'sensor' | 'actuator'): Promise<Capability[]> {
    const caps = dedupeById([...this.model.capabilities, ...this.hubCapabilities()]);
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
  async deleteHubDevices(hubId: string): Promise<boolean> {
    const had = this.hubDevices.delete(hubId);
    if (had) this.persist();
    return had;
  }
  async removeHubNode(nodeId: string): Promise<number> {
    let changed = 0;
    for (const [hubId, snap] of this.hubDevices) {
      const nodes = snap.nodes.filter((n) => n.id !== nodeId);
      if (nodes.length === snap.nodes.length) continue;
      this.hubDevices.set(hubId, { ...snap, nodes });
      changed++;
    }
    if (changed) this.persist();
    return changed;
  }
  async getCadences(): Promise<Record<string, number>> {
    return Object.fromEntries(this.cadences);
  }
  async setCadence(input: string, intervalMs: number | null): Promise<void> {
    if (intervalMs == null) this.cadences.delete(input);
    else this.cadences.set(input, intervalMs);
    this.persist();
  }
  async putHouseholdMember(m: HouseholdMember): Promise<void> {
    this.household.set(m.id, m);
    this.persist();
  }
  async listHousehold(): Promise<HouseholdMember[]> {
    return [...this.household.values()].sort((a, b) => a.addedAt - b.addedAt);
  }
  async deleteHouseholdMember(id: string): Promise<boolean> {
    const existed = this.household.delete(id);
    if (existed) this.persist();
    return existed;
  }
  async getRunState(questionId: string): Promise<WatchRunState | null> {
    return this.runs.get(questionId) ?? null;
  }
  async putRunState(state: WatchRunState): Promise<void> {
    this.runs.set(state.questionId, state);
    this.persist();
  }
  async getDesired(): Promise<Record<string, boolean>> {
    return Object.fromEntries(this.desired);
  }
  async setDesired(input: string, on: boolean | null): Promise<void> {
    if (on == null) this.desired.delete(input);
    else this.desired.set(input, on);
    this.persist();
  }
  async getNotifyConfig(): Promise<NotifyConfig> {
    return this.notifyConfig;
  }
  async setNotifyConfig(config: NotifyConfig): Promise<void> {
    this.notifyConfig = config;
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
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

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
    // Flush any pending write on clean shutdown so a debounced burst isn't lost.
    const onExit = () => s.flush();
    process.once('exit', onExit);
    process.once('beforeExit', onExit);
    return s;
  }

  // Coalesce bursts (e.g. a hub sync writing K readings) into a single snapshot write
  // instead of rewriting the whole file K times — previously O(n²) per sync.
  protected persist(): void {
    this.dirty = true;
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => this.flush(), 50);
    if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
  }

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty) return;
    this.dirty = false;
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

/* Live readings live in their OWN table, separate from hearth_home, because retention is a
 * per-table property in Tablestore. hearth_home is timeToLive:-1 (watches and pairings are
 * forever); readings expire after 24h, swept server-side by Tablestore itself so there is no
 * cron, no sweeper, and no unbounded growth. Rows are keyed
 * account / "<input>#<zero-padded ms>" so one input's window is a single ordered range scan.
 * The padding is what makes lexicographic key order equal chronological order. */
const TS_READINGS_TABLE = 'hearth_readings';
const READING_TTL_SEC = 24 * 60 * 60;

/** ms → fixed-width key component, so string order == time order (13 digits holds to y2286). */
const tsKey = (ts: number) => String(Math.max(0, Math.floor(ts))).padStart(13, '0');

// The `tablestore` SDK ships no type declarations; treat it as an opaque handle.
type TsModule = {
  Client: new (opts: object) => TsClient;
  Condition: new (existence: unknown, columnCondition: unknown) => unknown;
  RowExistenceExpectation: { IGNORE: unknown };
  Direction: { FORWARD: unknown; BACKWARD: unknown };
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

  /** Create the shared tables on first use; pre-existing tables are the steady state. */
  private async ensureTable(): Promise<void> {
    await this.createTable(TS_TABLE, -1);
    // Readings: same key shape, but Tablestore expires rows 24h after write for us.
    await this.createTable(TS_READINGS_TABLE, READING_TTL_SEC);
  }

  private async createTable(tableName: string, timeToLive: number): Promise<void> {
    try {
      await this.client.createTable({
        tableMeta: {
          tableName,
          primaryKey: [
            { name: 'account', type: 'STRING' },
            { name: 'sk', type: 'STRING' },
          ],
        },
        reservedThroughput: { capacityUnit: { read: 0, write: 0 } },
        tableOptions: { timeToLive, maxVersions: 1 },
      });
    } catch (e) {
      if (!/already exist/i.test((e as Error).message || '')) throw e;
    }
  }

  /* ---- durable live readings (24h, own table, server-side TTL) --------------------
   * MemoryStore keeps readings on the heap, which is wrong on Function Compute: instances are
   * ephemeral and horizontally scaled, so a hub's sync could land on one instance while the
   * dashboard's read hit another and saw nothing. These three overrides are the fix — every
   * read goes to Tablestore, so any instance answers identically and the series survives a
   * freeze. We deliberately do NOT keep a heap copy: a per-instance cache would reintroduce
   * exactly the divergence this replaces. */

  /** Scan one input's rows in [from, to] (inclusive). Backward+limit yields the newest first. */
  private async scanReadings(input: string, from: number, to: number, opts: { newestFirst?: boolean; limit?: number } = {}): Promise<Reading[]> {
    const backward = opts.newestFirst === true;
    // '#' (0x23) opens the input's range and '$' (0x24) closes it, so `<input>$` sorts above
    // every `<input>#…` row — the same trick listQuestions() uses for its q#/q$ sweep.
    const lo = `${input}#${tsKey(from)}`;
    const hi = backward ? `${input}$` : `${input}#${tsKey(to + 1)}`; // +1: exclusive end, so ts==to is kept
    const out: Reading[] = [];
    let start: unknown[] | null = backward ? [{ account: this.account }, { sk: hi }] : [{ account: this.account }, { sk: lo }];
    const end = backward ? [{ account: this.account }, { sk: lo }] : [{ account: this.account }, { sk: hi }];
    while (start) {
      const res = await this.client.getRange({
        tableName: TS_READINGS_TABLE,
        direction: backward ? this.ts.Direction.BACKWARD : this.ts.Direction.FORWARD,
        inclusiveStartPrimaryKey: start,
        exclusiveEndPrimaryKey: end,
        limit: opts.limit ?? 500,
      });
      for (const row of res.rows ?? []) {
        const data = this.dataOf(row.attributes);
        if (!data) continue;
        const r = JSON.parse(data) as Reading;
        if (r.ts >= from && r.ts <= to) out.push(r);
      }
      if (opts.limit && out.length >= opts.limit) return out.slice(0, opts.limit);
      start = res.next_start_primary_key ?? null;
    }
    return out;
  }

  async appendReading(input: string, value: Scalar, ts: number): Promise<void> {
    await this.client.putRow({
      tableName: TS_READINGS_TABLE,
      condition: this.ignore(),
      primaryKey: this.pk(`${input}#${tsKey(ts)}`),
      attributeColumns: [{ data: JSON.stringify({ input, ts, value } satisfies Reading) }],
    });
  }

  async readInput(input: string, agg: Agg, windowMs: number, now: number): Promise<Reading | null> {
    const from = windowMs > 0 ? now - windowMs : 0;
    // 'latest' is the dashboard's hot path: one backward-scanned row beats paging a whole day.
    if (agg === 'latest') {
      const [row] = await this.scanReadings(input, from, now, { newestFirst: true, limit: 1 });
      return row ?? null;
    }
    return aggregate(await this.scanReadings(input, from, now), agg, windowMs, now);
  }

  async history(input: string, from: number, to: number): Promise<Reading[]> {
    return this.scanReadings(input, from, to);
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

  /* ---- durable device registry + cadences (per-account rows in the shared table) ----
   * Watches persist above; these keep the paired-hub device LIST and the user's per-sensor
   * cadences across a redeploy too, so the dashboard fills in immediately instead of waiting
   * for the hub's next sync. Live readings are durable too — see the 24h TTL table above. */
  private hydrated = false;
  private hubSigs = new Map<string, string>();

  private async putBlob(sk: string, obj: unknown): Promise<void> {
    await this.client.putRow({
      tableName: TS_TABLE,
      condition: this.ignore(),
      primaryKey: this.pk(sk),
      attributeColumns: [{ data: JSON.stringify(obj) }],
    });
  }
  private async getBlob(sk: string): Promise<string | null> {
    const res = await this.client.getRow({ tableName: TS_TABLE, primaryKey: this.pk(sk), maxVersions: 1 });
    return this.dataOf(res.row?.attributes);
  }
  private async scanBlobs(skStart: string, skEnd: string): Promise<string[]> {
    const out: string[] = [];
    let start: unknown[] | null = [{ account: this.account }, { sk: skStart }];
    const end = [{ account: this.account }, { sk: skEnd }];
    while (start) {
      const res = await this.client.getRange({
        tableName: TS_TABLE,
        direction: this.ts.Direction.FORWARD,
        inclusiveStartPrimaryKey: start,
        exclusiveEndPrimaryKey: end,
        limit: 200,
      });
      for (const row of res.rows ?? []) {
        const d = this.dataOf(row.attributes);
        if (d) out.push(d);
      }
      start = res.next_start_primary_key ?? null;
    }
    return out;
  }
  // Identity signature — node ids + their sensor keys. Values change every reading; identity
  // (which nodes/sensors exist) rarely does, so we only re-persist the snapshot when it shifts.
  private static sig(snap: HubDeviceSnapshot): string {
    return JSON.stringify(snap.nodes.map((n) => [n.id, n.sensors.map((s) => s.key).sort()]).sort());
  }
  private async hydrate(): Promise<void> {
    if (this.hydrated) return;
    this.hydrated = true;
    try {
      for (const d of await this.scanBlobs('hd#', 'hd$')) {
        const snap = JSON.parse(d) as HubDeviceSnapshot;
        this.hubDevices.set(snap.hubId, snap);
        this.hubSigs.set(snap.hubId, TablestoreStore.sig(snap));
      }
    } catch {
      /* first run for this account → no rows yet */
    }
  }

  async describeHome(): Promise<HomeModel> {
    await this.hydrate();
    return super.describeHome();
  }
  async listInputs(filter?: 'sensor' | 'actuator'): Promise<Capability[]> {
    await this.hydrate();
    return super.listInputs(filter);
  }
  async listHubDevices(): Promise<HubDeviceSnapshot[]> {
    await this.hydrate();
    return super.listHubDevices();
  }
  async putHubDevices(snap: HubDeviceSnapshot): Promise<void> {
    await super.putHubDevices(snap); // in-memory: fresh readings for this instance
    const sig = TablestoreStore.sig(snap);
    if (this.hubSigs.get(snap.hubId) !== sig) {
      this.hubSigs.set(snap.hubId, sig);
      await this.putBlob(`hd#${snap.hubId}`, snap); // persist only when device identity changes
    }
  }
  async deleteHubDevices(hubId: string): Promise<boolean> {
    await super.deleteHubDevices(hubId);
    // Drop the cached signature too, or a hub that re-pairs and reports an identical device
    // list would be treated as "unchanged" and never re-persisted.
    this.hubSigs.delete(hubId);
    if (!(await this.getBlob(`hd#${hubId}`))) return false;
    await this.client.deleteRow({ tableName: TS_TABLE, condition: this.ignore(), primaryKey: this.pk(`hd#${hubId}`) });
    return true;
  }
  async removeHubNode(nodeId: string): Promise<number> {
    await this.hydrate();
    const before = await super.listHubDevices();
    const changed = await super.removeHubNode(nodeId);
    if (!changed) return 0;
    // Re-persist only the snapshots that actually lost the node. Their identity changed by
    // definition, so the sig check in putHubDevices can't help us here — write through directly.
    const touched = before.filter((s) => s.nodes.some((n) => n.id === nodeId)).map((s) => s.hubId);
    await Promise.all(
      touched.map(async (hubId) => {
        const snap = (await super.listHubDevices()).find((s) => s.hubId === hubId);
        if (!snap) return;
        this.hubSigs.set(hubId, TablestoreStore.sig(snap));
        await this.putBlob(`hd#${hubId}`, snap);
      }),
    );
    return changed;
  }
  async getCadences(): Promise<Record<string, number>> {
    // Read through so a cadence set on another FC instance is seen on the hub's next sync.
    const d = await this.getBlob('cadences');
    if (!d) return {};
    try {
      return JSON.parse(d) as Record<string, number>;
    } catch {
      return {};
    }
  }
  async setCadence(input: string, intervalMs: number | null): Promise<void> {
    await super.setCadence(input, intervalMs); // in-memory
    await this.putBlob('cadences', Object.fromEntries(this.cadences));
  }
  // Household members persist as per-account rows `hm#<id>` (read/write-through), like watches.
  async putHouseholdMember(m: HouseholdMember): Promise<void> {
    await this.putBlob(`hm#${m.id}`, m);
  }
  async listHousehold(): Promise<HouseholdMember[]> {
    const rows = await this.scanBlobs('hm#', 'hm$');
    return rows.map((d) => JSON.parse(d) as HouseholdMember).sort((a, b) => a.addedAt - b.addedAt);
  }
  async deleteHouseholdMember(id: string): Promise<boolean> {
    if (!(await this.getBlob(`hm#${id}`))) return false;
    await this.client.deleteRow({ tableName: TS_TABLE, condition: this.ignore(), primaryKey: this.pk(`hm#${id}`) });
    return true;
  }
  async getDesired(): Promise<Record<string, boolean>> {
    // Read through so a command set on another FC instance is seen on the hub's next sync.
    const d = await this.getBlob('desired');
    if (!d) return {};
    try {
      return JSON.parse(d) as Record<string, boolean>;
    } catch {
      return {};
    }
  }
  async setDesired(input: string, on: boolean | null): Promise<void> {
    await super.setDesired(input, on); // in-memory
    await this.putBlob('desired', Object.fromEntries(this.desired));
  }
  async getNotifyConfig(): Promise<NotifyConfig> {
    // Read through: the hub's fire lands on whichever FC instance answers, which is rarely
    // the one the dashboard saved on. A stale in-memory copy would notify the old channel.
    const d = await this.getBlob('notify');
    if (!d) return { telegram: null, email: null, updatedAt: 0 };
    try {
      const parsed = JSON.parse(d) as Partial<NotifyConfig>;
      return { telegram: parsed.telegram ?? null, email: parsed.email ?? null, updatedAt: parsed.updatedAt ?? 0 };
    } catch {
      return { telegram: null, email: null, updatedAt: 0 };
    }
  }
  async setNotifyConfig(config: NotifyConfig): Promise<void> {
    await super.setNotifyConfig(config); // in-memory
    await this.putBlob('notify', config);
  }
  // Run state persists per-question (`rs#<id>`), read/write-through: two FC instances
  // must agree on when a watch last looked, or each would meter against its own clock
  // and the budget floor would leak by a factor of however many instances are warm.
  async getRunState(questionId: string): Promise<WatchRunState | null> {
    const d = await this.getBlob(`rs#${questionId}`);
    if (!d) return null;
    try {
      return JSON.parse(d) as WatchRunState;
    } catch {
      return null;
    }
  }
  async putRunState(state: WatchRunState): Promise<void> {
    await super.putRunState(state); // in-memory
    await this.putBlob(`rs#${state.questionId}`, state);
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
