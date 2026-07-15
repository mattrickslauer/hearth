/**
 * The runtime Qwen-VL loop — what turns a `vision` tag into an actual look.
 *
 * A vision watch compiles to `{kind:'cloud', cloud:{model, question, gate?, maxCadence?}}`.
 * That grammar has always existed; nothing ever evaluated it, so a cloud watch was
 * authored, stored, tagged in the UI — and then sat there forever. This is the
 * evaluator it was missing, and it's the only place Qwen runs at RUNTIME rather
 * than at authoring time.
 *
 * It runs where the frames already land. A paired hub POSTs /hub/frame, the bytes go
 * to OSS, and the arrival of a fresh frame IS the trigger — so there is no scheduler
 * here on purpose: Function Compute freezes idle instances, so a setInterval would
 * silently stop firing in production. A useful consequence is that the camera's snap
 * cadence doubles as the watch's frame rate: the existing snap-rate slider is
 * literally how often Qwen gets to look.
 *
 * Cost discipline, in order, before a single token is spent:
 *   maxCadence — never judge faster than the spec's own budget floor
 *   gate       — a cheap LOCAL predicate must pass first (the same pure evaluator
 *                the hub runs offline), so the cloud call is the exception
 * Only then do we presign the frame and call Qwen-VL.
 *
 * Run state (rising edge, cooldown, cadence) lives in the store, not in a module
 * global — an FC instance holding it in memory would lose it on freeze and re-fire
 * on thaw. It's deliberately NOT derived from the event feed either; see WatchRunState.
 */

import { ReadingStore, evaluate, parseDuration, type PredicateNode, type Question } from './domain';
import { deliver, defaultChannel } from './notify';
import { frameKey, presignKey, resolveImage } from './oss';
import { judge } from './qwen';
import type { HomeStore, RunEventRow, WatchRunState } from './store';

/** How far back to hydrate a gate's series. Covers any sane `sustained`/`delta` window. */
const GATE_LOOKBACK_MS = 60 * 60 * 1000;

/** Presigned frame URLs are handed straight to Qwen-VL; they only need to outlive the call. */
const FRAME_URL_TTL_S = 300;

export type SkipReason = 'cadence' | 'gate' | 'no-frame' | 'cooldown' | 'edge';

export interface VisionOutcome {
  questionId: string;
  title: string;
  /** True when we actually spent a Qwen-VL call. */
  judged: boolean;
  skipped?: SkipReason;
  fired?: boolean;
  verdict?: string;
  reasoning?: string;
  engine?: 'qwen' | 'mock';
  actuated?: string[];
  notified?: boolean;
}

/** Every inputId a predicate node touches, so we hydrate only the series the gate reads. */
function gateInputs(node: PredicateNode): string[] {
  const out: string[] = [];
  const walk = (n: PredicateNode): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as unknown as Record<string, unknown>;
    const left = o.left as { input?: string } | undefined;
    const inp = o.input as { input?: string } | undefined;
    if (left?.input) out.push(left.input);
    if (inp?.input) out.push(inp.input);
    if (Array.isArray(o.nodes)) (o.nodes as PredicateNode[]).forEach(walk);
    if (o.node) walk(o.node as PredicateNode);
  };
  walk(node);
  return [...new Set(out)];
}

/** Build the evaluator's ReadingStore from the persisted time series for just those inputs. */
async function hydrateGate(store: HomeStore, node: PredicateNode, now: number): Promise<ReadingStore> {
  const rs = new ReadingStore();
  for (const input of gateInputs(node)) {
    const rows = await store.history(input, now - GATE_LOOKBACK_MS, now);
    for (const r of rows) rs.append(r.input, r.value, r.ts);
  }
  return rs;
}

const freshState = (questionId: string): WatchRunState => ({
  questionId,
  lastJudgedAt: 0,
  lastFiredAt: 0,
  lastAnswer: false,
});

const ms = (d: unknown): number => {
  if (d == null) return 0;
  try {
    return parseDuration(d as string | number);
  } catch {
    return 0;
  }
};

/** Is this cloud watch pointed at `input`? Either it binds it, or it records it. */
const watchesInput = (q: Question, input: string): boolean =>
  (Array.isArray(q.boundInputs) && q.boundInputs.includes(input)) || q.record?.inputId === input;

/**
 * Judge every vision watch aimed at `input` against the frame that just landed.
 *
 * Returns one outcome per candidate watch (including the skips, so callers can see
 * *why* nothing was spent). Never throws: a frame push must still succeed even if
 * Qwen, OSS, or a notify channel is having a bad day.
 */
export async function judgeFrame(store: HomeStore, input: string, now = Date.now()): Promise<VisionOutcome[]> {
  const questions = await store.listQuestions();
  const candidates = questions.filter((q) => q.compiledSpec?.kind === 'cloud' && watchesInput(q, input));
  if (!candidates.length) return [];

  const outcomes: VisionOutcome[] = [];

  for (const q of candidates) {
    const spec = q.compiledSpec;
    if (spec.kind !== 'cloud') continue;
    const check = spec.cloud;
    const base = { questionId: q.id, title: q.title };
    const state = (await store.getRunState(q.id)) ?? freshState(q.id);

    // 1) Budget floor — the spec's own "never look faster than this".
    const floor = ms(check.maxCadence);
    if (floor && state.lastJudgedAt && now - state.lastJudgedAt < floor) {
      outcomes.push({ ...base, judged: false, skipped: 'cadence' });
      continue;
    }

    // 2) Cheap local gate — the whole point is that the cloud call is the exception.
    if (check.gate) {
      try {
        const rs = await hydrateGate(store, check.gate, now);
        if (!evaluate(check.gate, { store: rs, now }).value) {
          outcomes.push({ ...base, judged: false, skipped: 'gate' });
          continue;
        }
      } catch (e) {
        console.warn(`[vision] gate eval failed for ${q.id}; judging anyway:`, (e as Error).message);
      }
    }

    // 3) The frame Qwen-VL will actually look at.
    let frameUrl: string;
    try {
      frameUrl = await presignKey(frameKey(input), FRAME_URL_TTL_S);
    } catch (e) {
      console.warn(`[vision] no frame URL for ${input}:`, (e as Error).message);
      outcomes.push({ ...base, judged: false, skipped: 'no-frame' });
      continue;
    }

    // 4) Reference photos. Linked memory objects narrow "who to look for" to just those;
    //    no links means all of memory — the documented Question.memoryIds behaviour, now
    //    actually read instead of merely stored.
    const household = await store.listHousehold();
    const linked = q.memoryIds?.length ? household.filter((m) => q.memoryIds!.includes(m.id)) : household;
    const references: { label: string; image: string }[] = [];
    for (const m of linked) {
      try {
        references.push({ label: m.label, image: await resolveImage(m.image, FRAME_URL_TTL_S) });
      } catch (e) {
        console.warn(`[vision] skipping reference ${m.id}:`, (e as Error).message);
      }
    }

    // 5) Look.
    let judgment, engine: 'qwen' | 'mock';
    try {
      ({ judgment, engine } = await judge({
        title: q.title,
        trigger: q.trigger,
        questions: [check.question],
        scene: '(live camera frame attached)',
        visitor: null,
        images: [frameUrl],
        references,
      }));
    } catch (e) {
      console.warn(`[vision] judge threw for ${q.id}:`, (e as Error).message);
      outcomes.push({ ...base, judged: false, skipped: 'no-frame' });
      continue;
    }

    const answer = judgment.fired;
    const wasAnswer = state.lastAnswer;
    const evRow = (kind: string): RunEventRow => ({
      id: `ev-${kind}-${q.id}-${now.toString(36)}`,
      ts: now,
      questionId: q.id,
      kind,
      answer,
      reasoning: judgment.reasoning || judgment.verdict,
      evaluatedBy: engine === 'qwen' ? 'qwen' : 'local',
    });

    // We spent the call — record that before deciding what to do with the verdict, so a
    // throw further down can't leave the budget floor thinking we never looked.
    state.lastJudgedAt = now;
    state.lastAnswer = answer;
    await store.putRunState(state);

    // 6) Fire policy. `rising` fires once per false→true; `cooldown` rate-limits either way.
    if (!answer) {
      // De-noise: only log a fresh "held" when the answer actually changed, so a quiet
      // camera doesn't bury the feed under one row per frame.
      if (wasAnswer) await store.appendEvent(evRow('held'));
      outcomes.push({ ...base, judged: true, fired: false, verdict: judgment.verdict, reasoning: judgment.reasoning, engine });
      continue;
    }
    if (q.fire?.edge === 'rising' && wasAnswer) {
      outcomes.push({ ...base, judged: true, fired: false, skipped: 'edge', verdict: judgment.verdict, engine });
      continue;
    }
    const cooldown = ms(q.fire?.cooldown);
    if (cooldown && state.lastFiredAt && now - state.lastFiredAt < cooldown) {
      outcomes.push({ ...base, judged: true, fired: false, skipped: 'cooldown', verdict: judgment.verdict, engine });
      continue;
    }

    await store.appendEvent(evRow('fired'));
    state.lastFiredAt = now;
    await store.putRunState(state);

    // 7) Act. setDesired is the device shadow the hub pulls on its next sync — the same
    //    downlink the `actuate` tool writes, so a Qwen-driven fire and a hand-driven one
    //    reach hardware through one path.
    const actuated: string[] = [];
    for (const a of q.actuates ?? []) {
      try {
        await store.setDesired(a, true);
        actuated.push(a);
      } catch (e) {
        console.warn(`[vision] actuate ${a} failed:`, (e as Error).message);
      }
    }
    if (actuated.length) {
      await store.appendEvent({
        id: `ev-act-${q.id}-${now.toString(36)}`,
        ts: now,
        questionId: q.id,
        kind: 'actuate',
        reasoning: `${actuated.join(', ')} := on — ${judgment.verdict}`,
      });
    }

    let notified = false;
    if (q.push) {
      const message = `${q.action || q.title} — ${judgment.reasoning || judgment.verdict}`;
      const res = await deliver(defaultChannel(), message);
      notified = res.delivered;
      await store.appendEvent({
        id: `ev-notify-${q.id}-${now.toString(36)}`,
        ts: now,
        questionId: q.id,
        kind: 'notify',
        reasoning: `${defaultChannel()}: ${message}`,
      });
    }

    outcomes.push({
      ...base,
      judged: true,
      fired: true,
      verdict: judgment.verdict,
      reasoning: judgment.reasoning,
      engine,
      actuated,
      notified,
    });
  }

  return outcomes;
}
