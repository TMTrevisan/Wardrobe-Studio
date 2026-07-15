import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';
import { getLegacyWardrobeImagePath } from '@/lib/storage-path';
import { hasCatalogSource } from '@/lib/catalog-source';

/**
 * Explicit allowlist of columns a client is permitted to PATCH on a garment.
 * Anything outside this set is silently dropped — preventing a caller from
 * rewriting `user_id`, `ai_extracted_json`, `status`, etc.
 */
const GARMENT_UPDATABLE_FIELDS = [
  'category',
  'sub_category',
  'brand',
  'color_family',
  'hex_code',
  'tonal_value',
  'fabric_type',
  'fit_block',
  'style_detail',
  'price',
  'purchase_year',
  'notes',
  'status',
  'display_name',
  'pattern',
  'season',
  'formality',
  'size_label',
] as const;

type GarmentUpdatableField = (typeof GARMENT_UPDATABLE_FIELDS)[number];

function pickUpdatable(body: Record<string, unknown>): Partial<Record<GarmentUpdatableField, unknown>> {
  const out: Partial<Record<GarmentUpdatableField, unknown>> = {};
  for (const key of GARMENT_UPDATABLE_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

// GET all items joined with their garment_images
export const GET = withUser(async ({ user }) => {
  let { data: items, error } = await user.client
    .from('garments')
    .select('*, garment_images(*), garment_assets(*)')
    .order('created_at', { ascending: false });

  // Transitional fallback while the additive Wardrobe Studio migration has
  // not yet been applied to an existing project.
  if (error?.message?.includes('garment_assets')) {
    const legacy = await user.client
      .from('garments')
      .select('*, garment_images(*)')
      .order('created_at', { ascending: false });
    items = legacy.data;
    error = legacy.error;
  }

  if (error) return fail(500, error.message);

  const legacyPrimaryPaths = Array.from(new Set((items || []).flatMap((item: any) => {
    const images = item.garment_images || [];
    const primary = images.find((image: any) => image.is_primary_profile) || images[0];
    const path = getLegacyWardrobeImagePath(primary?.storage_path);
    return path ? [path] : [];
  })));
  const legacySignedUrls = new Map<string, string>();
  if (legacyPrimaryPaths.length) {
    const { data: signedRows } = await user.client.storage
      .from('wardrobe-images')
      .createSignedUrls(legacyPrimaryPaths, 60 * 60);
    for (const row of signedRows || []) {
      if (row.path && row.signedUrl) legacySignedUrls.set(row.path, row.signedUrl);
    }
  }

  const itemsWithImages = await Promise.all((items || []).map(async (item: any) => {
    const images = item.garment_images || [];
    const assets = item.garment_assets || [];
    const catalog = assets.find((asset: any) => asset.kind === 'catalog_cutout' && asset.is_primary)
      || assets.find((asset: any) => asset.kind === 'catalog_cutout');
    const sourceCrop = assets.find((asset: any) => asset.kind === 'source_crop');
    const primary = images.find((img: any) => img.is_primary_profile) || images[0];
    const legacyPrimaryPath = getLegacyWardrobeImagePath(primary?.storage_path);
    const legacyPrimaryUrl = legacyPrimaryPath ? legacySignedUrls.get(legacyPrimaryPath) || null : null;
    const signAsset = async (asset: any) => {
      if (!asset?.bucket || !asset?.storage_path) return null;
      const { data: signed } = await user.client.storage
        .from(asset.bucket)
        .createSignedUrl(asset.storage_path, 60 * 60);
      return signed?.signedUrl || null;
    };
    const [catalogUrl, sourceCropUrl] = await Promise.all([signAsset(catalog), signAsset(sourceCrop)]);
    return {
      ...item,
      images,
      assets,
      primary_image_url: catalogUrl || sourceCropUrl || legacyPrimaryUrl || (legacyPrimaryPath ? null : primary?.storage_path || null),
      catalog_asset_url: catalogUrl,
      source_asset_url: sourceCropUrl,
      // Older garments retain their evidence in garment_images rather than
      // Studio source_crop assets. A public legacy primary image is still a
      // valid catalog reconstruction source and must not lose Generate.
      catalog_source_ready: hasCatalogSource(sourceCrop, legacyPrimaryPath),
    };
  }));

  return ok({ items: itemsWithImages });
});

// PATCH update item details
export const PATCH = withUser(async ({ user, request }) => {
  const body = await request.json();
  const { id } = body;

  if (!id) return fail(400, 'Item ID is required.');

  const updates = pickUpdatable(body || {});
  if (Object.keys(updates).length === 0) {
    return fail(400, 'No updatable fields supplied.');
  }

  const { data: updatedItem, error } = await user.client
    .from('garments')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return fail(500, error.message);

  const { data: garmentImages } = await user.client
    .from('garment_images')
    .select('*')
    .eq('garment_id', id);

  const imagesList = garmentImages || [];
  const primary = imagesList.find((img: any) => img.is_primary_profile) || imagesList[0];

  return ok({
    item: {
      ...updatedItem,
      images: imagesList,
      primary_image_url: primary ? primary.storage_path : null,
    },
  });
});

// DELETE item and all its associated images in storage
export const DELETE = withUser(async ({ user, request }) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) return fail(400, 'Item ID is required.');

  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return fail(400, 'Invalid UUID format provided for deletion.');
  }

  // 1. Fetch all associated legacy and Studio assets while the user-owned
  // garment is still visible through RLS. Database rows cascade on delete, but
  // Storage objects must be removed explicitly.
  const [{ data: images, error: fetchError }, { data: assets, error: assetFetchError }] = await Promise.all([
    user.client
    .from('garment_images')
    .select('storage_path')
    .eq('garment_id', id),
    user.client
      .from('garment_assets')
      .select('bucket, storage_path')
      .eq('garment_id', id),
  ]);

  if (fetchError) return fail(500, `Failed to fetch images: ${fetchError.message}`);
  if (assetFetchError && !assetFetchError.message.includes('garment_assets')) {
    return fail(500, `Failed to fetch Studio assets: ${assetFetchError.message}`);
  }

  // 2. Remove from storage.
  if (images && images.length > 0) {
    const storagePaths = images
      .map((img: any) => {
        const urlParts = img.storage_path.split('/wardrobe-images/');
        return urlParts.length > 1 ? urlParts[1] : null;
      })
      .filter((p): p is string => !!p);

    if (storagePaths.length > 0) {
      const { error: storageError } = await user.client.storage
        .from('wardrobe-images')
        .remove(storagePaths);

      if (storageError) {
        console.warn('Failed to remove images from storage:', storageError.message);
      }
    }
  }

  const assetPathsByBucket = new Map<string, string[]>();
  for (const asset of assets || []) {
    if (!asset.bucket || !asset.storage_path) continue;
    const paths = assetPathsByBucket.get(asset.bucket) || [];
    paths.push(asset.storage_path);
    assetPathsByBucket.set(asset.bucket, paths);
  }
  for (const [bucket, paths] of assetPathsByBucket) {
    const { error: storageError } = await user.client.storage.from(bucket).remove(paths);
    if (storageError) console.warn('Failed to remove Studio assets from storage:', { bucket, message: storageError.message });
  }

  // 3. Clean up referencing saved outfits.
  try {
    const { data: outfits } = await user.client.from('saved_outfits').select('id, item_ids');
    if (outfits && outfits.length > 0) {
      for (const outfit of outfits) {
        if (Array.isArray(outfit.item_ids) && outfit.item_ids.includes(id)) {
          const updatedIds = outfit.item_ids.filter((itemId: string) => itemId !== id);
          if (updatedIds.length === 0) {
            await user.client.from('saved_outfits').delete().eq('id', outfit.id);
          } else {
            await user.client.from('saved_outfits').update({ item_ids: updatedIds }).eq('id', outfit.id);
          }
        }
      }
    }
  } catch (err) {
    console.warn('Orphaned outfit cleanup failed:', err);
  }

  // 4. Delete the row (cascades to garment_images via FK).
  const { error: deleteError } = await user.client
    .from('garments')
    .delete()
    .eq('id', id);

  if (deleteError) return fail(500, deleteError.message);

  return ok({});
});
