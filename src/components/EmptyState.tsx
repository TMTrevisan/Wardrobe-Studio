'use client';

import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: string;
  title: string;
  description?: string;
  action?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * Consistent "nothing here yet" UI. Used across every tab that can
 * render an empty list. Encourages an emoji + a one-line title +
 * optional description + optional CTA.
 */
export default function EmptyState({
  icon = '🪡',
  title,
  description,
  action,
  size = 'md',
}: EmptyStateProps) {
  const padding = size === 'sm' ? 'py-6' : size === 'lg' ? 'py-16' : 'py-12';
  const iconSize = size === 'sm' ? 'text-2xl' : size === 'lg' ? 'text-5xl' : 'text-3xl';
  const titleSize = size === 'sm' ? 'text-xs' : 'text-sm';

  return (
    <div className={`text-center ${padding} text-[var(--text-secondary)]`}>
      <span className={iconSize} aria-hidden="true">
        {icon}
      </span>
      <p className={`mt-2 ${titleSize} font-bold`}>{title}</p>
      {description && <p className="mt-1 text-[10px] max-w-sm mx-auto leading-relaxed">{description}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}