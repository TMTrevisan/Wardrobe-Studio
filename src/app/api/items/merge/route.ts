import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

export const POST = withUser(async ({ user, request }) => {
  const { sourceGarmentId, targetGarmentId } = await request.json();

  if (!sourceGarmentId || !targetGarmentId) {
    return fail(400, 'Both sourceGarmentId and targetGarmentId are required.');
  }
  if (sourceGarmentId === targetGarmentId) {
    return fail(400, 'Cannot merge a garment into itself.');
  }

  // 0. Verify both garments belong to the user.
  const { data: source, error: srcErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', sourceGarmentId)
    .single();
  if (srcErr || !source) return fail(404, 'Source garment not found.');
  const { data: target, error: tgtErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', targetGarmentId)
    .single();
  if (tgtErr || !target) return fail(404, 'Target garment not found.');

  // 1. Fetch source garment images & wear logs.
  const { data: sourceImages } = await user.client
    .from('garment_images')
    .select('*')
    .eq('garment_id', sourceGarmentId);

  const { data: sourceWears } = await user.client
    .from('wear_logs')
    .select('*')
    .eq('garment_id', sourceGarmentId);

  // 2. Re-assign all source images to the target (forced to detail).
  if (sourceImages && sourceImages.length > 0) {
    for (const img of sourceImages) {
      const { error } = await user.client
        .from('garment_images')
        .update({
          garment_id: targetGarmentId,
          is_primary_profile: false,
          asset_type: 'detail',
        })
        .eq('id', img.id);
      if (error) return fail(500, `Failed to merge image ${img.id}: ${error.message}`);
    }
  }

  // 3. Re-assign source wear logs.
  if (sourceWears && sourceWears.length > 0) {
    for (const wear of sourceWears) {
      const { error } = await user.client
        .from('wear_logs')
        .update({ garment_id: targetGarmentId })
        .eq('id', wear.id);
      if (error) return fail(500, `Failed to merge wear entry ${wear.id}: ${error.message}`);
    }
  }

  // 4. Update saved outfits that referenced the source garment.
  try {
    const { data: outfits } = await user.client.from('saved_outfits').select('id, item_ids');
    if (outfits && outfits.length > 0) {
      for (const outfit of outfits) {
        if (Array.isArray(outfit.item_ids) && outfit.item_ids.includes(sourceGarmentId)) {
          const updatedIds = Array.from(
            new Set(outfit.item_ids.map((id: string) => (id === sourceGarmentId ? targetGarmentId : id)))
          );
          await user.client.from('saved_outfits').update({ item_ids: updatedIds }).eq('id', outfit.id);
        }
      }
    }
  } catch (err) {
    console.warn('Merge: failed to update referencing saved outfits:', err);
  }

  // 5. Delete source garment record.
  const { error: deleteError } = await user.client
    .from('garments')
    .delete()
    .eq('id', sourceGarmentId);

  if (deleteError) return fail(500, `Failed to delete source garment: ${deleteError.message}`);

  // 6. Return the merged target.
  const { data: targetGarment } = await user.client
    .from('garments')
    .select('*, garment_images(*)')
    .eq('id', targetGarmentId)
    .single();

  const imagesList = targetGarment?.garment_images || [];
  const primary = imagesList.find((img: any) => img.is_primary_profile) || imagesList[0];

  return ok({
    item: {
      ...targetGarment,
      images: imagesList,
      primary_image_url: primary ? primary.storage_path : null,
    },
  });
});