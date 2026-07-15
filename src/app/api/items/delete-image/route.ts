import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

export const DELETE = withUser(async ({ user, request }) => {
  const { garmentId, imageId } = await request.json();
  if (!garmentId || !imageId) return fail(400, 'Missing garmentId or imageId.');

  // 0. Verify garment ownership.
  const { data: garment, error: ownErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .single();
  if (ownErr || !garment) return fail(404, 'Garment not found.');

  // 1. Fetch image record.
  const { data: imgRecord, error: fetchError } = await user.client
    .from('garment_images')
    .select('storage_path, is_primary_profile')
    .eq('id', imageId)
    .single();

  if (fetchError || !imgRecord) return fail(404, 'Image record not found.');

  if (imgRecord.is_primary_profile) {
    return fail(400, 'Cannot delete the primary profile image. Set another image as primary first.');
  }

  // 2. Remove from storage.
  const urlParts = imgRecord.storage_path.split('/wardrobe-images/');
  const filePath = urlParts[1];
  if (filePath) {
    const { error: storageError } = await user.client.storage
      .from('wardrobe-images')
      .remove([filePath]);
    if (storageError) {
      console.warn('Storage deletion warning:', storageError.message);
    }
  }

  // 3. Delete the row.
  const { error: dbError } = await user.client
    .from('garment_images')
    .delete()
    .eq('id', imageId);

  if (dbError) return fail(500, `Database deletion failed: ${dbError.message}`);

  // 4. Return updated images list.
  const { data: updatedImages } = await user.client
    .from('garment_images')
    .select('*')
    .eq('garment_id', garmentId);

  return ok({ images: updatedImages });
});