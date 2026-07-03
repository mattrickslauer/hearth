/**
 * Qwen brain — calls the same-origin `/qwen` API route (which holds the key and
 * talks to Qwen Cloud). Falls back to the deterministic mock on any error so the
 * demo never dead-ends.
 */

import type { AuthoredQuestion } from './mock';
import { mockAuthor, mockJudge } from './mock';
import type { Judgment, Question, Visitor } from '../types';

async function callRoute<T>(body: unknown): Promise<T> {
  const res = await fetch('/qwen', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`/qwen ${res.status}`);
  return (await res.json()) as T;
}

export async function qwenAuthor(wish: string): Promise<AuthoredQuestion> {
  try {
    const data = await callRoute<{ question: AuthoredQuestion }>({ task: 'author', wish });
    if (!data?.question?.compiledSpec) throw new Error('malformed question');
    return { ...data.question, text: wish };
  } catch {
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
    const data = await callRoute<{ judgment: Judgment }>({
      task: 'judge',
      dep: {
        title: input.dep.title,
        trigger: input.dep.trigger,
        usesVision: input.dep.usesVision,
        actuates: input.dep.actuates,
      },
      questions: input.questions,
      scene: input.scene,
      visitor: input.visitor
        ? { label: input.visitor.label, household: input.visitor.household, rfid: input.visitor.rfid ?? null }
        : null,
    });
    if (!data?.judgment) throw new Error('malformed judgment');
    return data.judgment;
  } catch {
    return mockJudge({ dep: input.dep, visitor: input.visitor, scene: input.scene });
  }
}
