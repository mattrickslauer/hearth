/**
 * Session-token persistence. Web uses localStorage (the demo is web-first); native
 * falls back to in-memory for now (survives navigation, not an app restart) — swap
 * in expo-secure-store when hardening the native build.
 */

import { Platform } from 'react-native';

const KEY = 'hearth.session';
let memory: string | null = null;

const hasLocalStorage = Platform.OS === 'web' && typeof globalThis !== 'undefined' && 'localStorage' in globalThis;

export function saveToken(token: string): void {
  memory = token;
  if (hasLocalStorage) {
    try {
      globalThis.localStorage.setItem(KEY, token);
    } catch {
      /* private mode / quota — memory still holds it for the session */
    }
  }
}

export function loadToken(): string | null {
  if (hasLocalStorage) {
    try {
      return globalThis.localStorage.getItem(KEY) ?? memory;
    } catch {
      return memory;
    }
  }
  return memory;
}

export function clearToken(): void {
  memory = null;
  if (hasLocalStorage) {
    try {
      globalThis.localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
  }
}
