/**
 * Hub → cloud device sync. A paired hub POSTs its live node registry (each ESP32's
 * self-description + latest readings); we fold it into the account's Home Model and
 * push the numeric readings into the time series, so the existing tools — describe_home,
 * list_inputs, read_input, query_history, and Qwen-authored Questions — operate on REAL
 * hardware, not the demo world.
 *
 * The wire shape is exactly what `hub/hub.mjs` keeps in memory (its GET /nodes view):
 *   { platform?, nodes: [ { id, describe: {board, fw, sensors:[{key,kind,unit}]},
 *                           lastReading: {<key>: number|null}, lastSeen } ] }
 */

import type { HomeStore, HubActuatorReport, HubDeviceSnapshot, HubNodeReport, HubSensorReport } from './store';

interface HubMeta {
  hubId: string;
  hubName?: string;
  fw?: string;
}

/**
 * One authored watch, in the shape the hub's runtime wants (hub/runtime.mjs fromCloud).
 * `actuates` stays as actuator INPUT IDS ("<nodeId>.<key>") — the hub splits them against
 * its live node registry, since it owns node identity and actuator keys may contain dots.
 */
export interface HubWatch {
  id: string;
  title: string;
  compiledSpec: unknown;
  fire: unknown;
  actuates: string[];
  notify: string | null;
}

/**
 * The account's LOCAL watches, for the device-sync downlink. This is what closes the
 * "author it in the app → it runs on the hardware" loop: the hub adopts these on every
 * sync, so there is no copy-paste step and no hub restart.
 *
 * Cloud/vision watches are filtered out — the hub has no Qwen client, so it would have
 * nothing to do with them. They're evaluated in the cloud instead, on frame arrival
 * (see vision-watch.ts): the hub's job for those is to keep pushing frames.
 */
export async function hubWatches(store: HomeStore): Promise<HubWatch[]> {
  const questions = await store.listQuestions();
  return questions
    .filter((q) => q.compiledSpec?.kind === 'local' && q.compiledSpec.local?.expr)
    .map((q) => ({
      id: q.id,
      title: q.title,
      compiledSpec: q.compiledSpec,
      fire: q.fire,
      actuates: Array.isArray(q.actuates) ? q.actuates : [],
      // The hub pushes to whatever channel it has configured (ntfy/Telegram); it only needs
      // to know WHETHER to push and what to say.
      notify: q.push ? q.action || q.title : null,
    }));
}

export interface SyncResult {
  ok: true;
  hubId: string;
  nodes: number;
  readings: number;
  /** Node ids this hub reported that another hub in the account already owns; refused, not merged. */
  conflicts?: string[];
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const asAge = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * How long a node may go quiet before it stops counting as online. Generous next to the hub's own
 * 90s window: a hub heartbeats on a fixed timer, but a node's cadence is the account's to tune and
 * can legitimately be minutes.
 */
const NODE_ONLINE_WINDOW_MS = Number(process.env.HEARTH_NODE_ONLINE_WINDOW_MS || 300_000);

/**
 * Node ids already claimed by the account's OTHER hubs.
 *
 * Node ids arrive from hubs and nothing upstream can force them to be unique — ESP ids are
 * MAC-derived by luck of implementation, and the camera's used to be the constant 'hub-cam'. Since
 * readings, cadence downlinks and capability ids are all keyed by `<nodeId>.<key>` with no hub in
 * them, two hubs sharing a node id silently interleave into one series and the dashboard shows the
 * merge as though it were one device. We can't stop a hub from picking a name, but we can refuse to
 * merge the second claim, and say so, instead of corrupting the first quietly.
 */
async function claimedByOtherHubs(store: HomeStore, hubId: string): Promise<Set<string>> {
  const snaps = await store.listHubDevices();
  const taken = new Set<string>();
  for (const snap of snaps) {
    if (snap.hubId === hubId) continue; // a hub re-reporting its own nodes is the normal case
    for (const n of snap.nodes) taken.add(n.id);
  }
  return taken;
}

/** Map the hub's registry payload into the store: register nodes + append readings. */
export async function syncHubDevices(store: HomeStore, meta: HubMeta, body: Record<string, unknown>): Promise<SyncResult> {
  const now = Date.now();
  const nodes: HubNodeReport[] = [];
  const taken = await claimedByOtherHubs(store, meta.hubId);
  const conflicts: string[] = [];
  // Readings are now a durable per-row write (Tablestore), not a heap push, so issuing them
  // one-at-a-time inside the loop would put N sequential round-trips in front of the realtime
  // fan-out that the caller runs next. Collect and settle them together instead: one round-trip
  // of latency regardless of how many sensors the home has.
  const writes: Promise<void>[] = [];

  for (const raw of asArray(body.nodes)) {
    const entry = asObj(raw);
    const id = asStr(entry.id);
    if (!id) continue;
    // First hub to claim a node id keeps it. Dropping the newcomer's whole node is deliberate:
    // merging it is what produced a series interleaved from two devices, which no reader could
    // untangle afterwards. Refusing is recoverable — set HEARTH_CAM_ID (or fix the node's id).
    if (taken.has(id)) {
      conflicts.push(id);
      continue;
    }

    const describe = asObj(entry.describe);
    const sensors: HubSensorReport[] = asArray(describe.sensors)
      .map(asObj)
      .filter((s) => typeof s.key === 'string')
      .map((s) => ({ key: s.key as string, kind: asStr(s.kind), unit: asStr(s.unit), vision: s.vision === true }));
    const actuators: HubActuatorReport[] = asArray(describe.actuators)
      .map(asObj)
      .filter((a) => typeof a.key === 'string')
      .map((a) => ({ key: a.key as string, kind: asStr(a.kind) }));

    // The hub re-sends every node it has ever seen, each carrying its last reading — so "it's in
    // this payload" says nothing about whether the node is still alive. `ageMs` is how long the
    // node has actually been quiet (measured on the hub's clock, so no skew); an older hub that
    // doesn't send it keeps the previous benefit of the doubt.
    const ageMs = asAge(entry.ageMs);
    const online = ageMs === null || ageMs < NODE_ONLINE_WINDOW_MS;
    const observedAt = ageMs === null ? now : now - ageMs;

    const readings = asObj(entry.lastReading);
    const cleaned: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(readings)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        cleaned[k] = v;
        // Fold into the time series under the same id read_input / query_history use, dated when
        // the node was actually heard from — NOT now. Stamping `now` re-dated a dead node's last
        // sample on every sync, so `read_input latest` reported a months-old value as current and
        // no reader downstream could tell. A live node re-sending an unchanged sample now lands on
        // the same timestamp instead of accumulating duplicates.
        if (online) writes.push(store.appendReading(`${id}.${k}`, v, observedAt));
      } else {
        cleaned[k] = null;
      }
    }

    nodes.push({
      id,
      board: asStr(describe.board),
      fw: asStr(describe.fw),
      online,
      lastSeen: observedAt,
      sensors,
      actuators,
      readings: cleaned,
    });
  }

  const snap: HubDeviceSnapshot = {
    hubId: meta.hubId,
    hubName: meta.hubName,
    platform: asStr(body.platform),
    fw: meta.fw ?? asStr(body.fw),
    nodes,
    syncedAt: now,
  };
  const [snapResult, ...readingResults] = await Promise.allSettled([store.putHubDevices(snap), ...writes]);
  // The registry snapshot is load-bearing — if it can't be stored, fail the sync as before.
  if (snapResult.status === 'rejected') throw snapResult.reason;
  // Individual readings are not: one unwritable sample must not fail the whole sync (and with
  // it the hub's retry loop). Report what landed and let the next sync carry the rest.
  const readingsWritten = readingResults.filter((r) => r.status === 'fulfilled').length;
  const failed = readingResults.length - readingsWritten;
  if (failed) console.log(`[hub-devices] ${failed}/${readingResults.length} reading writes failed for hub ${meta.hubId}`);
  // Loud on purpose: a refused node is a device the user thinks they installed and cannot see.
  if (conflicts.length)
    console.warn(
      `[hub-devices] hub ${meta.hubId} reported ${conflicts.length} node id(s) another hub already owns — refused: ${conflicts.join(', ')}`,
    );

  return { ok: true, hubId: meta.hubId, nodes: nodes.length, readings: readingsWritten, ...(conflicts.length ? { conflicts } : {}) };
}
