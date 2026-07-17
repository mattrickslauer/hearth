/**
 * Shared dashboard navigation + overlay types.
 *
 * Lives outside `app/` so expo-router doesn't mistake it for a route, and outside `dashboard.tsx`
 * so the extracted hooks (`use-watch-authoring`, `use-hub-claim`) can reference the same types
 * without importing the screen back (which would be circular).
 */

export const TAB_KEYS = ['home', 'sensors', 'watches', 'activity', 'billing', 'settings'] as const;
export type TabKey = (typeof TAB_KEYS)[number];
export const isTabKey = (v: unknown): v is TabKey => TAB_KEYS.includes(v as TabKey);

/**
 * Which overlay is on top, if any. One slot rather than a boolean per sheet: only one thing can
 * own the z-axis at a time, and saying so in the type makes the alternative unrepresentable.
 */
export type SheetState =
  | { kind: 'none' }
  | { kind: 'describe' }
  | { kind: 'suggest' }
  | { kind: 'connectHub' }
  | { kind: 'hub'; id: string }
  | { kind: 'sensor'; id: string }
  | { kind: 'camera'; id: string }
  | { kind: 'hubCamera' }
  | { kind: 'watch'; id: string }
  | { kind: 'editWatch'; id: string }
  | { kind: 'tune'; id: string };
