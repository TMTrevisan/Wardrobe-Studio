'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';

/**
 * A small accessible Dialog primitive — focus trap, Esc-to-close,
 * click-outside-to-close, restore-focus-on-close. Styled to match the
 * "Atelier" warm-beige aesthetic.
 *
 * Usage:
 *   <Dialog open={open} onClose={() => setOpen(false)} title="Edit Garment">
 *     ...modal body...
 *   </Dialog>
 *
 *   <ConfirmDialog
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onConfirm={handleDelete}
 *     title="Delete garment?"
 *     description="This will permanently remove the item and all its images."
 *     confirmLabel="Delete"
 *     destructive
 *   />
 */

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  /** Max-width Tailwind class, defaults to `max-w-lg`. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Render an explicit footer below the body. */
  footer?: React.ReactNode;
}

const sizeClass = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
} as const;

export function Dialog({ open, onClose, title, description, children, size = 'md', footer }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousActiveRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousActiveRef.current = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    // Focus the dialog on open so screen readers announce it.
    const id = requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      document.body.style.overflow = prevOverflow;
      previousActiveRef.current?.focus?.();
    };
  }, [open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        // Focus trap
        const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (!focusables || focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'dialog-title' : undefined}
      aria-describedby={description ? 'dialog-description' : undefined}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-[fadeIn_120ms_ease-out]"
      onKeyDown={handleKeyDown}
      onClick={(e) => {
        // Click on backdrop closes; click on panel does not.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`relative w-full ${sizeClass[size]} bg-white border border-[#EAE5D9] rounded-3xl shadow-2xl shadow-stone-300/40 max-h-[90vh] overflow-hidden flex flex-col outline-none`}
      >
        {(title || description) && (
          <header className="px-6 pt-6 pb-4 border-b border-[#EAE5D9]">
            {title && (
              <h2 id="dialog-title" className="text-base font-extrabold text-[var(--text-primary)] tracking-tight">
                {title}
              </h2>
            )}
            {description && (
              <p id="dialog-description" className="mt-1 text-xs text-[var(--text-secondary)] font-semibold leading-relaxed">
                {description}
              </p>
            )}
          </header>
        )}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && (
          <footer className="px-6 py-4 border-t border-[#EAE5D9] bg-[#FAF8F5] flex justify-end gap-2">
            {footer}
          </footer>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="absolute top-4 right-4 w-7 h-7 rounded-full flex items-center justify-center text-[var(--text-secondary)] hover:bg-[#FAF8F5] transition"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  loading,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  const handleConfirm = async () => {
    if (busy || loading) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className={`px-4 py-2 text-xs font-extrabold uppercase tracking-wider text-white rounded-xl transition active:scale-[0.98] shadow-md disabled:opacity-50 ${
              destructive
                ? 'bg-rose-600 hover:bg-rose-700'
                : 'bg-[var(--accent-terracotta)] hover:bg-[var(--accent-terracotta)]/90'
            }`}
          >
            {busy || loading ? 'Working...' : confirmLabel}
          </button>
        </>
      }
    />
  );
}