'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from './Dialog';

/**
 * Tiny non-blocking toast system + a `confirm()`-style helper that uses
 * the custom `<ConfirmDialog>`. Drop `<Toaster />` once at the top of the
 * tree, then call `useToasts()` and `useConfirm()` from anywhere.
 *
 * Designed to replace `alert()` / `confirm()` throughout the app without
 * needing to convert every callsite to a stateful Dialog. The eventual
 * refactor (#6) can swap each `notify.error(...)` for a more tailored
 * UI element without changing the call shape.
 */

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  success: (msg: string) => void;
  error: (msg: string) => void;
  info: (msg: string) => void;
}

interface ConfirmApi {
  confirm: (opts: {
    title: React.ReactNode;
    description?: React.ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
}

const ToastCtx = createContext<ToastApi | null>(null);
const ConfirmCtx = createContext<ConfirmApi | null>(null);

export function useToasts(): ToastApi {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error('useToasts() must be used within <Toaster />');
  return ctx;
}

export function useConfirmAction(): ConfirmApi['confirm'] {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error('useConfirmAction() must be used within <Toaster />');
  return ctx.confirm;
}

interface PendingConfirm {
  resolve: (v: boolean) => void;
  opts: Parameters<ConfirmApi['confirm']>[0];
}

let nextToastId = 1;

export function Toaster({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, kind, message }]);
  }, []);

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  const confirmApi: ConfirmApi = {
    confirm: (opts) =>
      new Promise<boolean>((resolve) => {
        setPending({ resolve, opts });
      }),
  };

  // Auto-dismiss toasts.
  useEffect(() => {
    if (toasts.length === 0) return;
    const timers = toasts.map((t) =>
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 4000)
    );
    return () => timers.forEach(clearTimeout);
  }, [toasts]);

  const kindStyles: Record<ToastKind, string> = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    error: 'bg-rose-50 border-rose-200 text-rose-700',
    info: 'bg-stone-50 border-stone-200 text-stone-700',
  };
  const kindIcon: Record<ToastKind, string> = {
    success: '✓',
    error: '⚠',
    info: 'ℹ',
  };

  return (
    <ToastCtx.Provider value={api}>
      <ConfirmCtx.Provider value={confirmApi}>
        {children}

        {/* Toast stack — bottom-right. */}
        <div
          aria-live="polite"
          aria-atomic="true"
          className="fixed bottom-4 right-4 z-[60] flex flex-col gap-2 max-w-sm"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              className={`animate-toast-in flex items-start gap-3 px-4 py-3 rounded-2xl border shadow-md text-xs font-bold leading-snug ${kindStyles[t.kind]}`}
            >
              <span aria-hidden="true">{kindIcon[t.kind]}</span>
              <span className="flex-1">{t.message}</span>
              <button
                type="button"
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                aria-label="Dismiss notification"
                className="opacity-60 hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        {/* Single ConfirmDialog instance reused for all prompts. */}
        <ConfirmDialog
          open={!!pending}
          onClose={() => {
            pending?.resolve(false);
            setPending(null);
          }}
          onConfirm={async () => {
            pending?.resolve(true);
            setPending(null);
          }}
          title={pending?.opts.title ?? ''}
          description={pending?.opts.description}
          confirmLabel={pending?.opts.confirmLabel}
          cancelLabel={pending?.opts.cancelLabel}
          destructive={pending?.opts.destructive}
        />
      </ConfirmCtx.Provider>
    </ToastCtx.Provider>
  );
}