type SourceAsset = { bucket?: string | null; storage_path?: string | null } | null | undefined;

export type LegacyStorageLocation = { bucket: string; path: string };

/** A Studio crop or legacy primary image is valid catalog-generation evidence. */
export function hasCatalogSource(sourceCrop: SourceAsset, legacyPrimaryPath?: string | null): boolean {
  return Boolean(
    (sourceCrop?.bucket && sourceCrop.storage_path) || legacyPrimaryPath,
  );
}

/**
 * Older wardrobe records saved a complete Storage URL instead of bucket/path
 * columns. The URL may say `/public/`, even when the bucket later became
 * private. Parse only URLs belonging to this project so the server can use
 * the authenticated Storage client rather than trusting a remote fetch.
 */
export function getLegacyStorageLocation(storageUrl: string, supabaseUrl: string): LegacyStorageLocation | null {
  try {
    const source = new URL(storageUrl);
    const project = new URL(supabaseUrl);
    if (source.origin !== project.origin) return null;

    const prefix = '/storage/v1/object/';
    if (!source.pathname.startsWith(prefix)) return null;
    const parts = source.pathname.slice(prefix.length).split('/').filter(Boolean);
    if ((parts[0] !== 'public' && parts[0] !== 'authenticated') || !parts[1] || parts.length < 3) return null;

    return {
      bucket: decodeURIComponent(parts[1]),
      path: parts.slice(2).map(decodeURIComponent).join('/'),
    };
  } catch {
    return null;
  }
}
