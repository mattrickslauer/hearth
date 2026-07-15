/**
 * hub/runtime.mjs — the watch runtime that makes the hub actually *do* things.
 *
 * This is the piece that turns the hub from a passive collector into an edge
 * agent: it loads compiled watches, evaluates them against live node readings on
 * every tick and on every fresh reading, and on a rising edge it FIRES —
 *   1. actuates a real node (e.g. lights its LED / flips a relay) via HTTP, and
 *   2. sends you a real phone notification (see notify.mjs).
 *
 * The evaluator is the real ported engine (engine.mjs) interpreting the exact
 * `PredicateNode` spec Qwen emits — so "warm the sensor past a threshold → the
 * board lights up → my phone buzzes" is a genuine end-to-end loop, no sim.
 *
 * WHERE WATCHES COME FROM — two sources, cloud wins:
 *   1. The cloud (normal). Every device sync hands the hub the account's authored
 *      watches (hub.mjs → setWatches). Author one in the app and it is running on
 *      your hardware about a second later; nothing to copy, nothing to restart.
 *   2. HUB_WATCHES_FILE (default ~/.hearth/watches.json) — read at boot, and also
 *      where we cache the cloud's set, so a hub that reboots with no internet keeps
 *      running the last-known watches. Hand-authoring still works: see
 *      watches.example.json.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

import { ReadingStore, evaluate, parseDuration } from './engine.mjs';
import { notify, notifyChannels } from './notify.mjs';

// Resolved lazily (not at import) so a launcher can set the env first.
const watchesFilePath = () =>
  process.env.HUB_WATCHES_FILE || join(process.env.HEARTH_HOME || join(homedir(), '.hearth'), 'watches.json');

const TICK_MS = Number(process.env.HUB_TICK_MS || 1000);

function fill(template, ctx) {
  if (typeof template !== 'string') return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] != null ? String(ctx[k]) : `{${k}}`));
}

/**
 * Resolves a predicate's input id to a real series key, so two nodes reporting the
 * same sensor key can't collide.
 *
 * Series are stored FULLY QUALIFIED — "<nodeId>.<key>" — which is the same id the
 * cloud uses (`hub-devices.ts` appendReading, the cadence + desired-state downlinks).
 * Predicates may reference either form:
 *
 *   "node-a1b2.board.temp"  → exact hit, used as-is.
 *   "board.temp"            → bare key. Unique across nodes → resolved. Reported by
 *                             two+ nodes → AMBIGUOUS: we warn once and read null
 *                             rather than silently pick a node (which was the bug:
 *                             the watch fired on whichever node reported last).
 *
 * Note sensor keys contain dots themselves ("board.temp"), so a qualified id can't be
 * split on the first dot — hence suffix matching against the live series instead.
 */
class ScopedStore {
  constructor(store, log) {
    this.store = store;
    this.log = log;
    this.warned = new Set();
  }

  /** → a concrete series key, or null when unknown/ambiguous. */
  resolve(input) {
    if (typeof input !== 'string' || !input) return null;
    if (this.store.buf.has(input)) return input; // already qualified
    const suffix = `.${input}`;
    let hit = null;
    let n = 0;
    for (const key of this.store.buf.keys()) {
      if (key.endsWith(suffix)) {
        hit = key;
        if (++n > 1) break;
      }
    }
    if (n === 1) return hit;
    if (n > 1 && !this.warned.has(input)) {
      this.warned.add(input);
      const all = [...this.store.buf.keys()].filter((k) => k.endsWith(suffix));
      this.log(
        `[runtime] ⚠️  input "${input}" is ambiguous — ${all.join(', ')} all report it. ` +
          `Qualify it in the watch spec (e.g. "${all[0]}") or it will read as no-data.`,
      );
    }
    return null;
  }

  // The engine only ever reads through these five — each resolves, then delegates.
  valueAsOf(input, ts) {
    const k = this.resolve(input);
    return k == null ? null : this.store.valueAsOf(k, ts);
  }
  latest(input) {
    const k = this.resolve(input);
    return k == null ? null : this.store.latest(k);
  }
  history(input, from, to) {
    const k = this.resolve(input);
    return k == null ? [] : this.store.history(k, from, to);
  }
  transitionsSince(input, from) {
    const k = this.resolve(input);
    return k == null ? [] : this.store.transitionsSince(k, from);
  }
  agg(input, agg, window, now) {
    const k = this.resolve(input);
    return k == null ? null : this.store.agg(k, agg, window, now);
  }
}

/**
 * Map one cloud Question onto the hub's watch shape. The cloud sends `actuates` as
 * actuator INPUT IDS ("<nodeId>.<key>"); the hub owns node identity, so it splits them
 * here against the live registry (longest known node id wins) rather than guessing at
 * a dot — actuator keys may contain dots too.
 */
function fromCloud(w, nodes) {
  const actuate = [];
  for (const input of w.actuates || []) {
    if (typeof input !== 'string') continue;
    let nodeId = null;
    for (const id of nodes?.keys() ?? []) {
      if (input.startsWith(`${id}.`) && (nodeId == null || id.length > nodeId.length)) nodeId = id;
    }
    if (nodeId == null) {
      // Node not in the registry yet (hasn't announced since boot) — fall back to the
      // first dot so the watch still works once it does.
      const i = input.indexOf('.');
      if (i <= 0) continue;
      nodeId = input.slice(0, i);
    }
    actuate.push({ nodeId, actuator: input.slice(nodeId.length + 1), value: 'on' });
  }
  return {
    id: w.id,
    title: w.title,
    compiledSpec: w.compiledSpec,
    fire: w.fire || { edge: 'rising', cooldown: '10s' },
    actuate,
    notify: w.notify ?? null,
  };
}

const isLocal = (w) => w?.compiledSpec?.kind === 'local' && w.compiledSpec.local?.expr;

export function createRuntime({ nodes, log = console.log, watchesFile } = {}) {
  const store = new ReadingStore();
  const scoped = new ScopedStore(store, log);
  const runs = new Map(); // watchId → { lastAnswer, lastFiredAt }
  let watches = [];
  let source = 'file'; // 'file' until the cloud speaks; then 'cloud'

  function loadWatches() {
    const file = watchesFile || watchesFilePath();
    if (!existsSync(file)) {
      log(`[runtime] no watches file at ${file} — waiting for the cloud to send some`);
      watches = [];
      return watches;
    }
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const list = Array.isArray(raw) ? raw : Array.isArray(raw.watches) ? raw.watches : [];
      watches = list.filter(isLocal);
      const skipped = list.length - watches.length;
      log(
        `[runtime] loaded ${watches.length} local watch(es) from ${file}` +
          (skipped ? ` (skipped ${skipped} non-local/cloud — vision watches run in the app, not on the hub yet)` : ''),
      );
      const chans = notifyChannels();
      log(chans.length ? `[runtime] notify channels: ${chans.join(', ')}` : '[runtime] no notify channel configured (set NTFY_TOPIC to get phone pushes)');
    } catch (e) {
      log(`[runtime] failed to read watches: ${e.message}`);
    }
    return watches;
  }

  /**
   * Adopt the account's watches from the cloud — this is what closes the loop from
   * "author it in the app" to "it runs on my hardware", with no copy-paste.
   *
   * Called on every device sync (see hub.mjs syncToCloud), which is debounced onto live
   * readings — so an authored watch reaches the hub in about a second while a sensor is
   * streaming, and within SYNC_MS at worst.
   *
   * Idempotent: unchanged specs keep their run state (so a re-sync can't re-fire a watch
   * that's already high, and cooldowns survive). We also cache to disk so a hub that
   * reboots with no internet still runs the last-known set.
   */
  function setWatches(list) {
    if (!Array.isArray(list)) return watches;
    const next = list.map((w) => fromCloud(w, nodes)).filter(isLocal);
    const before = new Map(watches.map((w) => [w.id, JSON.stringify(w.compiledSpec)]));

    // Drop run state for watches that vanished or whose predicate changed — a re-compiled
    // watch is a new rule and must be free to fire on its next rising edge.
    const live = new Set(next.map((w) => w.id));
    for (const id of [...runs.keys()]) if (!live.has(id)) runs.delete(id);
    for (const w of next) {
      const prev = before.get(w.id);
      if (prev != null && prev !== JSON.stringify(w.compiledSpec)) runs.delete(w.id);
    }

    const added = next.filter((w) => !before.has(w.id)).length;
    const removed = [...before.keys()].filter((id) => !live.has(id)).length;
    const changed = next.filter((w) => before.has(w.id) && before.get(w.id) !== JSON.stringify(w.compiledSpec)).length;
    watches = next;
    if (source !== 'cloud' || added || removed || changed) {
      const skipped = list.length - next.length;
      log(
        `[runtime] ☁️  watches from cloud: ${next.length} local` +
          (added ? ` · +${added} new` : '') +
          (changed ? ` · ${changed} re-compiled` : '') +
          (removed ? ` · −${removed} removed` : '') +
          (skipped ? ` (${skipped} cloud/vision watch(es) run in the app, not on the hub yet)` : ''),
      );
      for (const w of next) if (!before.has(w.id)) log(`[runtime]     ✍️  "${w.title}"`);
    }
    source = 'cloud';
    cacheWatches();
    return watches;
  }

  // Persist the cloud's set so a restart without internet still has them (the file is
  // also the hand-authored path — see watches.example.json). Best-effort, never fatal.
  function cacheWatches() {
    const file = watchesFile || watchesFilePath();
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(watches, null, 2));
    } catch (e) {
      log(`[runtime] could not cache watches to ${file}: ${e.message}`);
    }
  }

  // Fold a node READING document into the store. Series are keyed "<nodeId>.<key>" —
  // the same id the cloud uses — so two nodes reporting "board.temp" stay distinct.
  function onReading(doc) {
    if (!doc || doc.type !== 'hearth.node.reading' || !doc.readings || !doc.id) return;
    const now = Date.now();
    for (const [key, value] of Object.entries(doc.readings)) {
      if (value == null) continue;
      store.append(`${doc.id}.${key}`, value, now);
    }
    evaluateAll(now);
  }

  async function actuate(act, watch) {
    const node = nodes?.get(act.nodeId);
    const ip = node?.describe?.ip || node?.addr;
    if (!ip) {
      log(`[runtime] ⚡ ${watch.title}: can't actuate ${act.nodeId}.${act.actuator} — node address unknown`);
      return;
    }
    const spec = (node?.describe?.actuators || []).find((a) => a.key === act.actuator);
    const port = act.port || spec?.port || 8080;
    const path = act.path || spec?.path || '/actuate';
    const url = `http://${ip}:${port}${path}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actuator: act.actuator, value: act.value }),
      });
      log(`[runtime] ⚡ ${watch.title}: ${act.nodeId}.${act.actuator} → ${act.value}  (${url} ${res.status})`);
    } catch (e) {
      log(`[runtime] ⚡ ${watch.title}: actuate ${url} failed — ${e.message}`);
    }
  }

  async function fire(watch, now, detail) {
    log(`[runtime] 🔥 FIRED  "${watch.title}"  (${detail})`);
    for (const act of watch.actuate || []) await actuate(act, watch);
    if (watch.notify) {
      // `notify` sends the title separately (push title), so the body should NOT repeat it.
      const msg = typeof watch.notify === 'string' ? fill(watch.notify, { title: watch.title, detail }) : detail;
      await notify(`🔥 ${watch.title}`, msg);
    }
  }

  function evaluateAll(now = Date.now()) {
    for (const w of watches) {
      const run = runs.get(w.id) || { lastAnswer: false, lastFiredAt: 0 };
      runs.set(w.id, run);
      const { value } = evaluate(w.compiledSpec.local.expr, { store: scoped, now });
      const fp = w.fire || {};
      const cooldown = parseDuration(fp.cooldown ?? '10s');
      const rising = (fp.edge ?? 'rising') === 'rising';
      const fireOk = value && (rising ? !run.lastAnswer : true) && now - run.lastFiredAt >= cooldown;
      run.lastAnswer = value;
      if (fireOk) {
        run.lastFiredAt = now;
        const hit = firstInput(w.compiledSpec.local.expr, scoped, now);
        void fire(w, now, hit ? `${hit.input} = ${hit.value}` : 'condition met');
      }
    }
  }

  function start() {
    loadWatches();
    const timer = setInterval(() => evaluateAll(), TICK_MS); // time-based predicates (sustained/schedule)
    timer.unref?.();
    return timer;
  }

  return { store, onReading, start, loadWatches, setWatches, get watches() { return watches; } };
}

/** Best-effort: the first input the predicate references + its current value (for a human-readable fire detail). */
function firstInput(node, store, now) {
  const stack = [node];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    const input = n.left?.input || n.input?.input;
    if (input) return { input, value: store.valueAsOf(input, now) };
    if (n.nodes) stack.push(...n.nodes);
    if (n.node) stack.push(n.node);
  }
  return null;
}
