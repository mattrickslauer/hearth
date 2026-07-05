/**
 * hub/engine.mjs — the real rule engine, ported to the hub.
 *
 * This is a faithful port of the browser demo's evaluator
 * (frontend/src/demo/engine/{predicate,store,duration,simtime}.ts) with ONE
 * change: it runs against real wall-clock time instead of the deterministic sim
 * clock. `schedule` predicates therefore resolve against your actual local time.
 *
 * It interprets the SAME compiled `PredicateNode` grammar that Qwen emits when it
 * authors a watch — so a spec authored in the cloud runs unchanged here. Pure
 * data in, boolean out; no side effects. Zero dependencies (Node 18+).
 */

/* ─── duration.ts (verbatim) ─────────────────────────────────────────────── */

const DUR_RE = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/;
const MULT = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };

export function parseDuration(d) {
  if (typeof d === 'number') return d;
  if (!d) return 0;
  const m = DUR_RE.exec(String(d).trim());
  if (!m) return 0;
  return Number(m[1]) * MULT[m[2]];
}

/* ─── wall-clock time helpers (the hub's real-time simtime) ───────────────── */
// The demo derives these from a fake epoch for reproducibility; the hub uses
// the machine's actual LOCAL time, so `schedule` (e.g. "after 19:00") is real.

export function minutesOfDay(now) {
  const d = new Date(now);
  return d.getHours() * 60 + d.getMinutes();
}

export function dayOfWeek(now) {
  return new Date(now).getDay(); // 0 = Sunday … 6 = Saturday
}

export function hhmmToMinutes(s) {
  const [h, m] = String(s).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/* ─── store.ts (ported) ──────────────────────────────────────────────────── */

const CAP = 600; // per-input ring size

export class ReadingStore {
  constructor() {
    this.buf = new Map();
  }

  append(input, value, ts) {
    const arr = this.buf.get(input) ?? [];
    const last = arr[arr.length - 1];
    // keep transitions, not noise: only append when the value actually changed
    if (!last || last.value !== value) {
      arr.push({ input, ts, value });
      if (arr.length > CAP) arr.shift();
      this.buf.set(input, arr);
    }
  }

  latest(input) {
    const a = this.buf.get(input);
    return a && a.length ? a[a.length - 1] : null;
  }

  valueAsOf(input, ts) {
    const a = this.buf.get(input);
    if (!a) return null;
    let v = null;
    for (const r of a) {
      if (r.ts <= ts) v = r.value;
      else break;
    }
    return v;
  }

  history(input, from, to) {
    return (this.buf.get(input) ?? []).filter((r) => r.ts >= from && r.ts <= to);
  }

  transitionsSince(input, from) {
    return (this.buf.get(input) ?? []).filter((r) => r.ts >= from).map((r) => r.ts);
  }

  agg(input, agg, window, now) {
    if (!agg || agg === 'latest') return this.valueAsOf(input, now);
    const w = parseDuration(window);
    const rows = this.history(input, now - w, now)
      .map((r) => Number(r.value))
      .filter((n) => !Number.isNaN(n));
    if (!rows.length) return null;
    switch (agg) {
      case 'mean':
        return rows.reduce((a, b) => a + b, 0) / rows.length;
      case 'min':
        return Math.min(...rows);
      case 'max':
        return Math.max(...rows);
      case 'count':
        return rows.length;
      default:
        return null;
    }
  }

  clear() {
    this.buf.clear();
  }
}

/* ─── predicate.ts (ported) ──────────────────────────────────────────────── */

function cmp(op, a, b) {
  if (op === '==') return a === b || String(a) === String(b);
  if (op === '!=') return !(a === b || String(a) === String(b));
  const x = Number(a);
  const y = Number(b);
  if (Number.isNaN(x) || Number.isNaN(y)) return false;
  switch (op) {
    case '>':
      return x > y;
    case '>=':
      return x >= y;
    case '<':
      return x < y;
    case '<=':
      return x <= y;
    default:
      return false;
  }
}

function scheduleTrue(win, now) {
  if ('cron' in win) return false; // cron unsupported in this slice
  const m = minutesOfDay(now);
  if (win.days && !win.days.includes(dayOfWeek(now))) return false;
  const after = win.after != null ? hhmmToMinutes(win.after) : null;
  const before = win.before != null ? hhmmToMinutes(win.before) : null;
  if (after != null && before != null) {
    return after <= before ? m >= after && m < before : m >= after || m < before;
  }
  if (after != null) return m >= after;
  if (before != null) return m < before;
  return true;
}

function refsOf(node, acc = new Set()) {
  switch (node.op) {
    case 'and':
    case 'or':
      node.nodes.forEach((n) => refsOf(n, acc));
      break;
    case 'not':
      refsOf(node.node, acc);
      break;
    case 'sustained':
      refsOf(node.node, acc);
      break;
    case 'changed':
    case 'delta':
      acc.add(node.input.input);
      break;
    case 'schedule':
      break;
    default:
      acc.add(node.left.input);
  }
  return acc;
}

export function nodeTrueAt(node, t, ctx) {
  switch (node.op) {
    case 'and':
      return node.nodes.every((n) => nodeTrueAt(n, t, ctx));
    case 'or':
      return node.nodes.some((n) => nodeTrueAt(n, t, ctx));
    case 'not':
      return !nodeTrueAt(node.node, t, ctx);
    case 'schedule':
      return scheduleTrue(node.window, t);
    case 'changed': {
      const w = parseDuration(node.window);
      return ctx.store.transitionsSince(node.input.input, t - w).some((ts) => ts <= t);
    }
    case 'delta': {
      const w = parseDuration(node.window);
      const rows = ctx.store.history(node.input.input, t - w, t).map((r) => Number(r.value));
      if (rows.length < 2) return false;
      return Math.abs(rows[rows.length - 1] - rows[0]) >= node.threshold;
    }
    case 'sustained': {
      const since = trueSince(node.node, t, ctx);
      return since != null && t - since >= parseDuration(node.for);
    }
    default: {
      const ref = node.left;
      const v =
        !ref.agg || ref.agg === 'latest'
          ? ctx.store.valueAsOf(ref.input, t)
          : ctx.store.agg(ref.input, ref.agg, ref.window ?? '0s', t);
      if (node.op === '==' || node.op === '!=') return cmp(node.op, v, node.right);
      return v == null ? false : cmp(node.op, v, node.right);
    }
  }
}

export function trueSince(node, now, ctx) {
  if (!nodeTrueAt(node, now, ctx)) return null;
  const inputs = [...refsOf(node)];
  const times = new Set();
  for (const inp of inputs) for (const ts of ctx.store.transitionsSince(inp, 0)) if (ts <= now) times.add(ts);
  const sorted = [...times].sort((a, b) => b - a); // newest first
  let since = now;
  for (const t of sorted) {
    if (nodeTrueAt(node, t, ctx)) since = t;
    else break;
  }
  return since;
}

export function evaluate(node, ctx) {
  if (node.op === 'sustained') {
    const since = trueSince(node.node, ctx.now, ctx);
    return { value: since != null && ctx.now - since >= parseDuration(node.for), trueSince: since };
  }
  return { value: nodeTrueAt(node, ctx.now, ctx) };
}
