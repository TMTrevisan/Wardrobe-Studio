'use client';

import { useDarkMode, type ThemeMode } from '@/lib/use-dark-mode';

const CYCLE: ThemeMode[] = ['light', 'dark', 'system'];

const ICON: Record<ThemeMode, string> = {
  light: '☀️',
  dark: '🌙',
  system: '🖥️',
};

const LABEL: Record<ThemeMode, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

/**
 * Three-state toggle: Light → Dark → System → Light…
 * Shows the current effective icon (☀️/🌙/🖥️).
 */
export default function DarkModeToggle() {
  const [mode, setMode] = useDarkMode();

  const next = CYCLE[(CYCLE.indexOf(mode) + 1) % CYCLE.length];

  return (
    <button
      type="button"
      onClick={() => setMode(next)}
      title={`Theme: ${LABEL[mode]} (click for ${LABEL[next]})`}
      aria-label={`Theme: ${LABEL[mode]}. Switch to ${LABEL[next]}.`}
      className="w-8 h-8 rounded-full border border-[#EAE5D9] dark:border-[#3A3530] bg-white dark:bg-[#2A2620] text-base flex items-center justify-center hover:border-[var(--accent-terracotta)]/40 transition active:scale-90"
    >
      <span aria-hidden="true">{ICON[mode]}</span>
    </button>
  );
}