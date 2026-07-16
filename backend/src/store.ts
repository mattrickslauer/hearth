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
// The ONE Tablestore client singleton + table-creation helpers, shared with auth.ts/hubs.ts.
import { ensureHomeTable, ensureTable, getTablestore } from './tablestore';

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

/**
 * One consequential thing a compiled watch did — the searchable run log.
 *
 * Grain: we write a row per BILLED call (`authored`, `edited`, `judged`) and per
 * OUTCOME (`fired`, `held`, `actuate`, `notify`). We deliberately do NOT write a row
 * per evaluation: a vision watch is evaluated on every frame (up to 2/sec) and is
 * skipped cheaply by the cadence floor or the local gate long before any token is
 * spent. Those skips are counted on `WatchRunState`, not stored — at 0.5s cadence a
 * row each would be ~170k rows/day/watch, and the log would cost more than the looks
 * it audits. Every row here has a real cost or a real consequence.
 *
 * `usd`/`tokens` are MEASURED (`qwen.ts` reads the API's own `usage` block), unlike
 * `pricing.ts`'s quote, which is a forecast from the config. Comparing the two is the
 * point: drift between them is a bug worth seeing.
 *
 * Shape follows `docs/02-data-model.md:241`.
 */
export interface RunEventRow {
  id: string;
  ts: number;
  questionId: string;
  kind: string;
  answer?: boolean;
  reasoning?: string;
  evaluatedBy?: 'local' | 'qwen';
  /** Denormalised watch title — so search can match text without joining every q# row. */
  title?: string;
  /** The model the API said it billed. Absent on rows that spent nothing. */
  model?: string;
  tokens?: { in: number; out: number };
  /** Measured USD for this row's call. Absent (not 0) when nothing was billed. */
  usd?: number;
  /** Wall-clock of the billed call. */
  ms?: number;
  /** True when the model was unknown to MODEL_RATES, so `usd` understates the truth. */
  unrated?: boolean;
}

/** A run-log query. Every field is optional; omitted means "don't filter on this". */
export interface RunQuery {
  /** Inclusive lower/upper bounds on `ts`. */
  from?: number;
  to?: number;
  questionId?: string;
  /** Match any of these kinds. */
  kinds?: string[];
  engine?: 'local' | 'qwen';
  /** Case-insensitive substring over title + reasoning + model. */
  text?: string;
  /** Only rows that actually cost money. */
  billedOnly?: boolean;
  limit?: number;
}

/** What a run search answers: the page of rows, plus the spend they represent. */
export interface RunSearchResult {
  rows: RunEventRow[];
  /** Totals over every row MATCHING the query — not just the returned page. */
  totals: { rows: number; billed: number; usd: number; tokensIn: number; tokensOut: number; unrated: boolean };
}

/** Does one row satisfy a query? Pure, so store adapters and tests share one definition. */
export function matchesRun(ev: RunEventRow, q: RunQuery): boolean {
  if (q.from != null && ev.ts < q.from) return false;
  if (q.to != null && ev.ts > q.to) return false;
  if (q.questionId && ev.questionId !== q.questionId) return false;
  if (q.kinds?.length && !q.kinds.includes(ev.kind)) return false;
  if (q.engine && ev.evaluatedBy !== q.engine) return false;
  if (q.billedOnly && !ev.usd) return false;
  if (q.text) {
    // Title / reasoning / model only — matching `kind` too would contradict the documented
    // text-search fields (see RunQuery.text and the search_runs tool description).
    const hay = `${ev.title ?? ''} ${ev.reasoning ?? ''} ${ev.model ?? ''}`.toLowerCase();
    if (!hay.includes(q.text.toLowerCase())) return false;
  }
  return true;
}

/** Roll a matched set up into the spend line. */
export function totalRuns(rows: RunEventRow[]): RunSearchResult['totals'] {
  return {
    rows: rows.length,
    billed: rows.filter((r) => r.usd != null).length,
    usd: rows.reduce((n, r) => n + (r.usd ?? 0), 0),
    tokensIn: rows.reduce((n, r) => n + (r.tokens?.in ?? 0), 0),
    tokensOut: rows.reduce((n, r) => n + (r.tokens?.out ?? 0), 0),
    unrated: rows.some((r) => r.unrated),
  };
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
  /**
   * Lifetime tallies. These are the cheap half of the run log: skips are far too
   * numerous to store a row each (see RunEventRow), but "the gate saved you 40,000
   * calls" is the single most valuable number the cost UI can show — it's the savings
   * the local gate actually delivered. Counters, not rows: O(1) storage, O(1) read.
   */
  skips?: Partial<Record<'cadence' | 'gate' | 'no-frame' | 'cooldown' | 'edge', number>>;
  /** Lifetime billed calls and measured spend for this watch — running totals. */
  judged?: number;
  usd?: number;
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
  /** Search the run log by time/watch/kind/text and get the spend for the match. */
  searchRuns(q: RunQuery): Promise<RunSearchResult>;
  /** Bump a watch's skip tally — the calls the cadence floor and gate did NOT spend. */
  countSkip(questionId: string, reason: string): Promise<void>;
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
  /**
   * Does this account have a sensor with this exact input id?
   *
   * Lives on the store because the store IS the account boundary — anything holding one has
   * already been scoped by the caller's token, so this cannot be asked about someone else by
   * accident. Exact match against a declared sensor, never a `<node>.` prefix: a prefix test
   * lets a node id reach inputs its node never declared.
   */
  ownsInput(input: string): Promise<boolean>;
  /**
   * Does this account have an ACTUATOR with this exact input id? The actuator twin of ownsInput —
   * same account-boundary reasoning, exact match against an actuator a paired hub's node declared.
   */
  ownsActuator(input: string): Promise<boolean>;
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
  /**
   * Heap scan. Correct here because MemoryStore's feed is capped at 500 rows anyway —
   * TablestoreStore overrides this with a bounded range scan over the real log.
   */
  async searchRuns(q: RunQuery): Promise<RunSearchResult> {
    const hits = this.events.filter((ev) => matchesRun(ev, q));
    return { rows: hits.slice(0, q.limit ?? 50), totals: totalRuns(hits) };
  }
  /**
   * Read-modify-write, so two FC instances skipping the same watch in the same instant
   * can lose an increment. Accepted knowingly: this is a "the gate saved you ~40k calls"
   * display counter, not a ledger — every number that becomes money is a `usd` on an
   * immutable run row instead. Tablestore's atomic increment would need a numeric column
   * per reason, which is a schema change for a stat nobody reads to the unit.
   */
  async countSkip(questionId: string, reason: string): Promise<void> {
    const prev = (await this.getRunState(questionId)) ?? {
      questionId,
      lastJudgedAt: 0,
      lastFiredAt: 0,
      lastAnswer: false,
    };
    const skips = { ...prev.skips };
    skips[reason as keyof typeof skips] = (skips[reason as keyof typeof skips] ?? 0) + 1;
    await this.putRunState({ ...prev, skips });
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
  async ownsInput(input: string): Promise<boolean> {
    const snaps = await this.listHubDevices();
    return snaps.some((snap) => snap.nodes.some((n) => n.sensors.some((s) => `${n.id}.${s.key}` === input)));
  }
  async ownsActuator(input: string): Promise<boolean> {
    const snaps = await this.listHubDevices();
    return snaps.some((snap) => snap.nodes.some((n) => (n.actuators ?? []).some((a) => `${n.id}.${a.key}` === input)));
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
 *
 * Consolidation (audit): this adapter used to build its OWN ts.Client and its own
 * TablestoreConfig/must(), a second integration layer alongside tablestore.ts (auth.ts/hubs.ts).
 * It now shares tablestore.ts's ONE client singleton (getTablestore) and routes table creation
 * through its helpers — hearth_home via ensureHomeTable (its single memoized owner), and the
 * readings/runs tables via ensureTable(..., ttl). DEFERRED, on purpose: the per-row ops below
 * (getRow/putRow/getRange) still call the shared client directly rather than tablestore.ts's
 * promisified tsGetRow/tsPutRow/tsGetRange helpers. They use the SDK's promise mode with raw
 * `data`-column JSON blobs and the backward, exclusive-end-key window scans (scanReadings /
 * scanRuns) that the forward-only callback helpers don't express — rewriting them onto those
 * helpers risks the very window/TTL correctness the audit says to preserve, for no client-count
 * win (the client is already shared). Left as-is deliberately.
 */
const TS_TABLE = 'hearth_home';

/* Live readings live in their OWN table, separate from hearth_home, because retention is a
 * per-table property in Tablestore. hearth_home is timeToLive:-1 (watches and pairings are
 * forever); readings expire after 24h, swept server-side by Tablestore itself so there is no
 * cron, no sweeper, and no unbounded growth. Rows are keyed
 * account / "<input>#<zero-padded ms>" so one input's window is a single ordered range scan.
 * The padding is what makes lexicographic key order equal chronological order. */
const TS_READINGS_TABLE = 'hearth_readings';
const READING_TTL_SEC = 24 * 60 * 60;

/* The run log lives in its OWN table for the same reason readings do: retention is a
 * per-table property. Watches are forever (hearth_home, ttl -1) and readings are
 * transient (24h), but spend history wants a middle life — long enough to answer "what
 * did this watch cost me last quarter", bounded enough that an append-only log can't
 * grow without end. A year, swept server-side by Tablestore: no cron, no sweeper.
 *
 * Rows are keyed account / "<13-digit-padded-ms>#<id>", so a plain range scan returns
 * the log in chronological order and BACKWARD+limit gives "newest first" for free. The
 * id tie-breaks events landing in the same millisecond, which two FC instances writing
 * concurrently will absolutely do. Time-first (not questionId-first) because every read
 * path — the feed, the search, the month's spend — is bounded by time first and filters
 * by watch second. */
const TS_RUNS_TABLE = 'hearth_runs';
const RUN_TTL_SEC = 365 * 24 * 60 * 60;

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

  static async open(ts: TsModule, client: TsClient, account: string): Promise<TablestoreStore> {
    const store = new TablestoreStore(ts, client, account);
    await store.ensureTables();
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
  private async ensureTables(): Promise<void> {
    // hearth_home is shared with auth.ts/hubs.ts, so let its single memoized owner create it.
    await ensureHomeTable();
    // Readings: same key shape, but Tablestore expires rows 24h after write for us.
    await ensureTable(TS_READINGS_TABLE, ['account', 'sk'], READING_TTL_SEC);
    // Runs: same again, on a one-year life. See TS_RUNS_TABLE.
    await ensureTable(TS_RUNS_TABLE, ['account', 'sk'], RUN_TTL_SEC);
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

  /* ---- durable run log (365d, own table, server-side TTL) ------------------------
   * Exactly the same fix as readings above, applied to the thing that was still on the
   * heap: MemoryStore.appendEvent pushed onto an array capped at 500 and TablestoreStore
   * never overrode it. On Function Compute that meant run history was per-instance and
   * vanished on freeze — so the activity feed silently disagreed with itself between
   * requests, and any spend it implied was fiction. Now every append and every read goes
   * through to Tablestore. No heap copy, for the same reason as readings. */

  /**
   * Scan the log in [from, to]. Backward yields newest-first, which is what every
   * caller wants; `stopAt` bounds the work when the caller only needs a page.
   */
  private async scanRuns(from: number, to: number, stopAt?: number): Promise<RunEventRow[]> {
    // Keys are `<padded ts>#<id>`; `tsKey(to+1)` is an exclusive upper bound that still
    // includes every row AT `to`, whatever its id suffix.
    const lo = tsKey(from);
    const hi = tsKey(to + 1);
    const out: RunEventRow[] = [];
    // BACKWARD scans from the high key down, so start/end swap relative to a forward scan.
    let start: unknown[] | null = [{ account: this.account }, { sk: hi }];
    const end = [{ account: this.account }, { sk: lo }];
    while (start) {
      const res = await this.client.getRange({
        tableName: TS_RUNS_TABLE,
        direction: this.ts.Direction.BACKWARD,
        inclusiveStartPrimaryKey: start,
        exclusiveEndPrimaryKey: end,
        limit: 500,
      });
      for (const row of res.rows ?? []) {
        const data = this.dataOf(row.attributes);
        if (!data) continue;
        const ev = JSON.parse(data) as RunEventRow;
        if (ev.ts >= from && ev.ts <= to) out.push(ev);
      }
      if (stopAt != null && out.length >= stopAt) return out.slice(0, stopAt);
      start = res.next_start_primary_key ?? null;
    }
    return out;
  }

  async appendEvent(ev: RunEventRow): Promise<void> {
    await this.client.putRow({
      tableName: TS_RUNS_TABLE,
      condition: this.ignore(),
      primaryKey: this.pk(`${tsKey(ev.ts)}#${ev.id}`),
      attributeColumns: [{ data: JSON.stringify(ev) }],
    });
  }

  async listEvents(limit: number): Promise<RunEventRow[]> {
    return this.scanRuns(0, Date.now(), limit);
  }

  /**
   * Range-scan the window, then filter in memory.
   *
   * Tablestore has no secondary index here, so `questionId`/`kind`/`text` can't be
   * pushed into the key — but the time bound is, and it's the one that matters: a
   * month of a real home's log is O(1k) rows, not O(1M), precisely because we don't
   * store skips. If ad-hoc query ever outgrows this, docs/02-data-model.md:303 is the
   * escape hatch (add a Search Index) — deliberately not paid for yet.
   *
   * `totals` covers every MATCHING row in the window, not just the returned page, so
   * the spend line stays truthful when the page is capped.
   */
  async searchRuns(q: RunQuery): Promise<RunSearchResult> {
    const hits = (await this.scanRuns(q.from ?? 0, q.to ?? Date.now())).filter((ev) => matchesRun(ev, q));
    return { rows: hits.slice(0, q.limit ?? 50), totals: totalRuns(hits) };
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

export async function createTablestore(accountId: string): Promise<HomeStore> {
  // Route through tablestore.ts's ONE client singleton (it lazily imports the SDK, reads config
  // from env, and throws a clear hint if the optional dependency is missing) instead of building
  // a second ts.Client here. `TableStore` is the resolved SDK namespace; `client` is the shared
  // client both integration layers now use.
  const { TableStore, client } = await getTablestore();
  return TablestoreStore.open(TableStore as TsModule, client as TsClient, accountId);
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
    return createTablestore(accountId);
  }
  if (mode === 'file') {
    return FileStore.open(join(dataDir(), 'homes', `${safeId(accountId)}.json`));
  }
  return new MemoryStore();
}

export { parseDuration };
