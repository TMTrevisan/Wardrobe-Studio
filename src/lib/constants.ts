/**
 * App-wide constants — anything that's a magic string or repeated
 * across files should live here.
 */

/** Supabase storage bucket name. */
export const STORAGE_BUCKET = 'wardrobe-images';

/** Storage sub-paths for organization. */
export const STORAGE_PATHS = {
  raw: 'raw',
  processed: 'processed',
} as const;

/** Garment status values, in display order. */
export const GARMENT_STATUSES = [
  'Active',
  'Archive',
  'Donate',
  'Discard',
] as const;

export const GARMENT_STATUS_SET_ACTIVE = new Set<string>(['Active']);

/** Top-level categories used by the AI schema + filters. */
export const GARMENT_CATEGORIES = [
  'All',
  'Tops',
  'Bottoms',
  'Outerwear',
  'Footwear',
  'Tailoring',
] as const;

/** Vibe / event presets for the stylist tab. */
export const VIBE_PRESETS = [
  'Corporate Casual',
  'Weekend Lounge',
  'Date Night',
  'Travel',
] as const;

/** Compression settings used by `compressImage`. */
export const INGEST_LIMITS = {
  maxConcurrent: 20,
  maxImageSidePx: 1000,
  jpegQuality: 0.85,
  maxUploadBytes: 10 * 1024 * 1024, // 10 MB
} as const;