/**
 * Single source of truth. The cloud hub runs the SAME pure engine + brain + home
 * model the browser demo already proved (docs/04) — re-exported here so there is
 * exactly one grammar, one evaluator, one authoring policy across demo and cloud.
 * Only the adapters differ (store, clock, actuator, snapshots).
 *
 * These modules are React-Native-free; they import cleanly under Node.
 */

const D = '../../frontend/src/demo';

export * from '../../frontend/src/demo/engine/types';
export { parseDuration, formatDuration } from '../../frontend/src/demo/engine/duration';
export { evaluate } from '../../frontend/src/demo/engine/predicate';
export { ReadingStore } from '../../frontend/src/demo/engine/store';
export { shouldSample, meteredInterval } from '../../frontend/src/demo/engine/record';
export {
  mockAuthor,
  mockJudge,
  defaultRecord,
  needsInterval,
} from '../../frontend/src/demo/brain/mock';
export type { AuthoredQuestion } from '../../frontend/src/demo/brain/mock';
export {
  authorSystemPrompt,
  authorUserPrompt,
  judgeSystemPrompt,
  judgeUserPrompt,
} from '../../frontend/src/demo/brain/prompts';
export type { CapabilityLite } from '../../frontend/src/demo/brain/prompts';
export {
  ZONES,
  NODES,
  CAPABILITIES,
  capability,
  initialWorld,
} from '../../frontend/src/demo/home';
export type {
  Question,
  Judgment,
  Capability,
  Zone,
  Node as HomeNode,
  Visitor,
  WorldState,
  SensorValue,
} from '../../frontend/src/demo/types';

// re-export a marker so tooling doesn't tree-shake the path constant away in docs
export const DOMAIN_ROOT = D;
