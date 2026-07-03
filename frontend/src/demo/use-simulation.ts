/**
 * useSimulation — the browser-side hub runtime.
 *
 * Owns a ticking simulated Clock, a ReadingStore (history), and a Scheduler that
 * re-evaluates each Question's compiledSpec against the store on every tick — so
 * temporal predicates (`sustained`, `schedule`) actually work: an answer can flip
 * true because time passed, with no input change. Actions issue latching Commands
 * (no auto-revert). This is the reference implementation of the engine in doc 04;
 * the Pi hub mirrors it against wall time + real sensors + the IoT shadow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { brain } from './brain';
import { evaluate } from './engine/predicate';
import { parseDuration, formatDuration } from './engine/duration';
import { ReadingStore } from './engine/store';
import { isNight, minutesOfDay, simTimeAt } from './engine/simtime';
import type { RunState } from './engine/types';
import { applyActuator, initialWorld, VISITORS } from './home';
import type { ActivityEvent, Judgment, Question, Visitor, WorldState } from './types';

export type AuthorPhase = 'idle' | 'thinking' | 'compiled';

const TICK_MS = 250;
const START_MIN = 14 * 60 + 2; // 14:02
const DAY_MIN = 8 * 60 + 15;
const NIGHT_MIN = 20 * 60 + 40;
export const SPEEDS = [1, 60, 300];

let evId = 0;
const nextEvId = () => `ev-${Date.now().toString(36)}-${(evId += 1)}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const freshRun = (): RunState => ({ lastAnswer: false, lastEvalAt: 0, lastFiredAt: 0 });

/** Seed the store with a baseline reading per sensor so history/sustained work. */
function seed(store: ReadingStore, w: WorldState, now: number) {
  for (const [id, v] of Object.entries(w.sensors)) if (v !== null) store.append(id, v as never, now);
}

export function useSimulation() {
  const [world, setWorld] = useState<WorldState>(initialWorld);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [authorPhase, setAuthorPhase] = useState<AuthorPhase>('idle');
  const [draft, setDraft] = useState<Question | null>(null);
  const [push, setPush] = useState<{ id: string; text: string } | null>(null);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(60);

  const store = useRef(new ReadingStore());
  const worldRef = useRef<WorldState>(world);
  const questionsRef = useRef<Question[]>(questions);
  const runs = useRef<Record<string, RunState>>({});
  const pending = useRef<{ q: Question; visitor: Visitor | null; scene: string }[]>([]);
  const simMs = useRef(simTimeAt(START_MIN));
  const runningRef = useRef(running);
  const speedRef = useRef(speed);
  const alive = useRef(true);

  questionsRef.current = questions;
  runningRef.current = running;
  speedRef.current = speed;

  const setWorldBoth = useCallback((u: (w: WorldState) => WorldState) => {
    worldRef.current = u(worldRef.current);
    setWorld(worldRef.current);
  }, []);

  const emit = useCallback((ev: Omit<ActivityEvent, 'id' | 'time'>) => {
    const mins = minutesOfDay(ev.clock);
    const time = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
    setActivity((prev) => [{ ...ev, id: nextEvId(), time }, ...prev].slice(0, 24));
  }, []);

  const firePush = useCallback((text: string) => {
    const id = nextEvId();
    setPush({ id, text });
    setTimeout(() => alive.current && setPush((p) => (p?.id === id ? null : p)), 4200);
  }, []);

  /* -------------------------------------------------- firing */

  const fireLocal = useCallback(
    (q: Question, now: number, trueSince?: number | null) => {
      if (q.actuates.length) setWorldBoth((w) => q.actuates.reduce((acc, id) => applyActuator(acc, id, true, q.title), w));
      const detail = trueSince != null && now - trueSince > 0 ? `held ${formatDuration(now - trueSince)}` : undefined;
      const judgment: Judgment = {
        fired: true,
        verdict: 'FIRED',
        reasoning: `${cap(q.trigger)} — I ran your watch and let you know.`,
        steps: [q.actuates.length ? `set ${q.actuates.join(', ')}` : 'noted it', q.push ? 'pushed you' : ''].filter(Boolean),
        privacyNote: 'ran as a local rule on your hub — nothing left the house',
      };
      emit({ clock: now, questionId: q.id, questionTitle: q.title, kind: 'fired', judgment, local: true, detail, push: q.push ? q.title : undefined });
      if (q.push) firePush(`🔥 ${q.title} — ${q.action}`);
    },
    [emit, firePush, setWorldBoth],
  );

  const judgeAndEmit = useCallback(
    async (q: Question, visitor: Visitor | null, scene: string, now: number, reconnect = false) => {
      const question = q.compiledSpec.kind === 'cloud' ? q.compiledSpec.cloud.question : '';
      const judgment = await brain.judge({ dep: q, visitor, scene, questions: [question] });
      if (!alive.current) return;
      if (judgment.fired) {
        if (q.actuates.length) setWorldBoth((w) => q.actuates.reduce((acc, id) => applyActuator(acc, id, true, q.title), w));
        emit({ clock: now, questionId: q.id, questionTitle: q.title, kind: reconnect ? 'reconnect' : 'fired', judgment, local: false, push: q.push ? judgment.verdict : undefined });
        if (q.push) firePush(`👁 ${q.title} — ${judgment.reasoning}`);
      } else {
        emit({ clock: now, questionId: q.id, questionTitle: q.title, kind: reconnect ? 'reconnect' : 'held', judgment, local: false });
      }
    },
    [emit, firePush, setWorldBoth],
  );

  /* -------------------------------------------------- scheduler */

  const runScheduler = useCallback(
    (now: number) => {
      const ctx = { store: store.current, now };
      for (const q of questionsRef.current) {
        const run = runs.current[q.id] ?? freshRun();
        runs.current[q.id] = run;

        if (q.compiledSpec.kind === 'local') {
          const { value, trueSince } = evaluate(q.compiledSpec.local.expr, ctx);
          run.trueSince = trueSince;
          run.lastEvalAt = now;
          const cooldown = parseDuration(q.fire.cooldown);
          const rising = q.fire.edge === 'rising';
          const fireOk = value && (rising ? !run.lastAnswer : true) && now - run.lastFiredAt >= cooldown;
          run.lastAnswer = value;
          if (fireOk) {
            run.lastFiredAt = now;
            fireLocal(q, now, trueSince);
          }
          continue;
        }

        // cloud_vl: cheap local gate, then judge once per scene
        const gate = q.compiledSpec.cloud.gate;
        const gateOk = gate ? evaluate(gate, ctx).value : true;
        const scene = String(worldRef.current.sensors['camera.frame'] ?? 'the doorway');
        const sceneKey = worldRef.current.visitor?.id ?? 'none';
        if (!gateOk) {
          run.lastAnswer = false;
          run.sceneKey = undefined;
          continue;
        }
        if (run.busy || run.sceneKey === sceneKey) continue;
        run.sceneKey = sceneKey;
        run.lastEvalAt = now;
        if (!worldRef.current.online) {
          pending.current.push({ q, visitor: worldRef.current.visitor, scene });
          emit({ clock: now, questionId: q.id, questionTitle: q.title, kind: 'offline', local: false });
          continue;
        }
        run.busy = true;
        void judgeAndEmit(q, worldRef.current.visitor, scene, now).finally(() => {
          run.busy = false;
        });
      }
    },
    [emit, fireLocal, judgeAndEmit],
  );

  /* -------------------------------------------------- clock loop */

  useEffect(() => {
    alive.current = true;
    seed(store.current, worldRef.current, simMs.current);
    const id = setInterval(() => {
      if (runningRef.current) simMs.current += TICK_MS * speedRef.current;
      const now = simMs.current;
      const mins = minutesOfDay(now);
      const tod = isNight(now) ? 'night' : 'day';
      if (mins !== worldRef.current.clock || tod !== worldRef.current.timeOfDay) {
        setWorldBoth((w) => ({ ...w, clock: mins, timeOfDay: tod }));
      }
      runScheduler(now);
    }, TICK_MS);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* -------------------------------------------------- authoring */

  const describe = useCallback(
    async (wish: string) => {
      const trimmed = wish.trim();
      if (!trimmed || authorPhase === 'thinking') return;
      setAuthorPhase('thinking');
      setDraft(null);
      const q = await brain.author(trimmed);
      if (!alive.current) return;
      runs.current[q.id] = freshRun();
      questionsRef.current = [...questionsRef.current, q];
      setQuestions((prev) => [...prev, q]);
      setDraft(q);
      setAuthorPhase('compiled');
      emit({ clock: simMs.current, questionId: q.id, questionTitle: q.title, kind: 'authored', local: q.runsLocally });
      runScheduler(simMs.current);
    },
    [authorPhase, emit, runScheduler],
  );

  const dismissDraft = useCallback(() => {
    setAuthorPhase('idle');
    setDraft(null);
  }, []);

  /* -------------------------------------------------- world pokes */

  const pokeSensor = useCallback(
    (id: string, value: WorldState['sensors'][string], extra?: (w: WorldState) => WorldState) => {
      const now = simMs.current;
      if (value !== null) store.current.append(id, value as never, now);
      setWorldBoth((w) => {
        const next = { ...w, sensors: { ...w.sensors, [id]: value } };
        return extra ? extra(next) : next;
      });
      runScheduler(now);
    },
    [runScheduler, setWorldBoth],
  );

  const setGarageDoor = useCallback((open: boolean) => pokeSensor('garage.door', open ? 'open' : 'closed'), [pokeSensor]);
  const setTemp = useCallback((t: number) => pokeSensor('garage.temp', t), [pokeSensor]);
  const setLivingMotion = useCallback((on: boolean) => pokeSensor('living.motion', on), [pokeSensor]);
  const setLivingTemp = useCallback((t: number) => pokeSensor('living.temp', t), [pokeSensor]);

  const setVisitor = useCallback(
    (visitor: Visitor | null) => {
      const now = simMs.current;
      store.current.append('entry.presence', !!visitor, now);
      if (visitor?.rfid) store.current.append('entry.rfid', visitor.rfid, now);
      // a new person should be re-judged
      for (const q of questionsRef.current) if (q.usesVision) runs.current[q.id] = freshRun();
      setWorldBoth((w) => ({
        ...w,
        visitor,
        sensors: {
          ...w.sensors,
          'entry.presence': !!visitor,
          'entry.rfid': visitor?.rfid ?? null,
          'camera.frame': visitor ? `a person at the doorway (${visitor.label})` : 'empty doorway',
        },
      }));
      runScheduler(now);
    },
    [runScheduler, setWorldBoth],
  );

  const setDay = useCallback(
    (day: boolean) => {
      simMs.current = simTimeAt(day ? DAY_MIN : NIGHT_MIN);
      const now = simMs.current;
      setWorldBoth((w) => ({ ...w, clock: minutesOfDay(now), timeOfDay: day ? 'day' : 'night' }));
      runScheduler(now);
    },
    [runScheduler, setWorldBoth],
  );

  const setOnline = useCallback(
    (online: boolean) => {
      const now = simMs.current;
      setWorldBoth((w) => ({ ...w, online }));
      if (online && pending.current.length) {
        const buffered = pending.current;
        pending.current = [];
        emit({
          clock: now,
          questionId: 'system',
          questionTitle: 'Back online',
          kind: 'reconnect',
          judgment: { fired: false, verdict: 'SYNC', reasoning: `You were offline. ${buffered.length} thing${buffered.length > 1 ? 's' : ''} needed cloud reasoning — catching up.`, steps: buffered.map((b) => `re-checking “${b.q.title}”`) },
        });
        buffered.forEach((b, i) => setTimeout(() => alive.current && void judgeAndEmit(b.q, b.visitor, b.scene, simMs.current, true), 500 + i * 700));
      }
      runScheduler(now);
    },
    [emit, judgeAndEmit, runScheduler, setWorldBoth],
  );

  const jump = useCallback(
    (ms: number) => {
      simMs.current += ms;
      const now = simMs.current;
      setWorldBoth((w) => ({ ...w, clock: minutesOfDay(now), timeOfDay: isNight(now) ? 'night' : 'day' }));
      runScheduler(now);
    },
    [runScheduler, setWorldBoth],
  );

  const removeQuestion = useCallback((id: string) => {
    delete runs.current[id];
    questionsRef.current = questionsRef.current.filter((q) => q.id !== id);
    setQuestions((prev) => prev.filter((q) => q.id !== id));
  }, []);

  const reset = useCallback(() => {
    runs.current = {};
    pending.current = [];
    store.current.clear();
    simMs.current = simTimeAt(START_MIN);
    const w = initialWorld();
    worldRef.current = w;
    questionsRef.current = [];
    seed(store.current, w, simMs.current);
    setQuestions([]);
    setActivity([]);
    setDraft(null);
    setAuthorPhase('idle');
    setPush(null);
    setWorld(w);
  }, []);

  return useMemo(
    () => ({
      world,
      questions,
      activity,
      authorPhase,
      draft,
      push,
      running,
      speed,
      brainLabel: brain.label,
      visitors: VISITORS,
      describe,
      dismissDraft,
      setRunning,
      setSpeed,
      jump,
      setDay,
      setOnline,
      setGarageDoor,
      setTemp,
      setLivingMotion,
      setLivingTemp,
      setVisitor,
      removeQuestion,
      reset,
    }),
    [world, questions, activity, authorPhase, draft, push, running, speed, describe, dismissDraft, jump, setDay, setOnline, setGarageDoor, setTemp, setLivingMotion, setLivingTemp, setVisitor, removeQuestion, reset],
  );
}

export type Simulation = ReturnType<typeof useSimulation>;
