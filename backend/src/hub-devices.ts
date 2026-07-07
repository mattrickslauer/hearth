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
