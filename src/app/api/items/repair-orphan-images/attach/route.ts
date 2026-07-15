import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

/**
 * POST /api/items/repair-orphan-images/attach
 *
 * Body: { orphanPath: string, garmentId: string, assetType?: 'profile' | 'detail', setAsPrimary?: boolean }
 *
 * Inserts a garment_images row pointing at the given storage path. Used
 * to repair uploads that never made it into the DB.
 */

export const POST = withUser(async ({ user, request }) => {
  const { orphanPath, garmentId, assetType = 'detail', setAsPrimary = false } = await request.json();

  if (!orphanPath || !garmentId) {
    return fail(400, 'orphanPath and garmentId are required.');
  }
  if (assetType !== 'profile' && assetType !== 'detail') {
    return fail(400, 'assetType must be "profile" or "detail".');
  }

  // 1. Verify the garment belongs to this user.
  const { data: garment, error: gErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .single();
  if (gErr || !garment) {
    return fail(404, 'Garment not found.');
  }

  // 2. Optionally demote the current primary to detail.
  if (setAsPrimary) {
    await user.client
      .from('garment_images')
      .update({ is_primary_profile: false })
      .eq('garment_id', garmentId);
  }

  // 3. Insert the new image row.
  const { data: inserted, error: iErr } = await user.client
    .from('garment_images')
    .insert({
      garment_id: garmentId,
      storage_path: orphanPath,
      asset_type: assetType,
      is_primary_profile: setAsPrimary,
    })
    .select()
    .single();

  if (iErr) return fail(500, `Insert failed: ${iErr.message}`);

  return ok({ image: inserted });
});