/**
 * Record-policy metering — the pure decision behind a cloud watch's "frame rate".
 * Kept free of React/RN so it's unit-testable and the hub can share it verbatim.
 */

import { parseDuration } from './duration';
import type { CloudCheck, RecordPolicy } from './types';

/**
 * Effective metered interval (ms): never sample faster than the record's own rate,
 * and never faster than the cloud check's hard budget floor (`maxCadence`).
 */
export function meteredInterval(rec: RecordPolicy | undefined, cloud: Pick<CloudCheck, 'maxCadence'>): number {
  return Math.max(parseDuration(rec?.every), parseDuration(cloud.maxCadence));
}

/**
 * Should this cloud watch spend a call this tick?
 *  - `interval` mode → yes once per metered interval while the gate holds.
 *  - `on_event` mode → only when the scene changed, still throttled to the interval.
 */
export function shouldSample(opts: {
  rec?: RecordPolicy;
  cloud: Pick<CloudCheck, 'maxCadence'>;
  now: number;
  lastEvalAt: number;
  sceneChanged: boolean;
}): boolean {
  const every = meteredInterval(opts.rec, opts.cloud);
  const due = opts.now - opts.lastEvalAt >= every;
  return (opts.rec?.mode ?? 'on_event') === 'interval' ? due : opts.sceneChanged && due;
}
