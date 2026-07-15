/**
 * Design tokens — TypeScript mirror of the CSS variables in
 * `src/app/globals.css`. Use these when you need to read a token in
 * JS/TS (e.g. for SVG fills, computed styles, tests).
 *
 * For Tailwind classes, prefer the utility form: `bg-[var(--accent-terracotta)]`,
 * `text-[var(--text-primary)]`, etc. These are picked up by the JIT
 * compiler and don't require importing this file.
 */

export const colors = {
  background: '#F9F6F0',
  foreground: '#3A3530',
  bgMain: '#F9F6F0',
  bgSidebar: '#D2C4B1',
  bgCardPrimary: '#FFFFFF',
  bgCardSecondary: '#F3EFE6',
  textPrimary: '#3A3530',
  textSecondary: '#6E655C',
  accentTerracotta: '#C86B55',
  accentSage: '#8FA89B',
  accentApricot: '#EAA97E',
} as const;

export const radii = {
  sm: 'rounded-lg',     // 8px
  md: 'rounded-xl',     // 12px
  lg: 'rounded-2xl',   // 16px
  xl: 'rounded-3xl',   // 24px
  full: 'rounded-full',
} as const;

export const shadows = {
  sm: 'tactile-shadow-sm',
  md: 'tactile-shadow-md',
  lg: 'tactile-shadow-lg',
} as const;

/** Spacing scale used across the app — keep this in sync with Tailwind defaults. */
export const spacing = {
  xs: 'gap-1',
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-4',
  xl: 'gap-6',
  '2xl': 'gap-8',
} as const;

/**
 * Standard pill button classes used in the sidebar / tab nav.
 * One source of truth so all sidebar buttons look identical.
 */
export const sidebarPillBase =
  'flex items-center gap-3 px-4.5 py-3 rounded-full font-bold text-xs uppercase tracking-wider transition-all duration-200 active:scale-95';

export const sidebarPillActive = 'bg-[var(--accent-terracotta)] text-white shadow-md';
export const sidebarPillInactive = 'hover:bg-white/40 text-[var(--text-primary)]';

export const sidebarPillClasses = `${sidebarPillBase} ${sidebarPillActive}`;
export const sidebarPillInactiveClasses = `${sidebarPillBase} ${sidebarPillInactive}`;