/**
 * Walk a predicate tree and collect every inputId it references.
 *
 * Shared by qwen.ts (grounding check on a compiled spec) and vision-watch.ts (hydrate only the
 * series a gate reads). Both walk the same node shape — a comparison carries `left.input`, a
 * function/aggregate carries `input.input`, and composites nest under `nodes[]` or `node` — so
 * there is one walker rather than two that must be kept in step.
 */
export function predicateInputs(root: unknown): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    const o = n as Record<string, unknown>;
    const left = o.left as { input?: string } | undefined;
    const inp = o.input as { input?: string } | undefined;
    if (left?.input) out.push(left.input);
    if (inp?.input) out.push(inp.input);
    if (Array.isArray(o.nodes)) o.nodes.forEach(walk);
    if (o.node) walk(o.node);
  };
  walk(root);
  return out;
}
