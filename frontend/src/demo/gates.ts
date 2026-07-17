/**
 * Which cheap local sensors can front an expensive cloud call, and how much of the
 * day each one is actually true.
 *
 * This is home knowledge, not engine knowledge, so it lives above `engine/` and gets
 * passed into `recommend()`. A vision watch is only expensive because it Looks at an
 * empty scene; a gate in the same zone is what makes it cheap. When the zone has no
 * such sensor, the honest suggestion is hardware — an ESP32 node costs a few dollars
 * once and removes most of the bill forever.
 *
 * The duty cycles are ASSUMPTIONS about a typical home, in the same family as
 * `ACTIVITY` — a front door has someone at it a couple of percent of the day. They
 * are deliberately conservative: overstating a gate's duty would understate a bill.
 */

import { gateInput } from './engine/predicate';
import type { GateCandidate } from './engine/recommend';
import type { PredicateNode } from './engine/types';
import { CAPABILITIES, nodeForCapability } from './home';
import type { ZoneId } from './types';

const eq = (input: string, value: boolean): PredicateNode => ({ op: '==', left: { input }, right: value });

/** A gate we can offer for a zone: the sensor that says "something is happening here". */
interface ZoneGate {
  inputId: string;
  label: string;
  duty: number;
  /** Offered as hardware when the zone lacks the sensor. */
  hardware: string;
}

/**
 * Per-zone gating sensors, best (lowest duty = biggest saving) first. `duty` is the
 * fraction of a day the sensor reads true in a typical home.
 */
const ZONE_GATES: Record<ZoneId, ZoneGate[]> = {
  entry: [
    { inputId: 'entry.presence', label: 'Doorway presence', duty: 0.02, hardware: '~$5 ESP32 + HC-SR04' },
  ],
  living: [{ inputId: 'living.motion', label: 'Motion', duty: 0.15, hardware: '~$5 ESP32 + PIR' }],
  garage: [{ inputId: 'garage.door', label: 'Garage door open', duty: 0.05, hardware: '~$5 ESP32 + HC-SR04' }],
};

const installed = (inputId: string): boolean => CAPABILITIES.some((c) => c.id === inputId);

const ALL_GATES: ZoneGate[] = Object.values(ZONE_GATES).flat();

/**
 * Gate candidates for a watch, derived from the zones its inputs actually live in.
 * A watch bound to the doorway camera gets doorway gates — never a garage sensor it
 * has no relationship to.
 *
 * A bound input is deliberately NOT excluded: the doorway watch binds both the camera
 * and the presence sensor, and gating the former on the latter is precisely the right
 * answer (it's the one the brain itself picks). Only a vision input is skipped — you
 * cannot gate a camera on itself.
 */
export function gatesFor(boundInputs: string[]): GateCandidate[] {
  const zones = new Set<ZoneId>();
  for (const id of boundInputs) {
    const node = nodeForCapability(id);
    if (node) zones.add(node.zone);
  }

  const out: GateCandidate[] = [];
  for (const zone of zones) {
    for (const g of ZONE_GATES[zone] ?? []) {
      if (CAPABILITIES.find((c) => c.id === g.inputId)?.vision) continue;
      out.push({
        inputId: g.inputId,
        label: g.label,
        duty: g.duty,
        predicate: eq(g.inputId, true),
        installed: installed(g.inputId),
        hardware: g.hardware,
      });
    }
  }
  return out.sort((a, b) => a.duty - b.duty);
}

/**
 * The duty cycle of a gate the brain already compiled in, resolved from the input it
 * actually references. Without this an already-gated watch would be quoted as if the
 * gate never fires — overstating its bill by ~50×.
 */
export function dutyForGate(gate: PredicateNode | undefined): number | undefined {
  if (!gate) return undefined;
  const input = gateInput(gate);
  return input ? ALL_GATES.find((g) => g.inputId === input)?.duty : undefined;
}
