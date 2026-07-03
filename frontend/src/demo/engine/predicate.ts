/**
 * The evaluator — interprets a PredicateNode against a ReadingStore + a clock
 * `now`. This is the shared brain of the local runtime: identical logic runs in
 * the browser demo and (ported) on the hub. Pure; no React, no side effects.
 */

import { parseDuration } from './duration';
import { dayOfWeek, hhmmToMinutes, minutesOfDay } from './simtime';
import type { ReadingStore } from './store';
import type { Comparator, InputRef, PredicateNode, Scalar, TimeWindow } from './types';

export interface EvalCtx {
  store: ReadingStore;
  now: number;
}

function cmp(op: Comparator, a: Scalar | null, b: Scalar | null): boolean {
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

function scheduleTrue(win: TimeWindow, now: number): boolean {
  if ('cron' in win) return false; // cron unsupported in the slice
  const m = minutesOfDay(now);
  if (win.days && !win.days.includes(dayOfWeek(now))) return false;
  const after = win.after != null ? hhmmToMinutes(win.after) : null;
  const before = win.before != null ? hhmmToMinutes(win.before) : null;
  if (after != null && before != null) {
    // overnight window (e.g. 19:00→07:00) when after > before
    return after <= before ? m >= after && m < before : m >= after || m < before;
  }
  if (after != null) return m >= after;
  if (before != null) return m < before;
  return true;
}

/** Inputs referenced anywhere in a node (for transition scanning). */
function refsOf(node: PredicateNode, acc = new Set<string>()): Set<string> {
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
      acc.add((node as { left: InputRef }).left.input);
  }
  return acc;
}

/** Truth of a node *as of* time `t` (uses value-as-of; windows resolve to t). */
export function nodeTrueAt(node: PredicateNode, t: number, ctx: EvalCtx): boolean {
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
      // == / != are meaningful against a missing value (e.g. rfid == null);
      // ordering comparisons on missing data are simply false.
      if (node.op === '==' || node.op === '!=') return cmp(node.op, v, node.right);
      return v == null ? false : cmp(node.op, v, node.right);
    }
  }
}

/**
 * The timestamp since which `node` has been continuously true up to `now`, or
 * null if it isn't true now. Walks the referenced inputs' transitions backward
 * (values are step functions, so transitions are the only points truth can flip).
 */
export function trueSince(node: PredicateNode, now: number, ctx: EvalCtx): number | null {
  if (!nodeTrueAt(node, now, ctx)) return null;
  const inputs = [...refsOf(node)];
  const times = new Set<number>();
  for (const inp of inputs) for (const ts of ctx.store.transitionsSince(inp, 0)) if (ts <= now) times.add(ts);
  const sorted = [...times].sort((a, b) => b - a); // newest first
  let since = now;
  for (const t of sorted) {
    if (nodeTrueAt(node, t, ctx)) since = t;
    else break;
  }
  return since;
}

/** Top-level evaluate → boolean answer (+ trueSince for sustained display). */
export function evaluate(node: PredicateNode, ctx: EvalCtx): { value: boolean; trueSince?: number | null } {
  if (node.op === 'sustained') {
    const since = trueSince(node.node, ctx.now, ctx);
    return { value: since != null && ctx.now - since >= parseDuration(node.for), trueSince: since };
  }
  return { value: nodeTrueAt(node, ctx.now, ctx) };
}
