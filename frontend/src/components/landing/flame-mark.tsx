import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { EmberGradient } from '@/constants/theme';

/**
 * The Hearth mark — an ember flame filled with the ember gradient.
 * Flame outline is the MIT-licensed Lucide "flame" glyph, filled rather than
 * stroked so it reads as a solid, warm logo at any size.
 */
export function FlameMark({ size = 28 }: { size?: number }) {
  const id = 'hearthFlame';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Defs>
        <LinearGradient id={id} x1="6" y1="2" x2="18" y2="22" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={EmberGradient[0]} />
          <Stop offset="0.55" stopColor={EmberGradient[1]} />
          <Stop offset="1" stopColor={EmberGradient[2]} />
        </LinearGradient>
      </Defs>
      <Path
        d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"
        fill={`url(#${id})`}
      />
    </Svg>
  );
}
