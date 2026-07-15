'use client';

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  group: 'Navigate' | 'Garments' | 'Actions';
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  actions: PaletteAction[];
}

/**
 * Cmd/Ctrl+K command palette. Modal search box that filters actions
 * by label + hint, navigates with arrow keys, executes with Enter.
 *
 * Opens when `open` flips to true; closes on Escape, click outside,
 * or after running an action.
 */
export default function CommandPalette({ open, onClose, actions }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Filter.
  const filtered = useMemo(() => {
    if (!Array.isArray(actions)) return [];
    const q = (query || '').toLowerCase().trim();
    if (!q) return actions;
    return actions.filter((a) => {
      const label = (a?.label ?? '').toLowerCase();
      const hint = (a?.hint ?? '').toLowerCase();
      return label.includes(q) || hint.includes(q);
    });
  }, [actions, query]);

  // Reset highlight when filter changes.
  useEffect(() => {
    setHighlight(0);
  }, [query]);

  // Reset state when opening.
  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
    }
  }, [open]);

  // Clamp highlight index to filtered range.
  useEffect(() => {
    if (highlight >= filtered.length) setHighlight(0);
  }, [filtered.length, highlight]);

  // Scroll highlighted into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, open]);

  // Focus input when opening (after modal renders).
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [open]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.max(0, Math.min(filtered.length - 1, h + 1)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(0, h - 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const action = filtered[highlight];
        if (action && typeof action.run === 'function') {
          action.run();
          onClose();
        }
      }
    },
    [filtered, highlight, onClose]
  );

  if (!open) return null;

  // Group filtered items by group label.
  const groups: Record<string, PaletteAction[]> = {};
  for (const a of filtered) {
    const g = a?.group ?? 'Other';
    (groups[g] ||= []).push(a);
  }
  const groupKeys = Object.keys(groups);

  // Flatten with cumulative index for keyboard nav + scroll-into-view.
  const flat: PaletteAction[] = [];
  for (const g of groupKeys) {
    for (const a of groups[g]) flat.push(a);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] px-4 bg-black/40 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={onKeyDown}
    >
      <div className="w-full max-w-xl bg-[var(--bg-card-primary)] border border-[#EAE5D9] dark:border-[#3A3530] rounded-2xl shadow-2xl shadow-stone-300/60 overflow-hidden">
        {/* Search input */}
        <div className="px-4 py-3 border-b border-[#EAE5D9] dark:border-[#3A3530] flex items-center gap-2">
          <span className="text-stone-400" aria-hidden="true">🔎</span>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or search garments…"
            className="flex-1 bg-transparent text-sm text-[var(--text-primary)] placeholder-stone-400 focus:outline-none"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden md:inline-block text-[9px] font-bold text-stone-500 bg-stone-100 border border-stone-200 px-1.5 py-0.5 rounded">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto p-1">
          {flat.length === 0 ? (
            <div className="p-8 text-center text-xs text-stone-400">
              No commands match <span className="font-mono text-stone-600">"{query}"</span>
            </div>
          ) : (
            groupKeys.map((group) => (
              <div key={group}>
                <div className="px-3 pt-2 pb-1 text-[9px] uppercase font-black tracking-wider text-stone-400">
                  {group}
                </div>
                {groups[group].map((a) => {
                  const idx = flat.indexOf(a);
                  const isActive = idx === highlight;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      data-idx={idx}
                      onClick={() => {
                        if (a && typeof a.run === 'function') {
                          a.run();
                          onClose();
                        }
                      }}
                      onMouseEnter={() => setHighlight(Math.max(0, idx))}
                      className={`w-full text-left px-3 py-2 rounded-xl flex items-center gap-3 transition ${
                        isActive ? 'bg-[var(--accent-terracotta)]/10' : 'hover:bg-stone-50 dark:hover:bg-[#2A2620]'
                      }`}
                    >
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm font-bold text-[var(--text-primary)] truncate">
                          {a.label}
                        </span>
                        {a.hint && (
                          <span className="block text-[10px] text-stone-500 truncate">{a.hint}</span>
                        )}
                      </span>
                      {a.shortcut && (
                        <kbd className="text-[9px] font-bold text-stone-500 bg-white dark:bg-[#2A2620] border border-stone-200 dark:border-[#3A3530] px-1.5 py-0.5 rounded">
                          {a.shortcut}
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-2 border-t border-[#EAE5D9] dark:border-[#3A3530] bg-[#FAF8F5] dark:bg-[#1F1D18] flex items-center gap-3 text-[9px] text-stone-500">
          <span><kbd className="font-bold">↑</kbd><kbd className="font-bold">↓</kbd> navigate</span>
          <span><kbd className="font-bold">↵</kbd> select</span>
          <span><kbd className="font-bold">ESC</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

/** Hook to wire the Cmd/Ctrl+K listener into a parent. */
export function useCommandPaletteShortcut(
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setOpen]);
}