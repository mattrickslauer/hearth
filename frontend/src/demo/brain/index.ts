/**
 * The brain the simulation talks to. One interface, two implementations:
 *  - `mock` — deterministic, in-browser, no key (default; always available).
 *  - `qwen` — real Qwen Cloud via the /qwen proxy (EXPO_PUBLIC_USE_QWEN=1),
 *             falling back to mock on any error.
 */

import { defaultRecord, mockAuthor, mockJudge, type AuthoredQuestion } from './mock';
import { qwenAnsweredLive, qwenAuthor, qwenJudge } from './qwen';
import type { Judgment, Question, Visitor } from '../types';

export interface Brain {
  id: 'mock' | 'qwen';
  label: string;
  author(wish: string): Promise<Question>;
  judge(input: { dep: Question; visitor: Visitor | null; scene: string; questions: string[] }): Promise<Judgment>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let counter = 0;
function withId(a: AuthoredQuestion): Question {
  counter += 1;
  const q: Question = { ...a, id: `q-${Date.now().toString(36)}-${counter}` };
  // Every cloud watch samples an input, so it must carry a capture policy. If the
  // brain didn't emit one (e.g. real Qwen), synthesise a sane default from the
  // bound vision input + the check's budget floor so the rate is always editable.
  if (q.compiledSpec.kind === 'cloud' && !q.record) {
    const inputId = q.boundInputs.find((b) => b.endsWith('.frame')) ?? q.boundInputs[0] ?? 'camera.frame';
    q.record = defaultRecord(inputId, q.compiledSpec.cloud.maxCadence ?? '10s');
  }
  return q;
}

const useQwen = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_USE_QWEN === '1';

export const brain: Brain = useQwen
  ? {
      id: 'qwen',
      // Honest pill: reads "Qwen Cloud" only while real calls answer. The moment one falls
      // back to the mock (the 401 an anonymous visitor gets), the label flips to
      // "(simulated)" — the UI re-reads this getter whenever new brain output renders.
      get label() {
        return qwenAnsweredLive() ? 'Qwen Cloud' : 'Qwen (simulated)';
      },
      async author(wish) {
        return withId(await qwenAuthor(wish));
      },
      async judge(input) {
        return qwenJudge(input);
      },
    }
  : {
      id: 'mock',
      label: 'Qwen (simulated)',
      async author(wish) {
        await sleep(750);
        return withId(mockAuthor(wish));
      },
      async judge(input) {
        await sleep(input.dep.usesVision ? 1100 : 650);
        return mockJudge(input);
      },
    };

export { mockAuthor, mockJudge };
export type { AuthoredQuestion };
