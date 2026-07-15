/**
 * Hub → cloud device sync. A paired hub POSTs its live node registry (each ESP32's
 * self-description + latest readings); we fold it into the account's Home Model and
 * push the numeric readings into the time series, so the existing tools — describe_home,
 * list_inputs, read_input, query_history, and Qwen-authored Questions — operate on REAL
 * hardware, not the demo world.
 *
 * The wire shape is exactly what `hub/agent.mjs` keeps in memory (its GET /nodes view):
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
 * nothing to do with them (they're evaluated app-side today).
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
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const asObj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {});
const asStr = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** Map the hub's registry payload into the store: register nodes + append readings. */
export async function syncHubDevices(store: HomeStore, meta: HubMeta, body: Record<string, unknown>): Promise<SyncResult> {
  const now = Date.now();
  const nodes: HubNodeReport[] = [];
  let readingsWritten = 0;

  for (const raw of asArray(body.nodes)) {
    const entry = asObj(raw);
    const id = asStr(entry.id);
    if (!id) continue;

    const describe = asObj(entry.describe);
    const sensors: HubSensorReport[] = asArray(describe.sensors)
      .map(asObj)
      .filter((s) => typeof s.key === 'string')
      .map((s) => ({ key: s.key as string, kind: asStr(s.kind), unit: asStr(s.unit), vision: s.vision === true }));
    const actuators: HubActuatorReport[] = asArray(describe.actuators)
      .map(asObj)
      .filter((a) => typeof a.key === 'string')
      .map((a) => ({ key: a.key as string, kind: asStr(a.kind) }));

    const readings = asObj(entry.lastReading);
    const cleaned: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(readings)) {
      if (typeof v === 'number' && Number.isFinite(v)) {
        cleaned[k] = v;
        // Fold into the time series under the same id read_input / query_history use.
        await store.appendReading(`${id}.${k}`, v, now);
        readingsWritten += 1;
      } else {
        cleaned[k] = null;
      }
    }

    nodes.push({
      id,
      board: asStr(describe.board),
      fw: asStr(describe.fw),
      online: true, // the hub just heard from it
      lastSeen: now,
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
  await store.putHubDevices(snap);

  return { ok: true, hubId: meta.hubId, nodes: nodes.length, readings: readingsWritten };
}
