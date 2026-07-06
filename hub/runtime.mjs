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
 * Watches are read from HUB_WATCHES_FILE (default ~/.hearth/watches.json). Author
 * them in plain English in the Hearth app (real Qwen compiles the spec) and drop
 * the compiled watch in, or hand-write one — see watches.example.json.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

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

export function createRuntime({ nodes, log = console.log, watchesFile } = {}) {
  const store = new ReadingStore();
  const runs = new Map(); // watchId → { lastAnswer, lastFiredAt }
  let watches = [];

  function loadWatches() {
    const file = watchesFile || watchesFilePath();
    if (!existsSync(file)) {
      log(`[runtime] no watches file at ${file} — nothing to evaluate yet`);
      watches = [];
      return watches;
    }
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8'));
      const list = Array.isArray(raw) ? raw : Array.isArray(raw.watches) ? raw.watches : [];
      watches = list.filter((w) => w?.compiledSpec?.kind === 'local' && w.compiledSpec.local?.expr);
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

  // Fold a node READING document into the store: one series per reading key.
  function onReading(doc) {
    if (!doc || doc.type !== 'hearth.node.reading' || !doc.readings) return;
    const now = Date.now();
    for (const [key, value] of Object.entries(doc.readings)) {
      if (value == null) continue;
      store.append(key, value, now);
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
      const { value } = evaluate(w.compiledSpec.local.expr, { store, now });
      const fp = w.fire || {};
      const cooldown = parseDuration(fp.cooldown ?? '10s');
      const rising = (fp.edge ?? 'rising') === 'rising';
      const fireOk = value && (rising ? !run.lastAnswer : true) && now - run.lastFiredAt >= cooldown;
      run.lastAnswer = value;
      if (fireOk) {
        run.lastFiredAt = now;
        const hit = firstInput(w.compiledSpec.local.expr, store, now);
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

  return { store, onReading, start, loadWatches, get watches() { return watches; } };
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
