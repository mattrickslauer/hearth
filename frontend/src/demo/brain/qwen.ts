/**
 * Qwen brain — calls the backend's `/qwen` route on Function Compute, which holds the key
 * and talks to Qwen Cloud. Falls back to the deterministic mock on any error (including the
 * 401 an anonymous caller gets) so the demo never dead-ends.
 *
 * This deliberately targets the ONE brain in backend/src/qwen.ts. There used to be a second
 * key-holding copy on Vercel (frontend/src/app/qwen+api.ts); it had already drifted (no
 * Qwen-VL) and, being a relative fetch, could never resolve on native — where the demo
 * silently mocked instead. An absolute URL works on web and native alike.
 */

import type { AuthoredQuestion } from './mock';
import { mockAuthor, mockJudge } from './mock';
import type { Judgment, Question, Visitor } from '../types';
import { loadToken } from '@/auth/storage';
import { backendBase } from '@/auth/client';

// The console pill must never claim "Qwen Cloud" for output the mock actually produced
// (an anonymous visitor's call 401s and falls back). Track which engine answered last so
// the label can tell the truth — and recover to "Qwen Cloud" once real calls succeed
// (e.g. after signing in).
let lastEngine: 'qwen' | 'mock' | null = null;
export const qwenAnsweredLive = () => lastEngine !== 'mock';

async function callRoute<T>(body: unknown): Promise<T> {
  // The backend requires a session before it will spend the real key; anonymous callers get
  // a 401, which the callers below turn into the deterministic mock.
  const token = loadToken();
  const res = await fetch(`${backendBase}/qwen`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/qwen ${res.status}`);
  return (await res.json()) as T;
}

export async function qwenAuthor(wish: string): Promise<AuthoredQuestion> {
  try {
    const data = await callRoute<{ question: AuthoredQuestion }>({ task: 'author', wish });
    if (!data?.question?.compiledSpec) throw new Error('malformed question');
    lastEngine = 'qwen';
    return { ...data.question, text: wish };
  } catch {
    lastEngine = 'mock';
    return mockAuthor(wish);
  }
}

export async function qwenJudge(input: {
  dep: Question;
  visitor: Visitor | null;
  scene: string;
  questions: string[];
}): Promise<Judgment> {
  try {
    // backend/src/qwen.ts JudgeInput is flat (title/trigger at the top level), unlike the
    // old Vercel route's nested `dep`.
    const data = await callRoute<{ judgment: Judgment }>({
      task: 'judge',
      title: input.dep.title,
      trigger: input.dep.trigger,
      questions: input.questions,
      scene: input.scene,
      visitor: input.visitor
        ? { label: input.visitor.label, household: input.visitor.household, rfid: input.visitor.rfid ?? null }
        : null,
    });
    if (!data?.judgment) throw new Error('malformed judgment');
    lastEngine = 'qwen';
    return data.judgment;
  } catch {
    lastEngine = 'mock';
    return mockJudge({ dep: input.dep, visitor: input.visitor, scene: input.scene });
  }
}
