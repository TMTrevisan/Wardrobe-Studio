'use client';

import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Big emoji or icon shown to the left. */
  icon?: string;
  title: string;
  /** One-line description shown under the title. */
  description?: string;
  /** Right-side slot for actions (filters, buttons, etc). */
  actions?: ReactNode;
  /** Optional small badge shown next to the title (e.g. count, version). */
  badge?: string;
}

/**
 * Consistent page header used at the top of every tab. Replaces the
 * 5+ ad-hoc `<h2>` + paragraph patterns scattered across page.tsx.
 */
export default function PageHeader({ icon, title, description, actions, badge }: PageHeaderProps) {
  return (
    <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-4 border-b border-[#EAE5D9]">
      <div>
        <h2 className="text-xl md:text-2xl font-extrabold text-[var(--text-primary)] tracking-tight flex items-center gap-2">
          {icon && <span aria-hidden="true">{icon}</span>}
          <span>{title}</span>
          {badge && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-[var(--accent-terracotta)]/10 text-[var(--accent-terracotta)]">
              {badge}
            </span>
          )}
        </h2>
        {description && (
          <p className="mt-1 text-xs text-[var(--text-secondary)] font-semibold max-w-2xl leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">{actions}</div>}
    </header>
  );
}