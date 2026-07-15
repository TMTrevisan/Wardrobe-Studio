import { NextResponse } from 'next/server';
import { withUser } from '@/lib/api';
import { fail, ok } from '@/lib/api';

export const PATCH = withUser(async ({ user, request }) => {
  const { garmentId, imageId } = await request.json();
  if (!garmentId || !imageId) return fail(400, 'Missing garmentId or imageId.');

  // 0. Verify ownership of the garment before mutating its images.
  const { data: garment, error: ownErr } = await user.client
    .from('garments')
    .select('id')
    .eq('id', garmentId)
    .single();
  if (ownErr || !garment) return fail(404, 'Garment not found.');

  // 1. Reset all images for this garment as not primary.
  const { error: resetError } = await user.client
    .from('garment_images')
    .update({ is_primary_profile: false })
    .eq('garment_id', garmentId);

  if (resetError) return fail(500, `Reset primary failed: ${resetError.message}`);

  // 2. Promote the chosen image.
  const { error: setError } = await user.client
    .from('garment_images')
    .update({ is_primary_profile: true })
    .eq('id', imageId);

  if (setError) return fail(500, `Set primary failed: ${setError.message}`);

  // 3. Return the updated list.
  const { data: updatedImages } = await user.client
    .from('garment_images')
    .select('*')
    .eq('garment_id', garmentId);

  return ok({ images: updatedImages });
});