type SourceAsset = { bucket?: string | null; storage_path?: string | null } | null | undefined;

/** A Studio crop or legacy primary image is valid catalog-generation evidence. */
export function hasCatalogSource(sourceCrop: SourceAsset, legacyPrimaryPath?: string | null): boolean {
  return Boolean(
    (sourceCrop?.bucket && sourceCrop.storage_path) || legacyPrimaryPath,
  );
}
