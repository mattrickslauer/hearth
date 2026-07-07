/**
 * Deterministic "brain" — compiles a wish into a Question with a runnable
 * `compiledSpec` (PredicateNode). Runs in-browser with no key, and is the
 * server-side fallback when QWEN_API_KEY is unset. Now temporal-aware: "for N
 * minutes" compiles to a `sustained` predicate instead of being dropped.
 */

import type { Question, Visitor } from '../types';
import type { CloudModel, PredicateNode, RecordPolicy, Scalar } from '../engine/types';

/** Default capture policy for a cloud/vision watch (the configurable frame rate). */
export function defaultRecord(inputId = 'camera.frame', every = '10s'): RecordPolicy {
  return { inputId, mode: 'on_event', every, retain: 8, transform: 'crop' };
}

export type AuthoredQuestion = Omit<Question, 'id'>;

const has = (s: string, ...words: string[]) => words.some((w) => s.includes(w));

const eq = (input: string, value: Scalar): PredicateNode => ({ op: '==', left: { input }, right: value });
const lt = (input: string, value: number): PredicateNode => ({ op: '<', left: { input }, right: value });
const and = (nodes: PredicateNode[]): PredicateNode => (nodes.length === 1 ? nodes[0] : { op: 'and', nodes });
const NIGHT: PredicateNode = { op: 'schedule', window: { after: '19:00', before: '07:00' } };
const sustained = (node: PredicateNode, forD: string): PredicateNode => ({ op: 'sustained', node, for: forD });

/** Does a compiled predicate require clock-driven re-evaluation? */
export function needsInterval(node: PredicateNode): boolean {
  switch (node.op) {
    case 'sustained':
    case 'schedule':
    case 'changed':
    case 'delta':
      return true;
    case 'and':
    case 'or':
      return node.nodes.some(needsInterval);
    case 'not':
      return needsInterval(node.node);
    default:
      return false;
  }
}

function parseTempThreshold(s: string): number | null {
  const m = s.match(/(?:below|under|less than|colder than|<)\s*(-?\d+)/);
  if (m) return Number(m[1]);
  if (has(s, 'cold', 'freezing', 'chilly')) return 10;
  return null;
}

/** "for more than 5 minutes", "left open" → a Duration string, or null. */
function parseForDuration(s: string): string | null {
  const m = s.match(/(?:for|after|more than|over|at least|longer than)\s+(\d+)\s*(sec|second|s|min|minute|m|hour|hr|h)/);
  if (m) {
    const u = m[2][0] === 'h' ? 'h' : m[2][0] === 's' ? 's' : 'm';
    return `${m[1]}${u}`;
  }
  if (/\b(left open|stays open|still open|kept open|remains open)\b/.test(s)) return '5m';
  return null;
}

function localQ(p: {
  wish: string;
  title: string;
  boundInputs: string[];
  trigger: string;
  action: string;
  actuates: string[];
  push: boolean;
  expr: PredicateNode;
  cooldown?: string;
  authoring: string[];
}): AuthoredQuestion {
  return {
    text: p.wish,
    title: p.title,
    boundInputs: p.boundInputs,
    trigger: p.trigger,
    action: p.action,
    actuates: p.actuates,
    push: p.push,
    usesVision: false,
    runsLocally: true,
    cost: 'none',
    compiledTo: 'local',
    compiledSpec: { kind: 'local', local: { expr: p.expr } },
    evalOn: needsInterval(p.expr) ? 'interval' : 'event',
    fire: { edge: 'rising', cooldown: p.cooldown },
    authoring: p.authoring,
  };
}

export function mockAuthor(wish: string): AuthoredQuestion {
  const s = wish.toLowerCase();
  const dur = parseForDuration(s);

  // ---- Living-room light: motion / after-dark ---------------------------
  if (has(s, 'light', 'lamp', 'lights')) {
    const motion = has(s, 'motion', 'walk', 'enter', 'move', 'someone', 'comes in');
    const dark = has(s, 'dark', 'night', 'evening');
    const parts: PredicateNode[] = [];
    if (motion) parts.push(eq('living.motion', true));
    if (dark) parts.push(NIGHT);
    if (!parts.length) parts.push(eq('living.motion', true));
    return localQ({
      wish,
      title: 'Living-room light',
      boundInputs: ['living.motion'],
      trigger:
        [motion && 'there is motion in the living room', dark && 'after dark'].filter(Boolean).join(', ') ||
        'there is motion in the living room',
      action: 'Switch the lamp on',
      actuates: ['living.light'],
      push: false,
      expr: and(parts),
      authoring: [
        'bound the living-room PIR and the lamp relay',
        dark ? 'compiled "after dark" to a real time-of-day schedule' : 'a plain motion rule',
        'runs locally on the hub — no cloud, no tokens, fires offline',
      ],
    });
  }

  // ---- Thermostat / comfort hold ---------------------------------------
  if (has(s, 'thermostat', 'climate', 'comfortable') || (has(s, 'living', 'room') && has(s, 'warm', 'cool', 'temperature', 'degrees', 'heat'))) {
    const target = parseTempThreshold(s) ?? 20;
    return localQ({
      wish,
      title: 'Comfort hold',
      boundInputs: ['living.temp'],
      trigger: `the living room drops below ${target}°C`,
      action: 'Turn the thermostat on to warm the room',
      actuates: ['living.thermostat'],
      push: false,
      expr: lt('living.temp', target),
      authoring: [
        'bound the living-room temperature sensor and the thermostat',
        'a plain threshold, compiled to a local control loop on the hub',
        'holds your target even when the cloud is unreachable',
      ],
    });
  }

  // ---- Vision: someone at the door who isn't family --------------------
  const doorPerson =
    has(s, 'door', 'porch', 'entrance', 'front') &&
    has(s, 'someone', 'person', 'people', 'stranger', 'family', 'household', 'visitor', 'delivery', 'package', 'anyone', 'who');
  if (doorPerson) {
    const nonFamily = has(s, "isn't", 'not', 'stranger', 'unfamiliar', 'unknown', "doesn't");
    const question = nonFamily
      ? 'the person at the door is not a household member'
      : 'someone is at the door';
    return {
      text: wish,
      title: nonFamily ? 'Unfamiliar visitor' : 'Someone at the door',
      boundInputs: ['entry.presence', 'entry.rfid', 'camera.frame'],
      trigger: nonFamily ? "Someone at the door who isn't a household member" : 'Someone is at the front door',
      action: 'Look closer with the camera, then push you',
      actuates: ['entry.pan'],
      push: true,
      usesVision: true,
      runsLocally: false,
      cost: 'cloud',
      compiledTo: 'cloud_vl',
      compiledSpec: {
        kind: 'cloud',
        cloud: { model: 'qwen-vl', question, gate: eq('entry.presence', true), maxCadence: '2s' },
      },
      record: defaultRecord('camera.frame', '10s'),
      evalOn: 'event',
      fire: { edge: 'rising' },
      authoring: [
        'bound the doorway camera + presence + household tags',
        'this needs judgement, so it reasons in the cloud with Qwen-VL',
        'a cheap local gate (someone present) precedes any cloud call',
      ],
      contextSuggestions: nonFamily
        ? [
            {
              kind: 'reference_images',
              title: 'Upload photos of household members',
              why: "so I can tell family from strangers instead of alerting on everyone who's at the door",
            },
            {
              kind: 'cadence',
              title: 'Snap every ~2s while someone is present',
              why: 'enough to catch a clear face without spending tokens on an empty doorway',
            },
            {
              kind: 'quality',
              title: 'Use higher capture quality at the door',
              why: 'face detail sharpens recognition, so fewer false alerts',
            },
          ]
        : [
            {
              kind: 'aim',
              title: 'Point the camera at the doorway',
              why: 'a clear head-on view of arrivals is what I reason over',
            },
            {
              kind: 'cadence',
              title: 'Snap every ~3s when motion is present',
              why: "catches someone arriving without streaming video you don't need",
            },
          ],
    };
  }

  // ---- Garage: threshold + optional duration (the temporal case) -------
  const garage = has(s, 'garage', 'door', 'open');
  const heat = has(s, 'heater', 'heat', 'warm', 'furnace');
  const temp = parseTempThreshold(s);
  const dark = has(s, 'dark', 'night', 'evening', 'after dark');
  if (garage || heat || temp !== null || dur) {
    const doorOpen = eq('garage.door', 'open');
    const base = dur ? sustained(doorOpen, dur) : doorOpen;
    const parts: PredicateNode[] = [base];
    const boundInputs = ['garage.door'];
    if (dark) parts.push(NIGHT);
    if (temp !== null) {
      parts.push(lt('garage.temp', temp));
      boundInputs.push('garage.temp');
    }
    const triggerParts = [
      garage && (dur ? `the garage door stays open for ${dur}` : 'the garage door is open'),
      dark && 'after dark',
      temp !== null && `below ${temp}°C`,
    ].filter(Boolean);
    return localQ({
      wish,
      title: dur ? 'Garage-open timeout' : heat ? 'Cold-garage heater' : 'Garage watch',
      boundInputs,
      trigger: triggerParts.join(', ') || 'the garage door is open',
      action: heat ? 'Switch the heater on, then push you' : 'Push you',
      actuates: heat ? ['garage.heater'] : [],
      push: true,
      expr: and(parts),
      cooldown: dur ? '10m' : undefined,
      authoring: [
        'read the registry — found the garage door, temperature and heater',
        dur
          ? `compiled "for ${dur}" to a sustained predicate — checked on a clock, not just on open`
          : 'a plain threshold, compiled to a local rule',
        'runs on the hub — fires even offline, spends no tokens',
      ],
    });
  }

  // ---- Generic fallback -------------------------------------------------
  return localQ({
    wish,
    title: 'Custom watch',
    boundInputs: ['entry.presence'],
    trigger: 'something changes at the front door',
    action: 'Push you',
    actuates: [],
    push: true,
    expr: eq('entry.presence', true),
    authoring: [
      "I couldn't fully ground this wish in the current kit",
      'so I bound the closest capability and set a simple notify',
      'add a matching sensor and I can compile the rest',
    ],
  });
}

/** Runtime judgement for cloud/vision questions (or fallback). */
export function mockJudge(input: {
  dep: { usesVision?: boolean; actuates?: string[]; trigger?: string };
  visitor: Visitor | null;
  scene: string;
}): { fired: boolean; verdict: string; reasoning: string; steps: string[]; privacyNote?: string } {
  const { dep, visitor } = input;

  if (dep.usesVision) {
    if (!visitor) {
      return {
        fired: false,
        verdict: 'CLEAR',
        reasoning: 'I looked at the doorway and no one is there. Nothing to report.',
        steps: ['read the doorway frame', 'no person in view'],
        privacyNote: 'raw frame never left your home',
      };
    }
    if (visitor.household) {
      return {
        fired: false,
        verdict: 'CLEAR',
        reasoning: `That's ${visitor.label}, a household member${visitor.rfid ? ' — their tag matched' : ''}. Not worth interrupting you.`,
        steps: [visitor.rfid ? `matched household tag ${visitor.rfid}` : 'recognised a household member', 'held the alert'],
        privacyNote: 'identity matched on-hub; nothing sent to the cloud',
      };
    }
    return {
      fired: true,
      verdict: 'MATCH',
      reasoning: `${cap(visitor.label)} is at the door and isn't in your household set. The first frame was unclear, so I panned the camera for a clean look at the face.`,
      steps: ['looked closer — aimed camera +20°', 'confirmed: not a household member', 'notified you (push)'],
      privacyNote: 'raw frame never left your home — only a cropped face box was sent',
    };
  }

  return {
    fired: true,
    verdict: 'FIRED',
    reasoning: `${cap(dep.trigger ?? 'the trigger held')} — so I ran your watch and let you know.`,
    steps: ['acted on your watch', 'pushed you'],
    privacyNote: 'ran as a local rule on your hub — nothing left the house',
  };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
