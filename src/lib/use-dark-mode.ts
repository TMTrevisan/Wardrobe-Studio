'use client';

import { useEffect, useState } from 'react';

const STORAGE_KEY = 'atelier-dark-mode';
const DARK_CLASS = 'dark';

export type ThemeMode = 'light' | 'dark' | 'system';

/**
 * Read the current effective mode (resolves 'system' to whatever
 * the OS prefers). Used for displaying the toggle state.
 */
export function getEffectiveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

/**
 * Apply `dark` class to <html> based on the chosen mode. Idempotent.
 */
function applyToDocument(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const effective = getEffectiveMode(mode);
  document.documentElement.classList.toggle(DARK_CLASS, effective === 'dark');
}

/**
 * Persisted dark mode hook. Three modes: 'light', 'dark', 'system'.
 * - 'system' follows the OS preference and updates live if the user
 *   changes their OS setting.
 * - The chosen mode is saved to localStorage and restored on next load.
 * - SSR-safe: the first render returns the persisted choice, the
 *   useEffect then applies the class to <html>.
 */
export function useDarkMode(): [ThemeMode, (m: ThemeMode) => void] {
  const [mode, setModeState] = useState<ThemeMode>('light');

  // Load persisted choice on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') {
      setModeState(stored);
    } else {
      setModeState('system');
    }
  }, []);

  // Apply class to <html> whenever the mode changes.
  useEffect(() => {
    applyToDocument(mode);
  }, [mode]);

  // Persist + apply.
  const setMode = (m: ThemeMode) => {
    setModeState(m);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, m);
    }
  };

  // Follow OS preference when in 'system' mode.
  useEffect(() => {
    if (mode !== 'system' || typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyToDocument('system');
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [mode]);

  return [mode, setMode];
}