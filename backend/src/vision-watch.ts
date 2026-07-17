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
import { deliverNotification } from './notify';
import { framesFor, resolveImage } from './oss';
import { predicateInputs } from './predicate-inputs';
import { judge } from './qwen';
import type { HomeStore, RunEventRow, WatchRunState } from './store';
import type { AccountId } from './auth';

/** How far back to hydrate a gate's series. Covers any sane `sustained`/`delta` window. */
const GATE_LOOKBACK_MS = 60 * 60 * 1000;

/**
 * The floor we apply when a watch's spec doesn't name one — matching the `?? '10s'`
 * the record policy already defaults to (tools.ts).
 *
 * This is a backstop, not a preference. `maxCadence` and `gate` are both OPTIONAL in the
 * grammar, and validateQuestion doesn't require either — the author prompt only *shows*
 * them in its example. So a perfectly valid Qwen-authored watch can arrive with no floor
 * at all, and frames arrive as fast as the camera's snap cadence (which goes to 0.5s).
 * Treating "absent" as "unlimited" would mean two billed Qwen-VL calls a second, forever,
 * because a model forgot a field. Never let the floor be zero.
 */
const DEFAULT_MAX_CADENCE_MS = 10_000;

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

/** Build the evaluator's ReadingStore from the persisted time series for just those inputs. */
async function hydrateGate(store: HomeStore, node: PredicateNode, now: number): Promise<ReadingStore> {
  const rs = new ReadingStore();
  for (const input of new Set(predicateInputs(node))) {
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

/**
 * Skip tallies waiting to be written — "how many calls the gate saved you".
 *
 * The skip path is the HOT path (a frame every 0.5s per watch) and its entire purpose is
 * to spend nothing, so it must not write. A putRow per skip would be ~170k writes/day/watch
 * and the audit would cost more than the Looks it audits. So deltas accumulate here and
 * ride along with a state write that was going to happen anyway.
 *
 * Consequences, accepted deliberately: an FC freeze drops the pending delta, and each
 * instance holds its own. These counters are therefore APPROXIMATE and always
 * under-count — which is why nothing derived from money reads them. Real spend is a `usd`
 * on an immutable run row, written the moment it's incurred.
 */
const pendingSkips = new Map<string, Partial<Record<SkipReason, number>>>();

/** Flush anyway once a watch has skipped this many times, so a watch whose gate never
 *  opens still reports its savings. 1 write per 50 skips is ~2% of the write traffic a
 *  per-skip counter would have cost. */
const SKIP_FLUSH_EVERY = 50;

const pendingTotal = (p: Partial<Record<SkipReason, number>>): number =>
  Object.values(p).reduce((n: number, v) => n + (v ?? 0), 0);

/** Record a skip in memory. Returns true when it's time to flush to the store. */
function noteSkip(questionId: string, reason: SkipReason): boolean {
  const p = pendingSkips.get(questionId) ?? {};
  p[reason] = (p[reason] ?? 0) + 1;
  pendingSkips.set(questionId, p);
  return pendingTotal(p) >= SKIP_FLUSH_EVERY;
}

/** Fold pending skip deltas into a state row about to be written, and clear them. */
function drainSkips(state: WatchRunState): WatchRunState {
  const p = pendingSkips.get(state.questionId);
  if (!p) return state;
  const skips = { ...state.skips };
  for (const [reason, n] of Object.entries(p)) {
    skips[reason as SkipReason] = (skips[reason as SkipReason] ?? 0) + (n ?? 0);
  }
  pendingSkips.delete(state.questionId);
  return { ...state, skips };
}

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
export async function judgeFrame(store: HomeStore, accountId: AccountId, input: string, now = Date.now()): Promise<VisionOutcome[]> {
  const questions = await store.listQuestions();
  const candidates = questions.filter((q) => q.compiledSpec?.kind === 'cloud' && watchesInput(q, input));
  if (!candidates.length) return [];

  const outcomes: VisionOutcome[] = [];

  // Reference photos are account-wide, so read them once rather than per candidate watch; each
  // watch narrows this single list to its own linked memoryIds below.
  const household = await store.listHousehold();

  for (const q of candidates) {
    const spec = q.compiledSpec;
    if (spec.kind !== 'cloud') continue;
    const check = spec.cloud;
    const base = { questionId: q.id, title: q.title };
    const state = (await store.getRunState(q.id)) ?? freshState(q.id);

    /* Tally a skip without paying for it — see pendingSkips. Only writes on the rare
     * flush tick, never on the frame itself. */
    const skip = async (reason: SkipReason): Promise<void> => {
      if (noteSkip(q.id, reason)) await store.putRunState(drainSkips(state));
      outcomes.push({ ...base, judged: false, skipped: reason });
    };

    // 1) Budget floor — the spec's own "never look faster than this", or ours if it didn't say.
    const floor = ms(check.maxCadence) || DEFAULT_MAX_CADENCE_MS;
    if (state.lastJudgedAt && now - state.lastJudgedAt < floor) {
      await skip('cadence');
      continue;
    }

    // 2) Cheap local gate — the whole point is that the cloud call is the exception.
    if (check.gate) {
      try {
        const rs = await hydrateGate(store, check.gate, now);
        if (!evaluate(check.gate, { store: rs, now }).value) {
          await skip('gate');
          continue;
        }
      } catch (e) {
        console.warn(`[vision] gate eval failed for ${q.id}; judging anyway:`, (e as Error).message);
      }
    }

    // 3) The frame Qwen-VL will actually look at. `read` returns null when no object is really
    //    there, so we skip instead of billing a look at a URL that 404s.
    let frameUrl: string;
    try {
      const frame = await framesFor(store, accountId).read(input, FRAME_URL_TTL_S);
      if (!frame) {
        await skip('no-frame'); // tallied like every other saved call — see pendingSkips
        continue;
      }
      frameUrl = frame.url;
    } catch (e) {
      console.warn(`[vision] no frame URL for ${input}:`, (e as Error).message);
      await skip('no-frame');
      continue;
    }

    // 4) Reference photos. Linked memory objects narrow "who to look for" to just those;
    //    no links means all of memory — the documented Question.memoryIds behaviour, now
    //    actually read instead of merely stored. `household` is fetched once above the loop.
    const linked = q.memoryIds?.length ? household.filter((m) => q.memoryIds!.includes(m.id)) : household;
    const references: { label: string; image: string }[] = [];
    for (const m of linked) {
      try {
        references.push({ label: m.label, image: await resolveImage(m.image, FRAME_URL_TTL_S) });
      } catch (e) {
        console.warn(`[vision] skipping reference ${m.id}:`, (e as Error).message);
      }
    }

    // 5) Look. judge() catches its own errors internally and falls back to the mock verdict —
    //    it never throws — so there is no try/catch here: a model failure surfaces as a mock
    //    engine, not as a mislabelled 'no-frame' skip.
    const { judgment, engine, usage } = await judge({
      title: q.title,
      trigger: q.trigger,
      questions: [check.question],
      scene: '(live camera frame attached)',
      visitor: null,
      images: [frameUrl],
      references,
    });

    const answer = judgment.fired;
    const wasAnswer = state.lastAnswer;
    /* One call, one priced row.
     *
     * `judged` carries the cost; `held`/`fired` describe what we did with the verdict and
     * are deliberately COSTLESS. They all come from the same single Qwen call, so pricing
     * more than one of them would make a fired look bill twice — `totals` just sums `usd`
     * over matching rows and cannot tell a duplicate from a second call. The invariant is:
     * usd is set iff this row IS the billed call. */
    const evRow = (kind: string): RunEventRow => ({
      id: `ev-${kind}-${q.id}-${now.toString(36)}`,
      ts: now,
      questionId: q.id,
      kind,
      answer,
      title: q.title,
      reasoning: judgment.reasoning || judgment.verdict,
      evaluatedBy: engine === 'qwen' ? 'qwen' : 'local',
    });

    /* The billed row. `usage` is what the API said it charged, so a Look's price is
     * measured, not inferred from the quote. No `usage` (mock engine, no key) means no
     * `usd` field at all rather than 0 — "free" and "unmeasured" must stay distinguishable. */
    const judgedRow = (): RunEventRow => ({
      ...evRow('judged'),
      ...(usage
        ? {
            model: usage.model,
            tokens: { in: usage.inTokens, out: usage.outTokens },
            usd: usage.usd,
            ms: usage.ms,
            ...(usage.unrated ? { unrated: true } : {}),
          }
        : {}),
    });

    // We spent the call — record that before deciding what to do with the verdict, so a
    // throw further down can't leave the budget floor thinking we never looked. This is
    // also where accumulated skip deltas land, since we're writing the row regardless.
    const judged = drainSkips(state);
    judged.lastJudgedAt = now;
    judged.lastAnswer = answer;
    judged.judged = (judged.judged ?? 0) + 1;
    if (usage) judged.usd = (judged.usd ?? 0) + usage.usd;
    Object.assign(state, judged);
    await store.putRunState(state);

    /* A judged frame IS a run, whatever the verdict. Log it before the fire policy gets a
     * say: `held`/`fired` describe what we DID, but this row is what we PAID, and a watch
     * that looks 1000×/day and fires twice would otherwise show two rows and hide the bill. */
    await store.appendEvent(judgedRow());

    // 6) Fire policy. `rising` fires once per false→true; `cooldown` rate-limits either way.
    if (!answer) {
      // De-noise: only log a fresh "held" when the answer actually changed, so a quiet
      // camera doesn't bury the feed under one row per frame.
      if (wasAnswer) await store.appendEvent(evRow('held'));
      outcomes.push({ ...base, judged: true, fired: false, verdict: judgment.verdict, reasoning: judgment.reasoning, engine });
      continue;
    }
    /* `edge` and `cooldown` suppress the FIRE, not the call — the money was already spent
     * above. They're tallied (they answer "why didn't my watch fire?") but they are not
     * savings, so they never imply a cheaper bill. Counted with noteSkip rather than the
     * `skip()` helper because that helper reports judged:false, which would be a lie here. */
    if (q.fire?.edge === 'rising' && wasAnswer) {
      noteSkip(q.id, 'edge');
      outcomes.push({ ...base, judged: true, fired: false, skipped: 'edge', verdict: judgment.verdict, engine });
      continue;
    }
    const cooldown = ms(q.fire?.cooldown);
    if (cooldown && state.lastFiredAt && now - state.lastFiredAt < cooldown) {
      noteSkip(q.id, 'cooldown');
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
        title: q.title,
        reasoning: `${actuated.join(', ')} := on — ${judgment.verdict}`,
      });
    }

    let notified = false;
    if (q.push) {
      const message = `${q.action || q.title} — ${judgment.reasoning || judgment.verdict}`;
      // Same per-account channels the hub and the notify tool use (Telegram / email, set in
      // the dashboard) — a cloud watch and a local one reach the same phone. deliverNotification
      // writes the kind:'notify' event itself, so there's no appendEvent here to double-log it.
      const res = await deliverNotification(store, `🔥 ${q.title}`, message, { questionId: q.id });
      notified = res.delivered > 0;
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
