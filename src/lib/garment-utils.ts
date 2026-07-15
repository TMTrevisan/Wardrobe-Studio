import type { Garment, WearLog } from '@/types/db';

/** Number of times a given garment has been worn (across the local wear-log cache). */
export function getItemWornCount(garmentId: string, wearLogs: WearLog[]): number {
  return wearLogs.filter((log) => log.garment_id === garmentId).length;
}

/**
 * Cost per wear — `price / wears`. Returns the price itself for items
 * worn zero times (degenerate CPW), and `0` if price is missing.
 */
export function getItemCostPerWear(item: Garment, wears: number): number {
  if (!item.price || item.price <= 0) return 0;
  if (wears <= 0) return item.price;
  return item.price / wears;
}

/** Parse #RRGGBB / #RGB to a {r,g,b} tuple, or null on malformed input. */
export function hexToRgb(hex: string | null | undefined): { r: number; g: number; b: number } | null {
  if (!hex) return null;
  const s = hex.replace('#', '').trim();
  if (s.length === 3) {
    const r = parseInt(s[0] + s[0], 16);
    const g = parseInt(s[1] + s[1], 16);
    const b = parseInt(s[2] + s[2], 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (s.length === 6) {
    const r = parseInt(s.slice(0, 2), 16);
    const g = parseInt(s.slice(2, 4), 16);
    const b = parseInt(s.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

/** Filter predicate used by the closet grid view. */
export interface ItemFilters {
  search?: string;
  category?: string;
  status?: string;
  color?: string;
  subcategory?: string;
}

export function filterGarments(items: Garment[], filters: ItemFilters): Garment[] {
  const search = (filters.search || '').toLowerCase().trim();
  return items.filter((item) => {
    if (filters.category && filters.category !== 'All' && item.category !== filters.category) return false;
    if (filters.status && filters.status !== 'All' && item.status !== filters.status) return false;
    if (filters.color && filters.color !== 'All' && item.color_family !== filters.color) return false;
    if (filters.subcategory && filters.subcategory !== 'All' && item.sub_category !== filters.subcategory) return false;
    if (search) {
      const hay = `${item.brand ?? ''} ${item.sub_category} ${item.color_family} ${item.notes ?? ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });
}