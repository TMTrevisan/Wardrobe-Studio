'use client';

import { useRef, useState } from 'react';
import type { Garment, WearLog } from '@/types/db';

interface EditModalProps {
  garment: Garment;
  wearLogs: WearLog[];

  // Shared image-search state — owned by parent because the validation
  // modal (which still lives in page.tsx) also writes to these fields.
  searchQueryText: string;
  setSearchQueryText: (s: string) => void;
  searchResults: any[] | null;
  setSearchResults: (r: any[] | null) => void;
  isSearchingImage: boolean;
  setIsSearchingImage: (b: boolean) => void;
  isReplacingImage: boolean;
  setIsReplacingImage: (b: boolean) => void;

  onClose: () => void;
  onSaved: (g: Garment) => void;
  notify: {
    success: (m: string) => void;
    error: (m: string) => void;
    info: (m: string) => void;
  };
  confirmAction: (opts: {
    title: React.ReactNode;
    description?: React.ReactNode;
    confirmLabel?: string;
    destructive?: boolean;
  }) => Promise<boolean>;

  // Optional callbacks.
  onReclassify?: (id: string) => void | Promise<void>;
  onBuildOutfitAround?: (g: Garment) => void;
  onMergeGarment?: (sourceId: string, targetId: string) => void | Promise<void>;
}

/**
 * Self-contained edit modal for a single garment.
 *
 * Owns its UI state (uploading/saving flags, merge target, file input ref)
 * but defers image-search state to the parent because the validation
 * modal also writes to the same fields.
 */
export default function EditModal({
  garment,
  wearLogs,
  searchQueryText,
  setSearchQueryText,
  searchResults,
  setSearchResults,
  isSearchingImage,
  setIsSearchingImage,
  isReplacingImage,
  setIsReplacingImage,
  onClose,
  onSaved,
  notify,
  confirmAction,
  onReclassify,
  onBuildOutfitAround,
  onMergeGarment,
}: EditModalProps) {
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [mergeTargetGarmentId, setMergeTargetGarmentId] = useState('');
  const [isMergingGarments, setIsMergingGarments] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const uploadImageToGarment = async (file: File) => {
    setIsUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('garmentId', garment.id);
      formData.append('file', file);
      const res = await fetch('/api/items/add-image', { method: 'POST', body: formData });
      const data = await res.json();
      const payload = data.data ?? data;
      if (res.ok) {
        onSaved({ ...garment, images: payload.images });
        notify.success('Image uploaded');
      } else {
        notify.error(`Upload failed: ${data.error ?? 'Unknown'}`);
      }
    } catch (err: any) {
      notify.error(`Error uploading image: ${err.message}`);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const setPrimaryImage = async (imageId: string) => {
    setIsUploadingImage(true);
    try {
      const res = await fetch('/api/items/set-primary-image', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId: garment.id, imageId }),
      });
      const data = await res.json();
      const payload = data.data ?? data;
      if (res.ok) {
        const primaryUrl =
          payload.images.find((i: any) => i.is_primary_profile)?.storage_path ??
          garment.primary_image_url;
        onSaved({ ...garment, images: payload.images, primary_image_url: primaryUrl });
        notify.success('Primary image updated');
      } else {
        notify.error(`Failed: ${data.error ?? 'Unknown'}`);
      }
    } catch (err: any) {
      notify.error(`Error: ${err.message}`);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const deleteGarmentImage = async (imageId: string) => {
    setIsUploadingImage(true);
    try {
      const res = await fetch('/api/items/delete-image', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId: garment.id, imageId }),
      });
      const data = await res.json();
      const payload = data.data ?? data;
      if (res.ok) {
        onSaved({ ...garment, images: payload.images });
        notify.success('Image deleted');
      } else {
        notify.error(`Failed: ${data.error ?? 'Unknown'}`);
      }
    } catch (err: any) {
      notify.error(`Error deleting: ${err.message}`);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const searchForImages = async () => {
    if (!searchQueryText.trim()) return;
    setIsSearchingImage(true);
    try {
      const res = await fetch('/api/items/search-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: garment.brand, description: searchQueryText }),
      });
      const data = await res.json();
      const payload = data.data ?? data;
      if (res.ok) {
        setSearchResults(payload.images || []);
      } else {
        notify.error(`Search failed: ${data.error ?? 'Unknown'}`);
      }
    } catch (err: any) {
      notify.error(`Search error: ${err.message}`);
    } finally {
      setIsSearchingImage(false);
    }
  };

  const replaceImage = async (img: any) => {
    if (isReplacingImage) return;
    setIsReplacingImage(true);
    try {
      const res = await fetch('/api/items/search-image', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ garmentId: garment.id, imageUrl: img.url }),
      });
      const data = await res.json();
      const payload = data.data ?? data;
      if (res.ok) {
        const primary = payload.images.find((gImg: any) => gImg.is_primary_profile);
        onSaved({
          ...garment,
          images: payload.images,
          primary_image_url: primary ? primary.storage_path : payload.url,
        });
        notify.success('Image replaced');
        setSearchResults(null);
      } else {
        notify.error(`Failed to replace photo: ${data.error ?? 'Unknown'}`);
      }
    } catch (err: any) {
      notify.error(`Error replacing photo: ${err.message}`);
    } finally {
      setIsReplacingImage(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingEdit(true);
    try {
      const res = await fetch('/api/items', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(garment),
      });
      const data = await res.json();
      const payload = data.data ?? data;
      if (res.ok) {
        onSaved(payload.item);
        notify.success('Saved');
        onClose();
      } else {
        notify.error('Failed to save changes.');
      }
    } catch (err: any) {
      notify.error(`Save error: ${err.message}`);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleMerge = async () => {
    if (!mergeTargetGarmentId) {
      notify.error('Pick a garment to merge into.');
      return;
    }
    if (mergeTargetGarmentId === garment.id) {
      notify.error('Cannot merge a garment into itself.');
      return;
    }
    const ok = await confirmAction({
      title: 'Merge garments?',
      description: `This will migrate all photos, wear counts, and outfit pairings from this garment into the selected target, then permanently delete this garment. This cannot be undone.`,
      confirmLabel: 'Merge',
      destructive: true,
    });
    if (!ok) return;
    setIsMergingGarments(true);
    try {
      const res = await fetch('/api/items/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceGarmentId: garment.id, targetGarmentId: mergeTargetGarmentId }),
      });
      if (res.ok) {
        notify.success('Garments merged successfully!');
        onMergeGarment?.(garment.id, mergeTargetGarmentId);
        onClose();
      } else {
        const data = await res.json().catch(() => ({}));
        notify.error(`Merge failed: ${data.error ?? 'Unknown'}`);
      }
    } catch (err: any) {
      notify.error(`Error during merge: ${err.message}`);
    } finally {
      setIsMergingGarments(false);
    }
  };

  const wearsForThis = wearLogs.filter((l) => l.garment_id === garment.id).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={async (e) => {
          e.preventDefault();
          const file = e.dataTransfer.files?.[0];
          if (file && file.type.startsWith('image/')) {
            await uploadImageToGarment(file);
          }
        }}
        className="bg-white border border-[#EAE5D9] rounded-3xl p-6 w-full max-w-4xl space-y-4 max-h-[90vh] overflow-y-auto relative text-[var(--text-primary)] shadow-2xl shadow-stone-300"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#EAE5D9] pb-3">
          <h3 className="text-sm font-extrabold text-[var(--text-primary)]">Edit Garment Curation</h3>
          <div className="flex items-center gap-2">
            {onReclassify && (
              <button
                type="button"
                onClick={() => onReclassify(garment.id)}
                className="text-xs font-extrabold uppercase tracking-wider px-4 py-2 rounded-xl bg-[var(--accent-apricot)] text-[var(--text-primary)] hover:bg-[var(--accent-apricot)]/80 transition active:scale-95 shadow-sm border border-[var(--accent-apricot)]/40"
                title="Re-run Gemini on all images (uses 1 token)"
              >
                🔄 Re-classify with AI
              </button>
            )}
            <button
              onClick={onClose}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] font-bold"
            >
              ✕
            </button>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          {/* Image carousel */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1.5">
              Images
            </label>
            <div className="flex items-center flex-wrap gap-2.5">
              {garment.images.map((img) => (
                <div key={img.id} className="polaroid-frame w-16 h-16 shrink-0 relative">
                  <img src={img.storage_path} alt="" className="object-cover w-full h-full rounded-sm" />
                  {img.is_primary_profile && (
                    <span className="absolute bottom-0 inset-x-0 bg-[var(--accent-sage)]/90 text-white text-[7px] font-black uppercase text-center py-0.5 rounded-b-sm">
                      Primary
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => setPrimaryImage(img.id)}
                    className="absolute -top-1 -left-1 w-4 h-4 bg-[var(--accent-sage)] text-white rounded-full text-[8px] font-bold flex items-center justify-center"
                    title="Set as primary"
                  >
                    ★
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteGarmentImage(img.id)}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-[var(--accent-terracotta)] text-white rounded-full text-[8px] flex items-center justify-center"
                    title="Delete image"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-16 h-16 rounded-xl border-2 border-dashed border-[#EAE5D9] flex flex-col items-center justify-center text-[var(--text-secondary)] hover:bg-[var(--bg-card-secondary)] transition"
                title="Add image (or drag-and-drop)"
              >
                <span className="text-base">+</span>
                <span className="text-[7px] font-bold uppercase">Add</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files) return;
                  for (const f of Array.from(files)) {
                    await uploadImageToGarment(f);
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
            </div>
            <div className="mt-2 flex items-center gap-2">
              <input
                value={searchQueryText}
                onChange={(e) => setSearchQueryText(e.target.value)}
                placeholder="Search brand catalog (e.g. 'Acme Olive T-Shirt')"
                className="flex-1 text-[10px] bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-1.5 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
              <button
                type="button"
                onClick={searchForImages}
                disabled={isSearchingImage}
                className="px-3 py-1.5 bg-[var(--accent-terracotta)] text-white text-[10px] font-bold rounded-xl hover:bg-[var(--accent-terracotta)]/90 disabled:opacity-50"
              >
                {isSearchingImage ? 'Searching…' : '🔎 Find Images'}
              </button>
            </div>
            {searchResults && searchResults.length > 0 && (
              <div className="mt-2 grid grid-cols-4 gap-2 max-h-48 overflow-y-auto p-2 bg-[var(--bg-card-secondary)] rounded-xl">
                {searchResults.map((img: any, idx: number) => (
                  <button
                    key={idx}
                    type="button"
                    disabled={isReplacingImage}
                    onClick={() => replaceImage(img)}
                    className="relative aspect-square border border-[#EAE5D9] rounded-lg overflow-hidden bg-white hover:border-[var(--accent-terracotta)] transition group"
                  >
                    <img src={img.url} alt="" className="object-cover w-full h-full" />
                    <span className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[7px] font-bold uppercase text-center py-0.5 truncate">
                      {img.source || img.title || 'Use'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Core fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Brand</label>
              <input
                type="text"
                value={garment.brand ?? ''}
                onChange={(e) => onSaved({ ...garment, brand: e.target.value || null })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Category</label>
              <select
                value={garment.category}
                onChange={(e) => onSaved({ ...garment, category: e.target.value })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none"
              >
                <option>Tops</option>
                <option>Bottoms</option>
                <option>Outerwear</option>
                <option>Footwear</option>
                <option>Tailoring</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Sub-category</label>
              <input
                type="text"
                value={garment.sub_category}
                onChange={(e) => onSaved({ ...garment, sub_category: e.target.value })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Color family</label>
              <input
                type="text"
                value={garment.color_family}
                onChange={(e) => onSaved({ ...garment, color_family: e.target.value })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Hex</label>
              <input
                type="text"
                value={garment.hex_code ?? ''}
                onChange={(e) => onSaved({ ...garment, hex_code: e.target.value || null })}
                placeholder="#000000"
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40 font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Tonal value</label>
              <select
                value={garment.tonal_value ?? 'Medium'}
                onChange={(e) => onSaved({ ...garment, tonal_value: e.target.value })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none"
              >
                <option>Light</option>
                <option>Medium</option>
                <option>Dark</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Fabric</label>
              <input
                type="text"
                value={garment.fabric_type ?? ''}
                onChange={(e) => onSaved({ ...garment, fabric_type: e.target.value || null })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Fit</label>
              <input
                type="text"
                value={garment.fit_block ?? ''}
                onChange={(e) => onSaved({ ...garment, fit_block: e.target.value || null })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Price ($)</label>
              <input
                type="number"
                step="0.01"
                value={garment.price ?? 0}
                onChange={(e) => onSaved({ ...garment, price: Number(e.target.value) })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Status</label>
              <select
                value={garment.status}
                onChange={(e) => onSaved({ ...garment, status: e.target.value as Garment['status'] })}
                className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none"
              >
                <option>Active</option>
                <option>Archive</option>
                <option>Donate</option>
                <option>Discard</option>
              </select>
            </div>
          </div>

          {/* Build outfit + Wear count */}
          <div className="flex items-center justify-between text-xs pt-2 border-t border-[#EAE5D9]">
            {onBuildOutfitAround && (
              <button
                type="button"
                onClick={() => onBuildOutfitAround(garment)}
                className="px-3.5 py-1.5 rounded-xl bg-[var(--accent-terracotta)]/10 text-[var(--accent-terracotta)] border border-[var(--accent-terracotta)]/20 hover:bg-[var(--accent-terracotta)]/20 font-black text-[10px] uppercase tracking-wider transition active:scale-95"
              >
                ⚡ Build Outfit Around Item
              </button>
            )}
            <span className="text-[var(--text-primary)] font-extrabold">
              {wearsForThis}× total worn
            </span>
          </div>

          {/* Notes */}
          <div>
            <label className="text-[10px] uppercase font-bold text-[var(--text-secondary)] block mb-1">Notes</label>
            <textarea
              value={garment.notes ?? ''}
              onChange={(e) => onSaved({ ...garment, notes: e.target.value || null })}
              rows={2}
              className="w-full text-xs bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-2 focus:outline-none focus:border-[var(--accent-terracotta)]/40 resize-none"
              placeholder="Care notes, styling cues…"
            />
          </div>

          {/* Merge section */}
          {onMergeGarment && (
            <div className="space-y-2 border-t border-[#EAE5D9] pt-2.5">
              <span className="text-[10px] uppercase font-bold text-[var(--text-secondary)]">Merge with Another Garment</span>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={mergeTargetGarmentId}
                  onChange={(e) => setMergeTargetGarmentId(e.target.value)}
                  placeholder="Target garment UUID"
                  className="flex-1 text-[10px] bg-[var(--bg-card-secondary)] border border-[#EAE5D9] rounded-xl px-3 py-1.5 focus:outline-none focus:border-[var(--accent-terracotta)]/40 font-mono"
                />
                <button
                  type="button"
                  onClick={handleMerge}
                  disabled={isMergingGarments}
                  className="px-3 py-1.5 bg-[var(--accent-terracotta)] text-white text-[10px] font-bold rounded-xl hover:bg-[var(--accent-terracotta)]/90 disabled:opacity-50"
                >
                  {isMergingGarments ? '…' : 'Merge'}
                </button>
              </div>
            </div>
          )}

          {/* Save */}
          <div className="flex justify-end gap-2 pt-3 border-t border-[#EAE5D9]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingEdit}
              className="px-5 py-2 text-xs font-extrabold bg-[var(--accent-terracotta)] text-white rounded-xl hover:bg-[var(--accent-terracotta)]/90 disabled:opacity-50 transition shadow-md"
            >
              {isSavingEdit ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}