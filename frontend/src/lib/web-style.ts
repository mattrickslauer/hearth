/**
 * Web-only style shims, named once.
 *
 * `webNoOutline` drops the browser's focus ring on our custom TextInputs (native has no such
 * outline). `webFullHeight` gives a scroll frame a bounded height on web so a ScrollView actually
 * scrolls — native takes its height from flex. Both are null off web, so they no-op in a style array.
 */

import { Platform } from 'react-native';

export const webNoOutline = Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null;
export const webFullHeight = Platform.OS === 'web' ? ({ height: '100vh' } as object) : null;
