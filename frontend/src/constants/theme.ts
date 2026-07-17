/**
 * Hearth — "warm-precise" design tokens.
 *
 * Home warmth, but the app must read as credible/agentic: calm warm-neutral
 * surfaces, one ember accent, generous whitespace, rounded cards. Light + dark
 * are both first-class. The existing token keys (text, background, …) are kept
 * so the scaffold's themed components continue to work.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    // base surfaces — warm paper, not clinical white
    text: '#1B1510',
    textSecondary: '#6B6157',
    textMuted: '#938979',
    background: '#FBF7F1',
    backgroundElement: '#F3ECE1',
    backgroundSelected: '#EBE1D2',
    card: '#FFFFFF',
    cardElevated: '#FFFFFF',
    border: '#EADFCF',
    borderStrong: '#DECFB8',
    // the one accent — ember
    ember: '#E2531D',
    emberBright: '#FF7A45',
    emberDeep: '#C23E12',
    emberGlow: 'rgba(226,83,29,0.16)',
    onEmber: '#FFFFFF',
    // semantic status (clear / acted / info) + reasoning amber
    success: '#2E9E6B',
    warn: '#D98A16',
    info: '#3E7BD1',
    trace: '#C77A1B',
    codeBg: '#F3ECE1',
  },
  dark: {
    // base surfaces — warm charcoal, a hearth in a dark room
    text: '#F6F0E8',
    textSecondary: '#B0A594',
    textMuted: '#8A8072',
    background: '#12100D',
    backgroundElement: '#1B1815',
    backgroundSelected: '#26221D',
    card: '#1A1714',
    cardElevated: '#221E19',
    border: '#2C2721',
    borderStrong: '#3A342B',
    // the one accent — ember
    ember: '#FF7A45',
    emberBright: '#FF9E64',
    emberDeep: '#E24E1B',
    emberGlow: 'rgba(255,122,69,0.18)',
    onEmber: '#160B05',
    // semantic status
    success: '#5FC08C',
    warn: '#F0B054',
    info: '#6FA8E8',
    trace: '#F0AE55',
    codeBg: '#100E0B',
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

/** Ember gradient stops — the same fire in both schemes. */
export const EmberGradient = ['#FFB067', '#FF7A45', '#E24E1B'] as const;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const Radius = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 30,
  pill: 999,
} as const;

export const MaxContentWidth = 1120;

/**
 * The z-axis, named once. Every layer of app chrome draws from this scale rather than
 * inventing a local zIndex, so "what covers what" is decided here and nowhere else.
 * Content sits at the bottom; chrome floats over it; a sheet covers everything but a toast.
 */
export const Layer = {
  base: 0,
  raised: 10, // sticky top bar over scrolling content
  nav: 20, // bottom tab bar (mobile) / side rail (desktop)
  fab: 30, // the floating primary action
  scrim: 40, // the dimmer that makes a sheet modal
  sheet: 50, // slide-up sheet / centered dialog
  toast: 60, // transient messages, above even a sheet
} as const;
