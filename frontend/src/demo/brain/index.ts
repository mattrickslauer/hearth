/**
 * The brain the simulation talks to. One interface, two implementations:
 *  - `mock` — deterministic, in-browser, no key (default; always available).
 *  - `qwen` — real Qwen Cloud via the /qwen proxy (EXPO_PUBLIC_USE_QWEN=1),
 *             falling back to mock on any error.
 */

import { mockAuthor, mockJudge, type AuthoredQuestion } from './mock';
import { qwenAuthor, qwenJudge } from './qwen';
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
  return { ...a, id: `q-${Date.now().toString(36)}-${counter}` };
}

const useQwen = typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_USE_QWEN === '1';

export const brain: Brain = useQwen
  ? {
      id: 'qwen',
      label: 'Qwen Cloud',
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
