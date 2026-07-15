'use client';

interface LoadingSkeletonProps {
  variant?: 'card' | 'row' | 'block';
  count?: number;
  className?: string;
}

/**
 * Subtle shimmer skeleton used while async data loads. Doesn't try to
 * match the exact final layout (that's brittle); just communicates
 * "something is loading" with a soft pulse.
 */
export default function LoadingSkeleton({
  variant = 'card',
  count = 6,
  className = '',
}: LoadingSkeletonProps) {
  const baseClass =
    'animate-pulse bg-stone-200/70 rounded-2xl border border-stone-200/50';
  const sizeClass =
    variant === 'card'
      ? 'aspect-square'
      : variant === 'row'
      ? 'h-10 w-full rounded-xl'
      : 'h-32 w-full';

  return (
    <div className={className}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={`${baseClass} ${sizeClass} mb-3`} aria-hidden="true" />
      ))}
    </div>
  );
}