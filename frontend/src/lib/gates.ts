/**
 * Gate candidates derived from the REAL home model.
 *
 * `demo/gates.ts` hardcodes the simulator's three zones. The dashboard talks to an
 * actual hub whose input ids are `<nodeId>.<sensorKey>` and whose sensors are whatever
 * someone plugged in, so gates here are classified from the capability's own
 * self-description rather than a fixed id table. The nodes already self-describe
 * (`firmware` → `describe` → `HomeCapability.describes`), which is exactly the
 * information needed to spot "this sensor says whether anything is happening here".
 *
 * Duty cycles are assumptions about a typical home, deliberately conservative:
 * overstating a gate's duty would understate a bill.
 */

import { gateInput } from '@/demo/engine/predicate';
import type { GateCandidate } from '@/demo/engine/recommend';
import type { PredicateNode } from '@/demo/engine/types';
import type { HomeCapability, HomeModel } from './home';

const eq = (input: string, value: boolean): PredicateNode => ({ op: '==', left: { input }, right: value });

/**
 * Kinds of sensor that can front a cloud call, cheapest duty first. Matched against a
 * capability's label + description, the same loose keyword idiom the authoring brain
 * uses to bind inputs.
 */
const GATE_KINDS: { match: RegExp; label: string; duty: number; hardware: string }[] = [
  {
    match: /presence|standing|at the (front )?door|doorbell/i,
    label: 'presence',
    duty: 0.02,
    hardware: '~$5 ESP32 + HC-SR04',
  },
  { match: /\bdoor\b.*(open|clos)|garage door|reed/i, label: 'door open', duty: 0.05, hardware: '~$5 ESP32 + reed switch' },
  { match: /motion|\bpir\b|moving/i, label: 'motion', duty: 0.15, hardware: '~$5 ESP32 + PIR' },
];

const classify = (c: HomeCapability): (typeof GATE_KINDS)[number] | undefined => {
  if (c.kind !== 'sensor' || c.vision) return undefined; // you can't gate a camera on itself
  const text = `${c.label} ${c.describes}`;
  return GATE_KINDS.find((g) => g.match.test(text));
};

/** The zones a watch's bound inputs actually live in. */
function zonesOf(home: HomeModel, boundInputs: string[]): Set<string> {
  const zones = new Set<string>();
  for (const node of home.nodes) {
    if (node.capabilities.some((c) => boundInputs.includes(c.id))) zones.add(node.zone);
  }
  return zones;
}

/**
 * Gates a watch could use, from sensors that exist in the same zones as its inputs,
 * plus hardware suggestions for a zone that has a camera but nothing to gate it on.
 */
export function gatesFromHome(home: HomeModel | null, boundInputs: string[]): GateCandidate[] {
  if (!home) return [];
  const zones = zonesOf(home, boundInputs);
  if (zones.size === 0) return [];

  const out: GateCandidate[] = [];
  for (const zone of zones) {
    const inZone = home.nodes.filter((n) => n.zone === zone).flatMap((n) => n.capabilities);
    const found = inZone.map((c) => ({ c, kind: classify(c) })).filter((x) => x.kind);

    for (const { c, kind } of found) {
      out.push({
        inputId: c.id,
        label: c.label,
        duty: kind!.duty,
        predicate: eq(c.id, true),
        installed: true,
        hardware: kind!.hardware,
      });
    }

    // Nothing in this zone can say whether anything is happening — so the camera Looks
    // at an empty scene all day. That is a hardware problem, and the honest fix is a
    // few dollars of sensor rather than a cheaper model.
    if (found.length === 0) {
      const presence = GATE_KINDS[0];
      out.push({
        inputId: `${zone}.presence`,
        label: `a presence sensor in ${zoneName(home, zone)}`,
        duty: presence.duty,
        predicate: eq(`${zone}.presence`, true),
        installed: false,
        hardware: presence.hardware,
      });
    }
  }
  return out.sort((a, b) => a.duty - b.duty);
}

const zoneName = (home: HomeModel, zone: string): string => home.zones.find((z) => z.id === zone)?.name ?? zone;

/**
 * The duty cycle of a gate the brain already compiled in, resolved from the input it
 * references. Without this an already-gated watch is quoted as if the gate never
 * fires, overstating its bill by ~50×.
 */
export function dutyForGate(home: HomeModel | null, gate: PredicateNode | undefined): number | undefined {
  if (!home || !gate) return undefined;
  const input = gateInput(gate);
  if (!input) return undefined;
  const cap = home.nodes.flatMap((n) => n.capabilities).find((c) => c.id === input);
  return cap ? classify(cap)?.duty : undefined;
}
