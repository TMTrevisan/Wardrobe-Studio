'use client';

import type { Garment, SavedOutfit } from '@/types/db';
import EmptyState from './EmptyState';

interface OutfitsTabProps {
  outfits: SavedOutfit[];
  items: Garment[];
  loading: boolean;
  onDelete: (id: string) => void | Promise<void>;
  onEditItem: (g: Garment) => void;
  onVisualize: (outfit: SavedOutfit, items: Garment[]) => void;
}

/**
 * Saved outfits archive. Shows each outfit as a card with a 3-column
 * grid of items + the AI styling reasoning + a "View Visuals" CTA.
 */
export default function OutfitsTab({
  outfits,
  items,
  loading,
  onDelete,
  onEditItem,
  onVisualize,
}: OutfitsTabProps) {
  if (loading) {
    return (
      <div className="text-center py-12">
        <p className="text-[var(--text-secondary)] text-xs">Loading outfits…</p>
      </div>
    );
  }

  if (outfits.length === 0) {
    return (
      <EmptyState
        icon="👔"
        title="No saved outfits yet"
        description="Generate some in the AI Stylist tab, then save your favorites here."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {outfits.map((outfit) => {
        const outfitItems = outfit.item_ids
          .map((id) => items.find((item) => item.id === id))
          .filter((item): item is Garment => !!item);

        return (
          <div
            key={outfit.id}
            className="border border-[#EAE5D9] bg-[var(--bg-card-primary)] rounded-3xl p-5 flex flex-col justify-between space-y-4 shadow-xl shadow-stone-200/30 dark:shadow-black/30"
          >
            <div>
              <div className="flex justify-between items-start mb-3 border-b border-[#F5F2EB] dark:border-[#3A3530] pb-2">
                <h3 className="text-sm font-extrabold text-[var(--text-primary)]">{outfit.name}</h3>
                <button
                  type="button"
                  onClick={() => onDelete(outfit.id)}
                  className="text-xs font-extrabold text-[var(--accent-terracotta)] hover:text-[var(--accent-terracotta)]/80"
                >
                  Delete
                </button>
              </div>

              {/* 3-column item grid with color swatch */}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {outfitItems.map((oi) => (
                  <div
                    key={oi.id}
                    className="border border-[#EAE5D9] bg-[#FBFBFA] dark:bg-[#1F1D18] rounded-2xl overflow-hidden flex flex-col relative group"
                  >
                    <div className="absolute top-1 right-1 z-10 flex items-center justify-center">
                      <span
                        className="w-3.5 h-3.5 rounded-full border border-white shadow-sm block"
                        style={{ backgroundColor: oi.hex_code || '#ddd' }}
                        title={`${oi.color_family || 'Custom Color'} swatch`}
                      />
                    </div>
                    <div className="relative aspect-square w-full">
                      <img
                        src={oi.primary_image_url || ''}
                        alt=""
                        className="object-contain w-full h-full mix-blend-multiply"
                      />
                    </div>
                    <div className="p-1 text-center bg-[#F5F2EB] dark:bg-[#2A2620] border-t border-[#EAE5D9] dark:border-[#3A3530]">
                      <p className="text-[8.5px] font-black text-[var(--text-primary)] truncate">
                        {oi.brand ? `${oi.brand} ` : ''}
                        {oi.sub_category}
                      </p>
                      <p className="text-[7.5px] font-bold text-[var(--text-secondary)] truncate lowercase">
                        {oi.fabric_type || ''} • {oi.color_family}
                      </p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Constituents list (clickable to edit) */}
              <div className="space-y-1 bg-[#FAF8F5] dark:bg-[#1F1D18] border border-[#EAE5D9] dark:border-[#3A3530] p-3 rounded-2xl mb-3">
                <p className="text-[9px] uppercase font-black tracking-widest text-[var(--text-secondary)] mb-1.5 select-none">
                  Outfit Constituents
                </p>
                {outfitItems.map((oi) => (
                  <div
                    key={oi.id}
                    onClick={() => onEditItem(oi)}
                    className="flex items-center justify-between text-xs py-1 px-1.5 rounded-lg hover:bg-stone-100 dark:hover:bg-[#2A2620] transition cursor-pointer select-none"
                  >
                    <span className="font-extrabold text-[var(--text-primary)] hover:underline flex items-center gap-1.5">
                      <span
                        className="w-2.5 h-2.5 rounded-full border border-stone-300 inline-block shadow-inner shrink-0"
                        style={{ backgroundColor: oi.hex_code || '#ddd' }}
                      />
                      {oi.brand ? `${oi.brand} ` : ''}
                      {oi.sub_category}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--accent-terracotta)] uppercase shrink-0">
                      edit ↗
                    </span>
                  </div>
                ))}
              </div>

              {outfit.styling_reasoning && (
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed mb-3.5 font-semibold">
                  {outfit.styling_reasoning}
                </p>
              )}

              <button
                type="button"
                onClick={() => onVisualize(outfit, outfitItems)}
                className="w-full py-2.5 bg-[#FAF8F5] dark:bg-[#2A2620] text-[var(--accent-terracotta)] border border-[#EAE5D9] dark:border-[#3A3530] hover:bg-[#F5F2EB] dark:hover:bg-[#1F1D18] rounded-xl text-xs font-black transition flex items-center justify-center gap-1.5"
              >
                🎨 View Outfit Visuals
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}