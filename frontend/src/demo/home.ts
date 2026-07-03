/**
 * The simulated home — node registry, initial world, and the pure helpers the
 * simulation uses to evaluate deployment conditions and format state. Mirrors
 * the reference kit in INVENTORY.md so the demo tells the truth about the hardware.
 */

import type {
  ActuatorState,
  Capability,
  Node,
  SensorValue,
  Visitor,
  WorldState,
  Zone,
} from './types';

export const ZONES: Zone[] = [
  { id: 'garage', name: 'Garage', icon: '🚗' },
  { id: 'entry', name: 'Front door', icon: '🚪' },
  { id: 'living', name: 'Living room', icon: '🛋' },
];

/**
 * Self-describing nodes. Every capability here is something the reference kit
 * can actually sense or do — this is the registry Qwen reads when authoring.
 */
export const NODES: Node[] = [
  {
    id: 'node-garage',
    name: 'Garage node',
    zone: 'garage',
    hardware: 'ESP32 · HC-SR04 · DHT11 · relay',
    offGrid: true,
    capabilities: [
      {
        id: 'garage.door',
        label: 'Garage door',
        kind: 'sensor',
        icon: '🚪',
        describes: 'open or closed (ultrasonic distance)',
      },
      {
        id: 'garage.temp',
        label: 'Garage temperature',
        kind: 'sensor',
        icon: '🌡',
        unit: '°C',
        describes: 'temperature in the garage',
      },
      {
        id: 'garage.heater',
        label: 'Heater',
        kind: 'actuator',
        icon: '🔥',
        describes: 'switch the garage heater on or off (relay)',
      },
    ],
  },
  {
    id: 'node-entry',
    name: 'Entry node',
    zone: 'entry',
    hardware: 'ESP32 · HC-SR04 · RFID-RC522 · servo · LCD',
    capabilities: [
      {
        id: 'entry.presence',
        label: 'Doorway presence',
        kind: 'sensor',
        icon: '🚶',
        describes: 'someone is standing at the front door',
      },
      {
        id: 'entry.rfid',
        label: 'Household tag',
        kind: 'sensor',
        icon: '🎫',
        describes: 'RFID tag of a household member, if they carry one (hashed)',
      },
      {
        id: 'entry.pan',
        label: 'Camera pan',
        kind: 'actuator',
        icon: '🔄',
        describes: 'aim the doorway camera (servo) for a clearer look',
      },
      {
        id: 'entry.lcd',
        label: 'Status screen',
        kind: 'actuator',
        icon: '🔢',
        describes: 'show a short status message on the node',
      },
    ],
  },
  {
    id: 'node-living',
    name: 'Living room node',
    zone: 'living',
    hardware: 'ESP32 · PIR · DHT11 · relay',
    capabilities: [
      {
        id: 'living.motion',
        label: 'Motion',
        kind: 'sensor',
        icon: '🚶',
        describes: 'someone is moving in the living room (PIR)',
      },
      {
        id: 'living.temp',
        label: 'Room temperature',
        kind: 'sensor',
        icon: '🌡',
        unit: '°C',
        describes: 'the living room temperature',
      },
      {
        id: 'living.light',
        label: 'Lamp',
        kind: 'actuator',
        icon: '💡',
        describes: 'switch the living room lamp on or off (relay)',
      },
      {
        id: 'living.thermostat',
        label: 'Thermostat',
        kind: 'actuator',
        icon: '🎛',
        describes: 'a temp-control unit — heat or cool the living room to a target',
      },
    ],
  },
  {
    id: 'hub-cam',
    name: 'Hub camera',
    zone: 'entry',
    hardware: 'Raspberry Pi · USB webcam',
    capabilities: [
      {
        id: 'camera.frame',
        label: 'Doorway camera',
        kind: 'sensor',
        icon: '📷',
        vision: true,
        describes: 'a live view of the doorway — Qwen-VL can read the scene (raw frame stays on the hub)',
      },
    ],
  },
];

export const CAPABILITIES: Capability[] = NODES.flatMap((n) => n.capabilities);

export function capability(id: string): Capability | undefined {
  return CAPABILITIES.find((c) => c.id === id);
}

export function nodeForCapability(id: string): Node | undefined {
  return NODES.find((n) => n.capabilities.some((c) => c.id === id));
}

/* -------------------------------------------------------------- Visitors */

export const VISITORS: Visitor[] = [
  { id: 'alex', label: 'Alex', household: true, rfid: 'tag-7f3a', emoji: '🧑' },
  { id: 'courier', label: 'a delivery courier', household: false, rfid: null, emoji: '📦' },
  { id: 'stranger', label: 'an unfamiliar person', household: false, rfid: null, emoji: '🧍' },
];

/* ---------------------------------------------------------- Initial world */

export function initialWorld(): WorldState {
  return {
    clock: 14 * 60 + 2, // 14:02
    timeOfDay: 'day',
    online: true,
    sensors: {
      'garage.door': 'closed',
      'garage.temp': 19,
      'entry.presence': false,
      'entry.rfid': null,
      'camera.frame': 'empty doorway',
      'living.motion': false,
      'living.temp': 21,
    },
    actuators: {
      'garage.heater': { on: false },
      'entry.pan': { angle: 0 },
      'entry.lcd': { text: 'Ready' },
      'living.light': { on: false },
      'living.thermostat': { on: false, text: 'off' },
    },
    visitor: null,
  };
}

/* ------------------------------------------------------------- Formatting */

export function formatClock(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440;
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

export function formatSensor(id: string, value: SensorValue): string {
  const cap = capability(id);
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (cap?.unit) return `${value}${cap.unit}`;
  return String(value);
}

/* ---------------------------------------------------- World mutations */

export function setSensor(world: WorldState, id: string, value: SensorValue): WorldState {
  return { ...world, sensors: { ...world.sensors, [id]: value } };
}

export function setActuator(world: WorldState, id: string, patch: ActuatorState): WorldState {
  return {
    ...world,
    actuators: { ...world.actuators, [id]: { ...world.actuators[id], ...patch } },
  };
}

/**
 * Apply (or clear) an actuator command to the world. Latching: `on=true` drives
 * it and it STAYS until something clears it — no auto-revert when a trigger goes
 * false. Mirrors a `Command` desired-state on the hub.
 */
export function applyActuator(world: WorldState, id: string, on: boolean, label?: string): WorldState {
  switch (id) {
    case 'garage.heater':
    case 'living.light':
      return setActuator(world, id, { on });
    case 'living.thermostat':
      return setActuator(world, id, { on, text: on ? 'holding target' : 'off' });
    case 'entry.pan':
      return setActuator(world, id, { angle: on ? 20 : 0 });
    case 'entry.lcd':
      return setActuator(world, id, { text: on ? (label ?? 'Alert') : 'Ready' });
    default:
      return world;
  }
}

/* ------------------------------------------- Reading device state for UI */

export type Tone = 'neutral' | 'hot' | 'cold' | 'alert' | 'good' | 'lit';

/** Turn a capability + world into a display string + a semantic tone. Shared by
 *  the zone cards and the birds-eye floor plan so they never drift. */
export function readCapability(cap: Capability, world: WorldState): { text: string; tone: Tone } {
  if (cap.kind === 'actuator') {
    const a = world.actuators[cap.id] ?? {};
    switch (cap.id) {
      case 'garage.heater':
        return { text: a.on ? 'ON' : 'off', tone: a.on ? 'hot' : 'neutral' };
      case 'living.light':
        return { text: a.on ? 'ON' : 'off', tone: a.on ? 'lit' : 'neutral' };
      case 'living.thermostat':
        return { text: a.on ? (a.text ?? 'holding') : 'off', tone: a.on ? 'good' : 'neutral' };
      case 'entry.pan':
        return { text: a.angle ? `+${a.angle}°` : 'centered', tone: a.angle ? 'good' : 'neutral' };
      case 'entry.lcd':
        return { text: a.text ?? '—', tone: 'neutral' };
      default:
        return { text: '—', tone: 'neutral' };
    }
  }
  const v = world.sensors[cap.id];
  switch (cap.id) {
    case 'garage.door':
      return { text: v === 'open' ? 'OPEN' : 'closed', tone: v === 'open' ? 'alert' : 'good' };
    case 'garage.temp': {
      const n = Number(v);
      return { text: `${n}°C`, tone: n < 10 ? 'cold' : 'neutral' };
    }
    case 'living.temp': {
      const n = Number(v);
      return { text: `${n}°C`, tone: n < 18 ? 'cold' : 'neutral' };
    }
    case 'living.motion':
      return { text: v ? 'motion' : 'still', tone: v ? 'alert' : 'good' };
    case 'entry.presence':
      return { text: v ? 'someone here' : 'clear', tone: v ? 'alert' : 'good' };
    case 'entry.rfid':
      return { text: v ? 'household ✓' : 'no tag', tone: v ? 'good' : 'neutral' };
    case 'camera.frame':
      return { text: world.visitor ? 'person in view' : 'empty', tone: world.visitor ? 'alert' : 'neutral' };
    default:
      return { text: String(v ?? '—'), tone: 'neutral' };
  }
}

export function isActuatorActive(id: string, world: WorldState): boolean {
  const a = world.actuators[id];
  if (!a) return false;
  if (id === 'garage.heater' || id === 'living.light' || id === 'living.thermostat') return !!a.on;
  if (id === 'entry.pan') return !!a.angle;
  return false;
}
