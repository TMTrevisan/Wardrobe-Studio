'use client';

import { useState, useMemo, useEffect } from 'react';
import type { Garment, WearLog } from '@/types/db';
import { getItemWornCount, getItemCostPerWear } from '@/lib/garment-utils';
import { garmentsToCsv, downloadCsv } from '@/lib/csv';
import EmptyState from './EmptyState';
import LoadingSkeleton from './LoadingSkeleton';

interface ClosetItemsTabProps {
  items: Garment[];
  wearLogs: WearLog[];
  onEdit: (item: Garment) => void;
  /** Toast helpers. */
  notify: {
    success: (msg: string) => void;
    error: (msg: string) => void;
    info: (msg: string) => void;
  };
  /** Modal confirm — returns true if user confirms. */
  confirmAction: (opts: {
    title: React.ReactNode;
    description?: React.ReactNode;
    confirmLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;
}

/**
 * Closet tab → "Garments" sub-tab. Shows filters + grid/matrix views +
 * bulk actions. The grid view is the polaroid layout; matrix view is
 * the dense editable spreadsheet.
 *
 * Owns its own state (filters, view mode, selection, inline edits) so
 * the parent doesn't carry 8 useState hooks + 8 handlers for a sub-view.
 */
export default function ClosetItemsTab({ items, wearLogs, onEdit, notify, confirmAction }: ClosetItemsTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [colorFilter, setColorFilter] = useState('All');
  const [subcategoryFilter, setSubcategoryFilter] = useState('All');
  const [viewMode, setViewMode] = useState<'grid' | 'matrix'>('grid');
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [editedItems, setEditedItems] = useState<Record<string, Partial<Garment>>>({});
  const [gridColumns, setGridColumns] = useState<1 | 2 | 3 | 4>(3);
  const [orphanPanelOpen, setOrphanPanelOpen] = useState(false);
  const [orphans, setOrphans] = useState<Array<{ path: string; publicUrl: string; suggestedGarmentId: string | null; fileName: string }>>([]);
  const [orphanTarget, setOrphanTarget] = useState<Record<string, string>>({});

  const loadOrphans = async () => {
    try {
      const res = await fetch('/api/items/repair-orphan-images');
      const data = await res.json();
      const payload = data.data ?? data;
      setOrphans(payload.orphans || []);
    } catch (err) {
      console.error('Failed to load orphans', err);
    }
  };

  useEffect(() => {
    if (orphanPanelOpen) loadOrphans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orphanPanelOpen]);

  const attachOrphan = async (orphanPath: string) => {
    const garmentId = orphanTarget[orphanPath];
    if (!garmentId) {
      notify.error('Pick a garment first.');
      return;
    }
    try {
      const res = await fetch('/api/items/repair-orphan-images/attach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orphanPath, garmentId, assetType: 'detail' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attach failed.');
      notify.success('Image attached. Re-classify the garment to incorporate the new photo.');
      setOrphans((prev) => prev.filter((o) => o.path !== orphanPath));
    } catch (err: any) {
      notify.error(`Attach failed: ${err.message}`);
    }
  };

  // Filter logic with the UI-specific category synonym map.
  const filteredItems = useMemo(() => {
    const search = searchQuery.toLowerCase().trim();
    return items.filter((item) => {
      if (statusFilter !== 'All' && item.status !== statusFilter) return false;
      if (colorFilter !== 'All' && item.color_family !== colorFilter) return false;
      if (subcategoryFilter !== 'All' && item.sub_category !== subcategoryFilter) return false;

      if (categoryFilter !== 'All') {
        const cat = categoryFilter.toLowerCase();
        const iCat = item.category.toLowerCase();
        const iSub = (item.sub_category || '').toLowerCase();
        const iStyle = (item.style_detail || '').toLowerCase();

        if (['tops', 'bottoms', 'outerwear', 'footwear', 'tailoring'].includes(cat)) {
          if (iCat !== cat) return false;
        } else if (cat === 'shoe') {
          if (iCat !== 'footwear') return false;
        } else if (cat === 'bottom shorts') {
          if (!(iCat === 'bottoms' && iSub.includes('short'))) return false;
        } else if (cat === 'top long sleeve' || cat === 'long sleeve') {
          if (!(iCat === 'tops' && (iSub.includes('long sleeve') || iStyle.includes('long sleeve')))) return false;
        } else if (cat === 'top outer layer' || cat === 'outer layer') {
          if (!(iCat === 'outerwear' || (iCat === 'tops' && (iStyle.includes('outer') || iStyle.includes('layer'))))) return false;
        } else if (cat === 'top short sleeve' || cat === 'short sleeve') {
          if (!(iCat === 'tops' && (iSub.includes('short sleeve') || iStyle.includes('short sleeve')))) return false;
        }
      }

      if (search) {
        const hay = `${item.brand ?? ''} ${item.sub_category} ${item.color_family} ${item.notes ?? ''} ${item.fabric_type ?? ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }

      return true;
    });
  }, [items, searchQuery, categoryFilter, statusFilter, colorFilter, subcategoryFilter]);

  const handleSelectItem = (id: string) => {
    setSelectedItemIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleSelectAllItems = () => {
    if (selectedItemIds.length === filteredItems.length && filteredItems.length > 0) {
      setSelectedItemIds([]);
    } else {
      setSelectedItemIds(filteredItems.map((item) => item.id));
    }
  };

  const handleSpreadsheetFieldChange = (id: string, field: string, value: any) => {
    setEditedItems((prev) => ({
      ...prev,
      [id]: { ...prev[id], [field]: value },
    }));
  };

  const handleSaveSpreadsheetRow = async (id: string) => {
    const changes = editedItems[id];
    if (!changes) return;
    try {
      const res = await fetch('/api/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...changes }),
      });
      if (res.ok) {
        setEditedItems((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        notify.success('Saved.');
      } else {
        notify.error('Failed to save changes.');
      }
    } catch (err: any) {
      notify.error(`Save error: ${err.message}`);
    }
  };

  const handleDeleteSpreadsheetRow = async (id: string) => {
    const ok = await confirmAction({
      title: 'Delete this garment?',
      description: 'This permanently removes the item and all its images. Saved outfits that reference it will be cleaned up automatically.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/items?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        notify.success('Garment deleted.');
        // The parent will refetch via setItems; we just need to clear local state.
        setEditedItems((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
        setSelectedItemIds((prev) => prev.filter((x) => x !== id));
      } else {
        const data = await res.json().catch(() => ({}));
        notify.error(`Failed to delete item: ${data.error || res.statusText}`);
      }
    } catch (err: any) {
      notify.error(`Delete error: ${err.message}`);
    }
  };

  const handleBulkChangeStatus = async (status: Garment['status']) => {
    if (selectedItemIds.length === 0) return;
    try {
      // PATCH each one (could be a bulk endpoint; left as PATCH for now).
      for (const id of selectedItemIds) {
        await fetch('/api/items', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, status }),
        });
      }
      notify.success(`Updated ${selectedItemIds.length} items.`);
      setSelectedItemIds([]);
    } catch (err: any) {
      notify.error(`Bulk update failed: ${err.message}`);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedItemIds.length === 0) return;
    const ok = await confirmAction({
      title: `Delete ${selectedItemIds.length} garments?`,
      description: 'This is permanent. Saved outfits referencing these items will be cleaned up automatically.',
      confirmLabel: `Delete ${selectedItemIds.length}`,
      destructive: true,
    });
    if (!ok) return;
    try {
      for (const id of selectedItemIds) {
        await fetch(`/api/items?id=${id}`, { method: 'DELETE' });
      }
      notify.success(`Deleted ${selectedItemIds.length} items.`);
      setSelectedItemIds([]);
    } catch (err: any) {
      notify.error(`Bulk delete failed: ${err.message}`);
    }
  };

  const handleBulkReprocess = async () => {
    if (selectedItemIds.length === 0) return;
    const ok = await confirmAction({
      title: `Re-classify ${selectedItemIds.length} garments with AI?`,
      description: `This will re-run Gemini on the primary photo of each selected item (1 API call per item). Use this when tags look wrong — it costs ~${selectedItemIds.length} tokens.`,
      confirmLabel: `Re-classify ${selectedItemIds.length}`,
    });
    if (!ok) return;
    try {
      notify.info(`Re-classifying ${selectedItemIds.length} items…`);
      const res = await fetch('/api/ingest/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: selectedItemIds }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Re-classify failed.');
      }
      notify.success(`Done — ${selectedItemIds.length} items re-classified. Refresh to see new tags.`);
      setSelectedItemIds([]);
    } catch (err: any) {
      notify.error(`Bulk re-classify failed: ${err.message}`);
    }
  };

  /**
   * Re-classify a single item. The server uses ALL garment_images
   * (primary + every detail shot — fabric, tags, sizing labels) when
   * re-running Gemini, so fabric content and brand labels contribute.
   */
  const handleReclassify = async (id: string) => {
    console.log('[ClosetReclassify] start', id);
    notify.info('Re-classifying with AI… (uses all images)');
    try {
      const res = await fetch('/api/ingest/batch-process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Re-classify failed.');
      }
      notify.success('Re-classification complete. Refresh the closet to see updated tags.');
    } catch (err: any) {
      console.error('[ClosetReclassify] error', err);
      notify.error(`Re-classify failed: ${err.message}`);
    }
  };

  const handleExportCSV = () => {
    const csv = garmentsToCsv(items, (id) => getItemWornCount(id, wearLogs));
    downloadCsv(csv, 'threads_wardrobe_export.csv');
  };

  return (
    <div className="space-y-6">
      {/* Filters bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 border border-[#EAE5D9] bg-white rounded-3xl shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">Closet</span>
          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--accent-terracotta)]/10 text-[var(--accent-terracotta)] font-bold">v2.40.0</span>
        </div>
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search items, brands, materials..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[#F5F2EB] text-xs border border-[#EAE5D9] rounded-xl px-4 py-2 text-[var(--text-primary)] placeholder-stone-400 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setSubcategoryFilter('All');
            }}
            className="bg-[#F5F2EB] border border-[#EAE5D9] rounded-xl px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none"
          >
            <option value="All">All Categories</option>
            <option value="Tops">Tops</option>
            <option value="Bottoms">Bottoms</option>
            <option value="Outerwear">Outerwear</option>
            <option value="Footwear">Footwear (Shoe)</option>
            <option value="Tailoring">Tailoring</option>
            <option value="Top Long Sleeve">Tops · Long Sleeve</option>
            <option value="Top Short Sleeve">Tops · Short Sleeve</option>
            <option value="Bottom Shorts">Bottoms · Shorts</option>
            <option value="Top Outer Layer">Tops · Outer Layer</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-[#F5F2EB] border border-[#EAE5D9] rounded-xl px-3 py-1.5 text-xs font-bold text-[var(--text-primary)] focus:outline-none"
          >
            <option value="All">All Status</option>
            <option value="Active">Active</option>
            <option value="Archive">Archive</option>
            <option value="Donate">Donate</option>
            <option value="Discard">Discard</option>
          </select>

          <button
            type="button"
            onClick={handleExportCSV}
            className="text-[10px] font-bold uppercase tracking-wider text-[var(--accent-terracotta)] hover:underline px-2 py-1"
          >
            Export CSV
          </button>

          <div className="h-4 w-[1px] bg-[#EAE5D9]"></div>

          {/* View mode toggle */}
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition ${
              viewMode === 'grid'
                ? 'bg-[var(--accent-terracotta)]/15 text-[var(--accent-terracotta)]'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            ◻ Grid
          </button>
          <button
            type="button"
            onClick={() => setViewMode('matrix')}
            className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-full transition ${
              viewMode === 'matrix'
                ? 'bg-[var(--accent-terracotta)]/15 text-[var(--accent-terracotta)]'
                : 'text-stone-500 hover:text-stone-700'
            }`}
          >
            ☰ Matrix
          </button>
        </div>
      </div>

      {/* Bulk action bar (only when something is selected) */}
      {selectedItemIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 p-3 bg-[var(--accent-terracotta)]/5 border border-[var(--accent-terracotta)]/20 rounded-2xl">
          <span className="text-xs font-bold text-[var(--accent-terracotta)]">
            {selectedItemIds.length} selected
          </span>
          <div className="flex items-center gap-3">
            <select
              onChange={(e) => {
                if (e.target.value) handleBulkChangeStatus(e.target.value as Garment['status']);
                e.target.value = '';
              }}
              defaultValue=""
              className="bg-white border border-[var(--accent-terracotta)]/30 rounded-lg px-2 py-1 text-xs"
            >
              <option value="" disabled>Change status…</option>
              <option value="Active">Active</option>
              <option value="Archive">Archive</option>
              <option value="Donate">Donate</option>
              <option value="Discard">Discard</option>
            </select>
            <button
              type="button"
              onClick={handleBulkReprocess}
              className="text-[var(--accent-apricot)] font-extrabold hover:underline text-xs"
            >
              🔄 Re-classify
            </button>
            <div className="h-4 w-[1px] bg-[var(--accent-terracotta)]/30"></div>
            <button onClick={handleBulkDelete} className="text-rose-600 font-extrabold hover:underline text-xs">
              Delete
            </button>
            <button
              onClick={() => setSelectedItemIds([])}
              className="text-stone-500 hover:text-stone-700 text-xs"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* View: GRID */}
      {viewMode === 'grid' && (
        <>
          {/* Orphan-image repair panel */}
          <details
            open={orphanPanelOpen}
            onToggle={(e) => setOrphanPanelOpen((e.target as HTMLDetailsElement).open)}
            className="bg-amber-50 border border-amber-200 rounded-2xl"
          >
            <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between text-xs font-bold text-amber-900 hover:bg-amber-100/60 rounded-2xl">
              <span>🩹 Repair missing detail images</span>
              <span className="text-amber-700">{orphans.length} orphan{orphans.length === 1 ? '' : 's'} found</span>
            </summary>
            <div className="p-4 space-y-3 border-t border-amber-200">
              <p className="text-[10px] text-amber-800 leading-relaxed">
                These photos exist in your wardrobe storage but aren't linked to any garment (likely from an upload that failed mid-way before the multi-user fix).
                Pick a garment for each and click Attach, then re-classify that garment.
              </p>
              {orphans.length === 0 ? (
                <p className="text-[10px] text-stone-500 italic">No orphans. Your wardrobe is healthy. 🎉</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {orphans.map((orphan) => (
                    <div key={orphan.path} className="bg-white border border-amber-200 rounded-xl p-2 flex items-center gap-3">
                      <img src={orphan.publicUrl} alt="" className="w-14 h-14 object-cover rounded-md shrink-0" />
                      <div className="flex-1 min-w-0 space-y-1.5">
                        <p className="text-[10px] font-mono text-stone-600 truncate" title={orphan.path}>{orphan.fileName}</p>
                        <select
                          value={orphanTarget[orphan.path] || orphan.suggestedGarmentId || ''}
                          onChange={(e) => setOrphanTarget({ ...orphanTarget, [orphan.path]: e.target.value })}
                          className="w-full text-[10px] bg-[#FAF8F5] border border-[#EAE5D9] rounded-md px-2 py-1"
                        >
                          <option value="">— Pick garment —</option>
                          {items.map((it) => (
                            <option key={it.id} value={it.id}>
                              {it.brand || 'No Brand'} · {it.sub_category} ({it.color_family})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => attachOrphan(orphan.path)}
                          disabled={!orphanTarget[orphan.path] && !orphan.suggestedGarmentId}
                          className="w-full px-2 py-1 bg-[var(--accent-terracotta)] text-white text-[10px] font-bold rounded-md hover:bg-[var(--accent-terracotta)]/90 disabled:opacity-40"
                        >
                          Attach to selected
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>

          {filteredItems.length === 0 ? (
            <EmptyState
              icon="🪡"
              title="No garments match your filters yet"
              description="Try clearing a filter or upload new photos from the Snap tab."
            />
          ) : (
            <>
              <div className="flex items-center justify-between text-[10px] text-[var(--text-secondary)] font-bold px-2">
                <span>{filteredItems.length} item{filteredItems.length === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                  <span>Columns</span>
                  {[1, 2, 3, 4].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setGridColumns(n as 1 | 2 | 3 | 4)}
                      className={`w-5 h-5 rounded-full text-[10px] font-bold transition ${
                        gridColumns === n
                          ? 'bg-[var(--accent-terracotta)] text-white'
                          : 'bg-white text-[var(--text-secondary)] border border-[#EAE5D9]'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div
                className="grid gap-5"
                style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
              >
                {filteredItems.map((item) => {
                  const wears = getItemWornCount(item.id, wearLogs);
                  const cpw = getItemCostPerWear(item, wears);
                  return (
                    <div
                      key={item.id}
                      className={`polaroid-frame p-2 group cursor-pointer transition ${
                        selectedItemIds.includes(item.id) ? 'ring-2 ring-[var(--accent-terracotta)]' : ''
                      }`}
                      onClick={() => handleSelectItem(item.id)}
                    >
                      <div className="relative aspect-square w-full overflow-hidden bg-stone-100 rounded-sm">
                        {item.primary_image_url ? (
                          <img src={item.primary_image_url} alt={item.sub_category} className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-stone-300 text-3xl">
                            🧥
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleSelectItem(item.id);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          onTouchStart={(e) => e.stopPropagation()}
                          className={`absolute top-2 left-2 w-8 h-8 rounded-full border-2 flex items-center justify-center text-lg font-black transition shadow-md z-10 ${
                            selectedItemIds.includes(item.id)
                              ? 'bg-[var(--accent-terracotta)] border-[var(--accent-terracotta)] text-white'
                              : 'bg-white/95 border-[#EAE5D9] text-transparent hover:text-[var(--accent-terracotta)]/30 hover:border-[var(--accent-terracotta)]'
                          }`}
                          aria-label={selectedItemIds.includes(item.id) ? `Deselect ${item.sub_category}` : `Select ${item.sub_category}`}
                          title={selectedItemIds.includes(item.id) ? 'Deselect' : 'Select for bulk action'}
                        >
                          ✓
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleReclassify(item.id);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="absolute top-2 right-2 w-8 h-8 rounded-full bg-white/95 border border-[#EAE5D9] text-stone-500 hover:bg-[var(--accent-apricot)] hover:text-[var(--text-primary)] flex items-center justify-center text-xs shadow-md transition z-10"
                          aria-label={`Re-classify ${item.sub_category} with AI`}
                          title="Re-classify with AI (uses all images)"
                        >
                          🔄
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            onEdit(item);
                          }}
                          onMouseDown={(e) => e.stopPropagation()}
                          className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-white/95 border border-[#EAE5D9] text-[var(--accent-terracotta)] hover:bg-[var(--accent-terracotta)] hover:text-white flex items-center justify-center text-sm shadow-md transition z-10"
                          aria-label={`Edit ${item.sub_category}`}
                          title="Open edit modal"
                        >
                          ✏️
                        </button>
                      </div>
                      <div className="px-1 pt-2 pb-1 space-y-0.5">
                        <p className="text-[10px] font-extrabold uppercase tracking-wide text-[var(--text-primary)] truncate">
                          {item.brand || 'No Brand'} · {item.sub_category}
                        </p>
                        <p className="text-[9px] text-[var(--text-secondary)] truncate">
                          {item.color_family} {item.fabric_type ? `· ${item.fabric_type}` : ''}
                        </p>
                        <div className="flex items-center justify-between text-[9px] pt-1">
                          <span className={wears > 0 ? 'text-[var(--accent-sage)] font-bold' : 'text-stone-400'}>
                            {wears > 0 ? `${wears}× worn` : 'Unworn'}
                          </span>
                          {item.price > 0 && <span className="text-stone-500">CPW ${cpw.toFixed(2)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </>
      )}

      {/* View: MATRIX (placeholder — see next refactor commit) */}
      {viewMode === 'matrix' && (
        <div className="text-center py-12 text-[var(--text-secondary)]">
          <p className="text-xs font-bold">Matrix view coming in the next refactor commit.</p>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            className="mt-2 text-[10px] font-bold uppercase text-[var(--accent-terracotta)] hover:underline"
          >
            ← Back to grid
          </button>
        </div>
      )}
    </div>
  );
}